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
import { runMissedFillJob } from './jobs/missedFill.js';
import { getDatabase } from '../db/index.js';
import { RunsRepo } from '../repos/runsRepo.js';
import { AssessmentsRepo } from '../repos/assessmentsRepo.js';
import { DecisionsRepo } from '../repos/decisionsRepo.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import { ArtifactsRepo } from '../repos/artifactsRepo.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { PaperBroker } from '../brokers/paperBroker.js';
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

// Missed-fill recovery job; runs hourly to fill orders that missed market open.
let missedFillJob: Cron | null = null;

// ── job handlers ──────────────────────────────────────────────────────────────

// ── internal ──────────────────────────────────────────────────────────────────

function registerJobs(): void {
  const settings = getSettings();
  const { cron, timezone } = settings.schedule;

  if (activeJob) {
    activeJob.stop();
    activeJob = null;
    log.info('previous jobs stopped');
  }

  try {
    activeJob = new Cron(cron, { timezone, protect: true }, async () => {
      try {
        const db = getDatabase();
        const settings = getSettings();

        // repos
        const runsRepo        = new RunsRepo(db);
        const assessmentsRepo = new AssessmentsRepo(db);
        const decisionsRepo   = new DecisionsRepo(db);
        const ordersRepo      = new OrdersRepo(db);
        const fillsRepo       = new FillsRepo(db);
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
        const broker           = new PaperBroker(db, priceService, ordersRepo, fillsRepo, positionsRepo, portfolioRepo, {
          fillModel:   settings.paperAccount.fillModel,
          slippageBps: settings.paperAccount.slippageBps,
        }, semanticMemory ? { decisionsRepo, assessmentsRepo, semanticMemory } : undefined);

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
    const nextRun = activeJob.nextRun();
    log.info('scheduler registered', { cron, timezone, nextRun: nextRun?.toISOString() ?? null });
  } catch (err) {
    log.error('failed to register scheduler jobs', {
      error: err instanceof Error ? err.message : String(err),
      cron,
      timezone,
    });
    activeJob = null;
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/** Initialise the scheduler. Must be called once after settings are available. */
export function startScheduler(): void {
  registerJobs();

  // Register fixed snapshot job (16:30 ET daily on trading days, after market close, before trading cycle)
  try {
    const db = getDatabase();
    snapshotCronJob = new Cron(
      '30 16 * * 1-5',
      { timezone: 'America/New_York', protect: true },
      async () => {
        await runSnapshotJob(db);
      }
    );
    const nextRun = snapshotCronJob.nextRun();
    log.info('snapshot job registered', { cron: '30 16 * * 1-5', timezone: 'America/New_York', nextRun: nextRun?.toISOString() ?? null });
  } catch (err) {
    log.error('failed to register snapshot job', {
      error: err instanceof Error ? err.message : String(err),
    });
    snapshotCronJob = null;
  }

  // Register missed-fill recovery job (hourly) to fill orders that missed market open
  try {
    const db = getDatabase();
    missedFillJob = new Cron('0 * * * *', { protect: true }, async () => {
      const settings = getSettings();
      await runMissedFillJob(db, { slippageBps: settings.paperAccount.slippageBps });
    });
    log.info('missed-fill job registered', { cron: '0 * * * *' });
  } catch (err) {
    log.error('failed to register missed-fill job', { error: err instanceof Error ? err.message : String(err) });
    missedFillJob = null;
  }

  settingsEvents.on('change', () => {
    log.info('settings changed, re-registering scheduler jobs');
    registerJobs();
  });
}

/** Stop all active jobs (call on SIGTERM/SIGINT). */
export function stopScheduler(): void {
  if (activeJob) {
    activeJob.stop();
    activeJob = null;
  }

  if (snapshotCronJob) {
    snapshotCronJob.stop();
    snapshotCronJob = null;
  }

  if (missedFillJob) {
    missedFillJob.stop();
    missedFillJob = null;
  }

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
