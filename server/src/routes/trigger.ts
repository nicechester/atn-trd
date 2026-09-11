/**
 * Cloud Scheduler trigger endpoints.
 * These endpoints are called by Cloud Scheduler with OIDC authentication.
 * Also supports manual triggers for each job type.
 */

import { Request, Response, NextFunction } from 'express';
import { getLlmLimits } from '@atn-trd/shared';
import { getDatabase } from '../db/index.js';
import { RunsRepo } from '../repos/runsRepo.js';
import { AssessmentsRepo } from '../repos/assessmentsRepo.js';
import { DecisionsRepo } from '../repos/decisionsRepo.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import { ArtifactsRepo } from '../repos/artifactsRepo.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { ScreenerSelectionsRepo } from '../repos/screenerSelectionsRepo.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { AlpacaBroker } from '../brokers/alpacaBroker.js';
import { RunCache } from '../datasources/cache.js';
import { createTradingCycleService } from '../services/tradingCycleService.js';
import { runScreener } from '../services/screenerOrchestrationService.js';
import { dataSourceRegistry } from '../datasources/registry.js';
import type { NewsDataSource } from '../datasources/news/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { MacroDataSource } from '../datasources/macro/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import { YahooSectorPerformance } from '../datasources/sectors/index.js';
import type { AnalystAgentDeps } from '../agent/analystAgent.js';
import { getSettings } from '../config/settingsService.js';
import { createEmbeddingService } from '../llm/embeddingService.js';
import { createSemanticMemoryService, type SemanticMemoryService } from '../services/semanticMemoryService.js';
import { resolveApiKey } from '../llm/openaiChatModel.js';
import { logger } from '../lib/logger.js';
import { runSnapshotJob } from '../scheduler/jobs/snapshot.js';
import { runSignalCollectionJob } from '../scheduler/jobs/signalCollection.js';
import { runRegimeDetectionJob } from '../scheduler/jobs/regimeDetection.js';
import { runPlanReviewJob } from '../scheduler/jobs/planReviewJob.js';
import { runTrancheExecutorJob } from '../scheduler/jobs/trancheExecutor.js';
import { runWatchlistCuration, backfillSectors } from '../services/watchlistCurationService.js';
import { JOB_REGISTRY, resolveExecutionOrder } from '@atn-trd/shared';
import { emitProgress } from '../services/runProgress.js';

const log = logger.child({ component: 'trigger-route' });

/**
 * Validate selected job IDs and return execution order with error handling.
 * @param jobIds - Array of job IDs to validate
 * @returns Object with valid flag and execution order or error message
 */
export function validateJobSelection(jobIds: unknown): {
  valid: boolean;
  executionOrder?: ReturnType<typeof resolveExecutionOrder>;
  error?: string;
} {
  if (!Array.isArray(jobIds)) {
    return { valid: false, error: 'jobIds must be an array' };
  }

  if (jobIds.length === 0) {
    return { valid: false, error: 'At least one job must be selected' };
  }

  const stringJobIds = jobIds.map(id => String(id));

  // Check for unknown job IDs
  const unknown = stringJobIds.filter(id => !JOB_REGISTRY[id as keyof typeof JOB_REGISTRY]);
  if (unknown.length > 0) {
    return { valid: false, error: `Unknown job IDs: ${unknown.join(', ')}` };
  }

  try {
    const executionOrder = resolveExecutionOrder(stringJobIds);
    return { valid: true, executionOrder };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : 'Failed to resolve execution order',
    };
  }
}

/**
 * Verify Cloud Scheduler OIDC token.
 * In production, validates the Authorization header contains a valid OIDC token
 * from Cloud Scheduler's service account.
 */
export function verifySchedulerAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth in development
  if (process.env.NODE_ENV !== 'production') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  // In production, Cloud Run automatically validates OIDC tokens when configured
  // with --ingress=internal or IAM invoker permissions. The token validation
  // is handled by Cloud Run's infrastructure, so if the request reaches here,
  // it's already authenticated.
  //
  // For additional validation, you can decode the JWT and verify:
  // - iss: https://accounts.google.com
  // - aud: your Cloud Run service URL
  // - email: your Cloud Scheduler service account
  next();
}

