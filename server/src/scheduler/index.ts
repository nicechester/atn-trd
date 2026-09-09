/**
 * Croner-based job scheduler.
 *
 * Loads the cron expression and timezone from settings, registers jobs, and
 * re-registers them whenever settings change. In Phase 1 only the snapshot
 * job is registered, as a no-op placeholder for the Phase 2 trading cycle.
 *
 * Public API:
 *   startScheduler()   — initialise once at startup
 *   stopScheduler()    — graceful shutdown
 *   getNextRuns(n)     — next N scheduled run times (ISO strings)
 */

import { Cron } from 'croner';
import { getSettings } from '../config/settingsService.js';
import { settingsEvents } from '../config/settingsService.js';
import { getLlmLimits } from '@atn-trd/shared';
import { logger } from '../lib/logger.js';
import { runSnapshotJob } from './jobs/snapshot.js';
import { isTradingDay } from './marketCalendar.js';
import { runSignalCollectionJob } from './jobs/signalCollection.js';
import { runRegimeDetectionJob } from './jobs/regimeDetection.js';
import { runWeeklyPlannerJob } from './jobs/weeklyPlanner.js';
import { runTrancheExecutorJob } from './jobs/trancheExecutor.js';
import { runWatchlistCuratorJob } from './jobs/watchlistCurator.js';
import { getDatabase } from '../db/index.js';
import { RunsRepo } from '../repos/runsRepo.js';
import { AssessmentsRepo } from '../repos/assessmentsRepo.js';
import { DecisionsRepo } from '../repos/decisionsRepo.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import { ArtifactsRepo } from '../repos/artifactsRepo.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { AlpacaBroker } from '../brokers/alpacaBroker.js';
import { RunCache } from '../datasources/cache.js';
import { dataSourceRegistry } from '../datasources/registry.js';
import type { NewsDataSource } from '../datasources/news/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { MacroDataSource } from '../datasources/macro/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import { YahooSectorPerformance } from '../datasources/sectors/index.js';
import type { AnalystAgentDeps } from '../agent/analystAgent.js';
import { createTradingCycleService } from '../services/tradingCycleService.js';
import { createEmbeddingService } from '../llm/embeddingService.js';
import { createSemanticMemoryService, type SemanticMemoryService } from '../services/semanticMemoryService.js';
import { resolveApiKey } from '../llm/openaiChatModel.js';
import { ScreenerSelectionsRepo } from '../repos/screenerSelectionsRepo.js';
import type { ScreenerAgentDeps } from '../agent/screenerAgent.js';
import { runScreener } from '../services/screenerOrchestrationService.js';

const log = logger.child({ component: 'scheduler' });

// Active job handle; replaced on every settings change.
let activeJob: Cron | null = null;

// Snapshot job handle; runs daily at 16:30 ET on trading days (after market close, before trading cycle).
let snapshotCronJob: Cron | null = null;

// Signal collection job; runs daily at 16:00 ET on trading days (before snapshot).
let signalCollectionJob: Cron | null = null;

// Regime detection job; runs daily at 16:05 ET on trading days.
let regimeDetectionJob: Cron | null = null;

// Weekly planner job; runs Mondays at 16:10 ET.
let weeklyPlannerJob: Cron | null = null;

// Tranche executor job; runs daily at 16:15 ET on trading days.
let trancheExecutorJob: Cron | null = null;

// Watchlist curator job; runs on configurable schedule (weekly/monthly/quarterly).
let watchlistCuratorJob: Cron | null = null;

// ── internal ──────────────────────────────────────────────────────────────────

