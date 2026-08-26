/**
 * Cloud Scheduler trigger endpoints.
 * These endpoints are called by Cloud Scheduler with OIDC authentication.
 */

import { Request, Response, NextFunction } from 'express';
import { getLlmLimits } from '@atn-trd/shared';
import { getDatabase } from '../db/index.js';
import { RunsRepo } from '../repos/runsRepo.js';
import { AssessmentsRepo } from '../repos/assessmentsRepo.js';
import { DecisionsRepo } from '../repos/decisionsRepo.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { AgentMessagesRepo } from '../repos/agentMessagesRepo.js';
import { ArtifactsRepo } from '../repos/artifactsRepo.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { ScreenerSelectionsRepo } from '../repos/screenerSelectionsRepo.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { PaperBroker } from '../brokers/paperBroker.js';
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
import { runMarketOpenFillJob } from '../scheduler/jobs/marketOpenFill.js';

const log = logger.child({ component: 'trigger-route' });

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
    const fillsRepo = new FillsRepo(db);
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
    const broker = new PaperBroker(
      db, priceService, ordersRepo, fillsRepo, positionsRepo, portfolioRepo,
      { fillModel: settings.paperAccount.fillModel, slippageBps: settings.paperAccount.slippageBps },
      semanticMemory ? { decisionsRepo, assessmentsRepo, semanticMemory } : undefined
    );

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

/** POST /api/trigger/market-open-fill - Called by Cloud Scheduler at 9:30 AM ET */
export async function triggerMarketOpenFillHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  log.info('market-open-fill triggered by scheduler');
  try {
    const db = getDatabase();
    const settings = getSettings();
    await runMarketOpenFillJob(db, { slippageBps: settings.paperAccount.slippageBps });
    res.json({ ok: true });
  } catch (err) {
    log.error('market-open-fill failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