/** POST /api/trigger/trading-cycle - Called by Cloud Scheduler */
export async function triggerTradingCycleHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const startTime = Date.now();
  log.info('trading cycle triggered by scheduler');

  try {
    const db = getDatabase();
    const settings = getSettings();

    // repos
    const runsRepo = new RunsRepo(db);
    const assessmentsRepo = new AssessmentsRepo(db);
    const decisionsRepo = new DecisionsRepo(db);
    const ordersRepo = new OrdersRepo(db);
    const positionsRepo = new PositionsRepo(db);
    const portfolioRepo = new PortfolioRepo(db);
    const pricesRepo = new PricesRepo(db);
    const messagesRepo = new AgentMessagesRepo(db);
    const artifactsRepo = new ArtifactsRepo(db);
    const watchlistRepo = new WatchlistRepo(db);
    const screenerSelectionsRepo = new ScreenerSelectionsRepo(db);

    // semantic memory (optional)
    let semanticMemory: SemanticMemoryService | undefined;
    if (settings.semanticMemory.enabled && resolveApiKey()) {
      semanticMemory = createSemanticMemoryService(db, createEmbeddingService());
    }

    // services
    const priceService = new PriceService(pricesRepo);
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

    // agent deps
    const runCache = new RunCache();
    const sectorSource = new YahooSectorPerformance({ pricesRepo });
    const analystDeps: AnalystAgentDeps = {
      toolsDeps: {
        newsSource: dataSourceRegistry.get('news') as unknown as NewsDataSource,
        fundamentalsSource: dataSourceRegistry.get('fundamentals') as unknown as FundamentalsDataSource,
        macroSource: dataSourceRegistry.get('macro') as unknown as MacroDataSource,
        optionsSource: dataSourceRegistry.get('options') as unknown as OptionsDataSource,
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

    // Seed portfolio if needed
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
        screenerAgentDeps: { messagesRepo, artifactsRepo },
        toolsDeps: analystDeps.toolsDeps,
      },
      runScreener,
    });

    await tradingCycle.execute('scheduled');

    const latestRun = runsRepo.list(1, 0)[0];
    const durationMs = Date.now() - startTime;
    log.info('trading cycle completed', { runId: latestRun?.id, durationMs });

    res.json({ ok: true, runId: latestRun?.id, durationMs });
  } catch (err) {
    log.error('trading cycle failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}

/** POST /api/trigger/snapshot - Called by Cloud Scheduler */
export async function triggerSnapshotHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  log.info('snapshot triggered by scheduler');
  try {
    const db = getDatabase();
    await runSnapshotJob(db);
    res.json({ ok: true });
  } catch (err) {
    log.error('snapshot failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}

/** POST /api/trigger/signal-collection - Manual trigger for signal collection */
export async function triggerSignalCollectionHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  log.info('signal collection triggered manually');
  try {
    const db = getDatabase();
    const summary = await runSignalCollectionJob(db, 'manual');
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('signal collection failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}

/** POST /api/trigger/plan-review - Manual trigger for plan review */
export async function triggerPlanReviewHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  log.info('plan review triggered manually');
  try {
    const db = getDatabase();
    const summary = await runPlanReviewJob(db, 'manual');
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('plan review failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}

/** POST /api/trigger/tranche-execution - Manual trigger for tranche execution */
export async function triggerTrancheExecutionHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  log.info('tranche execution triggered manually');
  try {
    const db = getDatabase();
    const summary = await runTrancheExecutorJob(db, 'manual');
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('tranche execution failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}

/** POST /api/trigger/watchlist-curation - Manual trigger to run screener and populate watchlist */
export async function triggerWatchlistCurationHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  log.info('watchlist curation triggered manually');
  try {
    const db = getDatabase();
    const summary = await runWatchlistCuration(db);
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('watchlist curation failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}

/** POST /api/trigger/backfill-sectors - One-time backfill of sector data from Finnhub */
export async function triggerBackfillSectorsHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  log.info('sector backfill triggered manually');
  try {
    const db = getDatabase();
    const result = await backfillSectors(db);
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('sector backfill failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}

/** POST /api/trigger/run-selected - Selective job execution */
export async function triggerRunSelectedHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const startTime = Date.now();
  const db = getDatabase();
  const runsRepo = new RunsRepo(db);

  try {
    // Validate request body
    const { jobIds } = req.body;
    const validation = validateJobSelection(jobIds);

    if (!validation.valid) {
      res.status(400).json({ ok: false, error: validation.error });
      return;
    }

    const executionOrder: ReturnType<typeof resolveExecutionOrder> = validation.executionOrder || [];
    log.info('selective job execution triggered', { jobCount: executionOrder.length });

    // Create a parent run record for tracking the batch
    const parentRunId = runsRepo.create({
      trigger: 'manual',
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      model: null,
      settingsSnapshot: JSON.stringify({}),
      error: null,
      tokenUsageJson: null,
      skipReason: null,
      summaryJson: JSON.stringify({ selectedJobs: jobIds, executedJobs: [] }),
    });

    emitProgress(parentRunId, 'starting', `Starting selective job execution (${executionOrder.length} jobs)`);

    const runIds: string[] = [];
    const executedJobs: string[] = [];
    let lastError: string | null = null;

    // Execute jobs sequentially
    for (const job of executionOrder) {
      emitProgress(parentRunId, 'job-start', `Starting job: ${job.label}`, { jobId: job.id, jobName: job.label });

      try {
        let jobRunId: string | undefined;

        // Map job ID to handler and execute
        if (job.id === 'signal-collection') {
          await runSignalCollectionJob(db, 'signal_collection');
          const latestRun = runsRepo.listByTrigger('signal_collection', 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === 'regime-detection') {
          await runRegimeDetectionJob(db, 'regime_detection');
          const latestRun = runsRepo.listByTrigger('regime_detection', 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === 'plan-review') {
          await runPlanReviewJob(db, 'plan_review');
          const latestRun = runsRepo.listByTrigger('plan_review', 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === 'tranche-execution') {
          await runTrancheExecutorJob(db, 'tranche_execution');
          const latestRun = runsRepo.listByTrigger('tranche_execution', 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === 'watchlist-curation') {
          await runWatchlistCuration(db);
          const latestRun = runsRepo.listByTrigger('watchlist_curation', 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === 'snapshot') {
          await runSnapshotJob(db);
          const latestRun = runsRepo.listByTrigger('snapshot', 1)[0];
          jobRunId = latestRun?.id;
        }

        if (jobRunId) {
          runIds.push(jobRunId);
          executedJobs.push(job.id);
          const jobRun = runsRepo.get(jobRunId);
          const jobStatus = jobRun?.status || 'unknown';

          if (jobStatus === 'failed' || jobStatus === 'skipped') {
            lastError = jobRun?.error || jobRun?.skipReason || `Job failed: ${job.id}`;
            emitProgress(parentRunId, 'job-complete', `Job failed: ${job.label}`, { jobId: job.id, jobName: job.label });

            // Cascade skip dependent jobs
            for (const remainingJob of executionOrder) {
              if (executionOrder.indexOf(remainingJob) > executionOrder.indexOf(job)) {
                const deps = JOB_REGISTRY[remainingJob.id as keyof typeof JOB_REGISTRY]?.dependencies || [];
                if (deps.includes(job.id)) {
                  emitProgress(parentRunId, 'job-complete', `Skipped (dependency failed): ${remainingJob.label}`, { jobId: remainingJob.id, jobName: remainingJob.label });
                }
              }
            }
            break;
          } else {
            emitProgress(parentRunId, 'job-complete', `Completed: ${job.label}`, { jobId: job.id, jobName: job.label });
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log.error(`Job execution failed: ${job.id}`, { error: lastError });
        emitProgress(parentRunId, 'job-complete', `Error: ${lastError}`, { jobId: job.id, jobName: job.label });

        // Cascade skip dependent jobs
        for (const remainingJob of executionOrder) {
          if (executionOrder.indexOf(remainingJob) > executionOrder.indexOf(job)) {
            const deps = JOB_REGISTRY[remainingJob.id as keyof typeof JOB_REGISTRY]?.dependencies || [];
            if (deps.includes(job.id)) {
              emitProgress(parentRunId, 'job-complete', `Skipped (dependency failed): ${remainingJob.label}`, { jobId: remainingJob.id, jobName: remainingJob.label });
            }
          }
        }
        break;
      }
    }

    // Update parent run with results
    const finalStatus = lastError ? 'failed' : 'succeeded';
    runsRepo.updateStatus(parentRunId, finalStatus, lastError || undefined);
    runsRepo.updateSummary(parentRunId, JSON.stringify({
      selectedJobs: jobIds,
      executedJobs,
      completedSuccessfully: !lastError,
      error: lastError,
    }));

    emitProgress(parentRunId, 'complete', `Job execution ${finalStatus}`, { jobId: parentRunId });

    const durationMs = Date.now() - startTime;
    log.info('selective job execution completed', { runIds, durationMs, finalStatus });

    res.json({
      ok: !lastError,
      runIds,
      executionOrder: executionOrder.map(job => ({
        id: job.id,
        label: job.label,
        description: job.description,
        estimatedRuntimeSeconds: job.estimatedRuntimeSeconds,
      })),
      error: lastError || undefined,
    });
  } catch (err) {
    log.error('selective job execution handler failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
