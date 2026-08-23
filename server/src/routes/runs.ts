import { Request, Response, NextFunction } from 'express';
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
import { CalibrationRepo } from '../repos/calibrationRepo.js';
import { RejectionsRepo } from '../repos/rejectionsRepo.js';
import { ScreenerSelectionsRepo } from '../repos/screenerSelectionsRepo.js';
import { NotFoundError } from '../lib/errors.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { CoverageServiceImpl } from '../services/coverageService.js';
import { PaperBroker } from '../brokers/paperBroker.js';
import { RunCache } from '../datasources/cache.js';
import { createTradingCycleService } from '../services/tradingCycleService.js';
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

const log = logger.child({ component: 'runs-route' });

/** GET /api/runs?limit=50&offset=0 */
export function listRunsHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10), 1), 200);
    const offset = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);

    const db = getDatabase();
    const runsRepo = new RunsRepo(db);
    const runs = runsRepo.list(limit, offset);

    res.json({ ok: true, data: runs });
  } catch (err) {
    next(err);
  }
}

/** GET /api/runs/:id */
export function getRunHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { id } = req.params;

    const db = getDatabase();
    const runsRepo = new RunsRepo(db);
    const assessmentsRepo = new AssessmentsRepo(db);
    const decisionsRepo = new DecisionsRepo(db);
    const ordersRepo = new OrdersRepo(db);
    const fillsRepo = new FillsRepo(db);
    const messagesRepo = new AgentMessagesRepo(db);
    const artifactsRepo = new ArtifactsRepo(db);
    const rejectionsRepo = new RejectionsRepo(db);
    const screenerSelectionsRepo = new ScreenerSelectionsRepo(db);

    const run = runsRepo.get(id);
    if (!run) {
      throw new NotFoundError(`Run "${id}" not found`);
    }

    const assessments = assessmentsRepo.listByRun(id);
    const decisions = decisionsRepo.listByRun(id);
    const orders = ordersRepo.listByRun(id);
    const messages = messagesRepo.listByRun(id);
    const artifacts = artifactsRepo.listByRun(id);
    const rejections = rejectionsRepo.listByRun(id);
    const screenerSelections = screenerSelectionsRepo.listByRun(id);

    // For each order, fetch its fills
    const ordersWithFills = orders.map(order => ({
      ...order,
      fills: fillsRepo.listByOrder(order.id),
    }));

    res.json({
      ok: true,
      data: {
        run,
        assessments,
        decisions,
        orders: ordersWithFills,
        rejections,
        messages,
        artifacts,
        screenerSelections,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/runs/:id/coverage */
export function getRunCoverageHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { id } = req.params;

    const db = getDatabase();
    const runsRepo = new RunsRepo(db);
    const artifactsRepo = new ArtifactsRepo(db);
    const assessmentsRepo = new AssessmentsRepo(db);

    const run = runsRepo.get(id);
    if (!run) {
      throw new NotFoundError(`Run "${id}" not found`);
    }

    const coverageService = new CoverageServiceImpl(artifactsRepo, assessmentsRepo);
    const coverage = coverageService.getCoverage(id);

    res.json(coverage);
  } catch (err) {
    next(err);
  }
}

/** POST /api/runs */
export async function triggerRunHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
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
    const calibrationRepo = new CalibrationRepo(db);

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
      calibrationRepo,
      semanticMemory,
    });

    await tradingCycle.execute('manual');

    // After executing, get the most recent run to return its id
    const latestRun = runsRepo.list(1, 0)[0];
    if (!latestRun) {
      throw new Error('Failed to retrieve created run');
    }

    res.json({ ok: true, runId: latestRun.id });
  } catch (err) {
    next(err);
  }
}

/** GET /api/runs/:id/coverage */
export function getCoverageHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { id } = req.params;

    const db = getDatabase();
    const runsRepo = new RunsRepo(db);
    const artifactsRepo = new ArtifactsRepo(db);
    const assessmentsRepo = new AssessmentsRepo(db);

    const run = runsRepo.get(id);
    if (!run) {
      throw new NotFoundError(`Run "${id}" not found`);
    }

    const coverageService = new CoverageServiceImpl(artifactsRepo, assessmentsRepo);
    const coverage = coverageService.getCoverage(id);

    res.json(coverage);
  } catch (err) {
    next(err);
  }
}

/** POST /api/runs/:id/cancel */
export function cancelRunHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { id } = req.params;

    const db = getDatabase();
    const runsRepo = new RunsRepo(db);

    const run = runsRepo.get(id);
    if (!run) {
      throw new NotFoundError(`Run "${id}" not found`);
    }

    if (run.status !== 'running') {
      res.status(400).json({ ok: false, error: `Run is not running (status: ${run.status})` });
      return;
    }

    runsRepo.updateStatus(id, 'failed', 'cancelled by user');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
