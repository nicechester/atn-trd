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
import { logger } from '../lib/logger.js';
import { runSnapshotJob } from './jobs/snapshot.js';
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
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { PaperBroker } from '../brokers/paperBroker.js';
import { dataSourceRegistry } from '../datasources/registry.js';
import type { NewsDataSource } from '../datasources/news/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { MacroDataSource } from '../datasources/macro/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import type { AnalystAgentDeps } from '../agent/analystAgent.js';
import { createTradingCycleService } from '../services/tradingCycleService.js';

const log = logger.child({ component: 'scheduler' });

// Active job handle; replaced on every settings change.
let activeJob: Cron | null = null;

// Snapshot job handle; runs daily at 16:45 ET on trading days.
let snapshotCronJob: Cron | null = null;

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

        // services
        const priceService     = new PriceService(pricesRepo);
        const portfolioService = new PortfolioServiceImpl(db, priceService, positionsRepo, portfolioRepo);
        const broker           = new PaperBroker(db, priceService, ordersRepo, fillsRepo, positionsRepo, portfolioRepo, {
          fillModel:   settings.paperAccount.fillModel,
          slippageBps: settings.paperAccount.slippageBps,
        });

        // agent tools deps
        const analystDeps: AnalystAgentDeps = {
          toolsDeps: {
            newsSource:         dataSourceRegistry.get('news') as unknown as NewsDataSource,
            fundamentalsSource: dataSourceRegistry.get('fundamentals') as unknown as FundamentalsDataSource,
            macroSource:        dataSourceRegistry.get('macro') as unknown as MacroDataSource,
            optionsSource:      dataSourceRegistry.get('options') as unknown as OptionsDataSource,
            pricesRepo,
            portfolioService,
            decisionsRepo,
          },
          messagesRepo,
          artifactsRepo,
        };

        const tradingCycle = createTradingCycleService({
          runsRepo,
          assessmentsRepo,
          decisionsRepo,
          ordersRepo,
          portfolioService,
          broker,
          analystDeps,
          priceFeed: priceService,
          getSettings,
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

  // Register fixed snapshot job (16:45 ET daily on trading days)
  try {
    const db = getDatabase();
    snapshotCronJob = new Cron(
      '45 16 * * 1-5',
      { timezone: 'America/New_York', protect: true },
      async () => {
        await runSnapshotJob(db);
      }
    );
    const nextRun = snapshotCronJob.nextRun();
    log.info('snapshot job registered', { cron: '45 16 * * 1-5', timezone: 'America/New_York', nextRun: nextRun?.toISOString() ?? null });
  } catch (err) {
    log.error('failed to register snapshot job', {
      error: err instanceof Error ? err.message : String(err),
    });
    snapshotCronJob = null;
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