function stopAllJobs(): void {
  if (activeJob) { activeJob.stop(); activeJob = null; }
  if (snapshotCronJob) { snapshotCronJob.stop(); snapshotCronJob = null; }
  if (signalCollectionJob) { signalCollectionJob.stop(); signalCollectionJob = null; }
  if (regimeDetectionJob) { regimeDetectionJob.stop(); regimeDetectionJob = null; }
  if (weeklyPlannerJob) { weeklyPlannerJob.stop(); weeklyPlannerJob = null; }
  if (trancheExecutorJob) { trancheExecutorJob.stop(); trancheExecutorJob = null; }
  if (watchlistCuratorJob) { watchlistCuratorJob.stop(); watchlistCuratorJob = null; }
}

function registerAllJobs(): void {
  const db = getDatabase();
  const settings = getSettings();

  stopAllJobs();
  log.info('re-registering all scheduler jobs');

  // Trading Cycle job
  const { cron, timezone } = settings.schedule;

  try {
    activeJob = new Cron(cron, { timezone, protect: true }, async () => {
      // Skip on holidays
      if (!isTradingDay(new Date())) {
        log.info('trading cycle skipped (not a trading day)');
        return;
      }

      // Skip if strategic execution is enabled (use plan-based trading instead)
      const currentSettings = getSettings();
      if (currentSettings.execution.enabled) {
        log.info('trading cycle skipped (strategic execution enabled, use plan-based trading)');
        return;
      }

      try {
        const db = getDatabase();
        const settings = getSettings();

        // repos
        const runsRepo        = new RunsRepo(db);
        const assessmentsRepo = new AssessmentsRepo(db);
        const decisionsRepo   = new DecisionsRepo(db);
        const ordersRepo      = new OrdersRepo(db);
        const positionsRepo   = new PositionsRepo(db);
        const portfolioRepo   = new PortfolioRepo(db);
        const pricesRepo      = new PricesRepo(db);
        const messagesRepo    = new AgentMessagesRepo(db);
        const artifactsRepo   = new ArtifactsRepo(db);
        const watchlistRepo   = new WatchlistRepo(db);

        // semantic memory (optional, guarded against unconfigured API key)
        let semanticMemory: SemanticMemoryService | undefined;
        if (settings.semanticMemory.enabled) {
          if (resolveApiKey()) {
            semanticMemory = createSemanticMemoryService(db, createEmbeddingService());
          } else {
            log.warn('semantic memory enabled but no LLM API key configured; skipping');
          }
        }

        // services
        const priceService     = new PriceService(pricesRepo);
        const portfolioService = new PortfolioServiceImpl(db, priceService, positionsRepo, portfolioRepo);

        // Initialize Alpaca paper trading broker
        const apiKey = process.env.ALPACA_API_KEY;
        const apiSecret = process.env.ALPACA_API_SECRET;
        if (!apiKey || !apiSecret) {
          throw new Error('ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required for Alpaca paper trading');
        }
        const broker = new AlpacaBroker({
          apiKey,
          apiSecret,
          paperTrading: true,
        });

        // agent tools deps (with per-run cache)
        const runCache = new RunCache();
        const sectorSource = new YahooSectorPerformance({ pricesRepo });
        const analystDeps: AnalystAgentDeps = {
          toolsDeps: {
            newsSource:         dataSourceRegistry.get('news') as unknown as NewsDataSource,
            fundamentalsSource: dataSourceRegistry.get('fundamentals') as unknown as FundamentalsDataSource,
            macroSource:        dataSourceRegistry.get('macro') as unknown as MacroDataSource,
            optionsSource:      dataSourceRegistry.get('options') as unknown as OptionsDataSource,
            sectorSource,
            pricesRepo,
            portfolioService,
            decisionsRepo,
            cache: runCache,
            semanticMemory,
            llmLimits: getLlmLimits(settings.llm.localLlmMode),
          },
          messagesRepo,
          artifactsRepo,
        };

        // screener deps
        const screenerSelectionsRepo = new ScreenerSelectionsRepo(db);
        const screenerAgentDeps: ScreenerAgentDeps = {
          toolsDeps: {
            sectorSource,
            fundamentalsSource: dataSourceRegistry.get('fundamentals') as unknown as FundamentalsDataSource,
            optionsSource: dataSourceRegistry.get('options') as unknown as OptionsDataSource,
            cache: runCache,
          },
          messagesRepo,
          artifactsRepo,
        };

        // Seed portfolio on first run if not yet initialized
        if (!portfolioRepo.read()) {
          portfolioRepo.write({
            cashCents: settings.trading.startingCashCents,
            startingCashCents: settings.trading.startingCashCents,
            startedAt: Date.now(),
            resetAt: null,
            baseCurrency: settings.trading.baseCurrency,
          });
        }

        const tradingCycle = createTradingCycleService({
          db,
          runsRepo,
          assessmentsRepo,
          decisionsRepo,
          ordersRepo,
          portfolioService,
          broker,
          analystDeps,
          priceFeed: priceService,
          getSettings,
          watchlistRepo,
          semanticMemory,
          screenerDeps: {
            screenerSelectionsRepo,
            screenerAgentDeps,
            toolsDeps: analystDeps.toolsDeps,
          },
          runScreener,
        });

        await tradingCycle.execute('scheduled');
      } catch (err) {
        log.error('trading cycle job failed', { error: err instanceof Error ? err.message : String(err) });
      }
    });
    log.info('trading-cycle job registered', { cron, timezone, nextRun: activeJob.nextRun()?.toISOString() ?? null });
  } catch (err) {
    log.error('failed to register trading-cycle job', { error: err instanceof Error ? err.message : String(err) });
    activeJob = null;
  }

  // Snapshot job (16:30 ET daily on trading days)
  try {
    snapshotCronJob = new Cron('30 16 * * 1-5', { timezone: 'America/New_York', protect: true }, async () => {
      await runSnapshotJob(db);
    });
    log.info('snapshot job registered', { cron: '30 16 * * 1-5', nextRun: snapshotCronJob.nextRun()?.toISOString() ?? null });
  } catch (err) {
    log.error('failed to register snapshot job', { error: err instanceof Error ? err.message : String(err) });
    snapshotCronJob = null;
  }

  // Signal collection job (16:00 ET on trading days)
  try {
    signalCollectionJob = new Cron('0 16 * * 1-5', { timezone: 'America/New_York', protect: true }, async () => {
      await runSignalCollectionJob(db);
    });
    log.info('signal-collection job registered', { cron: '0 16 * * 1-5' });
  } catch (err) {
    log.error('failed to register signal-collection job', { error: err instanceof Error ? err.message : String(err) });
    signalCollectionJob = null;
  }

  // Regime detection job (16:05 ET on trading days)
  try {
    regimeDetectionJob = new Cron('5 16 * * 1-5', { timezone: 'America/New_York', protect: true }, async () => {
      await runRegimeDetectionJob(db);
    });
    log.info('regime-detection job registered', { cron: '5 16 * * 1-5' });
  } catch (err) {
    log.error('failed to register regime-detection job', { error: err instanceof Error ? err.message : String(err) });
    regimeDetectionJob = null;
  }

  // Weekly planner job (Mondays at 16:10 ET)
  try {
    weeklyPlannerJob = new Cron('10 16 * * 1', { timezone: 'America/New_York', protect: true }, async () => {
      await runWeeklyPlannerJob(db);
    });
    log.info('weekly-planner job registered', { cron: '10 16 * * 1' });
  } catch (err) {
    log.error('failed to register weekly-planner job', { error: err instanceof Error ? err.message : String(err) });
    weeklyPlannerJob = null;
  }

  // Tranche executor job (16:15 ET on trading days)
  try {
    trancheExecutorJob = new Cron('15 16 * * 1-5', { timezone: 'America/New_York', protect: true }, async () => {
      await runTrancheExecutorJob(db);
    });
    log.info('tranche-executor job registered', { cron: '15 16 * * 1-5' });
  } catch (err) {
    log.error('failed to register tranche-executor job', { error: err instanceof Error ? err.message : String(err) });
    trancheExecutorJob = null;
  }

  // Watchlist curator job (configurable schedule)
  const curatorCron = settings.watchlist.curatorCron?.trim();
  if (curatorCron && settings.watchlist.mode === 'dynamic') {
    try {
      watchlistCuratorJob = new Cron(curatorCron, { timezone: 'America/New_York', protect: true }, async () => {
        await runWatchlistCuratorJob(db);
      });
      log.info('watchlist-curator job registered', { cron: curatorCron, nextRun: watchlistCuratorJob.nextRun()?.toISOString() ?? null });
    } catch (err) {
      log.error('failed to register watchlist-curator job', { error: err instanceof Error ? err.message : String(err) });
      watchlistCuratorJob = null;
    }
  } else {
    log.debug('watchlist curator not scheduled', { reason: !curatorCron ? 'no cron set' : 'not in dynamic mode' });
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/** Initialise the scheduler. Must be called once after settings are available. */
export function startScheduler(): void {
  registerAllJobs();
  settingsEvents.on('change', () => registerAllJobs());
}

/** Stop all active jobs (call on SIGTERM/SIGINT). */
export function stopScheduler(): void {
  stopAllJobs();
  log.info('scheduler stopped');
}

/**
 * Return the next `n` scheduled run times as ISO-8601 strings.
 * Returns an empty array if no job is registered or the expression
 * produces no future runs.
 */
export function getNextRuns(n: number): string[] {
  if (!activeJob) return [];
  try {
    return activeJob.nextRuns(n).map((d) => d.toISOString());
  } catch {
    return [];
  }
}

export interface JobSchedule {
  name: string;
  cron: string;
  nextRun: string | null;
  enabled: boolean;
}

/** Return schedule info for all registered jobs. */
export function getJobSchedules(): JobSchedule[] {
  const settings = getSettings();
  const jobs: JobSchedule[] = [];

  if (signalCollectionJob) {
    jobs.push({
      name: 'Signal Collection',
      cron: '0 16 * * 1-5',
      nextRun: signalCollectionJob.nextRun()?.toISOString() ?? null,
      enabled: settings.signals.enabled,
    });
  }

  if (regimeDetectionJob) {
    jobs.push({
      name: 'Regime Detection',
      cron: '5 16 * * 1-5',
      nextRun: regimeDetectionJob.nextRun()?.toISOString() ?? null,
      enabled: settings.regime.enabled,
    });
  }

  if (weeklyPlannerJob) {
    jobs.push({
      name: 'Weekly Planner',
      cron: '10 16 * * 1',
      nextRun: weeklyPlannerJob.nextRun()?.toISOString() ?? null,
      enabled: settings.execution.enabled,
    });
  }

  if (trancheExecutorJob) {
    jobs.push({
      name: 'Tranche Executor',
      cron: '15 16 * * 1-5',
      nextRun: trancheExecutorJob.nextRun()?.toISOString() ?? null,
      enabled: settings.execution.enabled,
    });
  }

  // Always show Watchlist Curator (even when not scheduled)
  const curatorCron = settings.watchlist.curatorCron;
  const curatorEnabled = settings.watchlist.mode === 'dynamic' && !!curatorCron;
  jobs.push({
    name: 'Watchlist Curator',
    cron: curatorCron || 'disabled',
    nextRun: watchlistCuratorJob?.nextRun()?.toISOString() ?? null,
    enabled: curatorEnabled,
  });

  if (snapshotCronJob) {
    jobs.push({
      name: 'Snapshot',
      cron: '30 16 * * 1-5',
      nextRun: snapshotCronJob.nextRun()?.toISOString() ?? null,
      enabled: true, // Always enabled
    });
  }

  if (activeJob) {
    jobs.push({
      name: 'Trading Cycle',
      cron: settings.schedule.cron,
      nextRun: activeJob.nextRun()?.toISOString() ?? null,
      enabled: settings.trading.enabled && !settings.execution.enabled,
    });
  }

  return jobs;
}
