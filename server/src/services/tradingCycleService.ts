import type { RunsRepo } from '../repos/runsRepo.js';
import type { AssessmentsRepo } from '../repos/assessmentsRepo.js';
import type { DecisionsRepo } from '../repos/decisionsRepo.js';
import type { OrdersRepo } from '../repos/ordersRepo.js';
import type { WatchlistRepo } from '../repos/watchlistRepo.js';
import type { CalibrationRepo } from '../repos/calibrationRepo.js';
import { RejectionsRepo } from '../repos/rejectionsRepo.js';
import type { PortfolioService } from './portfolioService.js';
import type { SemanticMemoryService } from './semanticMemoryService.js';
import type { Broker } from '../brokers/types.js';
import type { AnalystAgentDeps } from '../agent/analystAgent.js';
import type { RiskPriceFeed } from './riskService.js';
import type { Settings } from '@atn-trd/shared';
import type Database from 'better-sqlite3';
import type { SymbolAssessment } from '../agent/analystAgent.js';
import { runAnalystAgent } from '../agent/analystAgent.js';
import { prefetchForSymbol } from '../agent/tools.js';
import { runPortfolioManagerAgent } from '../agent/portfolioManagerAgent.js';
import type { PortfolioContext, PortfolioConstraints } from '../agent/portfolioManagerAgent.js';
import { createRiskService, type RiskConstraints } from './riskService.js';
import { isTradingDay } from '../scheduler/marketCalendar.js';
import { logger } from '../lib/logger.js';
import { emitProgress } from './runProgress.js';
import type { OrderRequest } from '../brokers/types.js';
import type { Decision } from '@atn-trd/shared';

const log = logger.child({ component: 'trading-cycle' });

const RUN_TIMEOUT_MS = 60 * 60 * 1000;
const ANALYST_CONCURRENCY = 7;

/**
 * Run items with bounded concurrency.
 * Distributes work evenly across a limited number of workers.
 */
async function runWithConcurrency<T>(
  items: string[],
  limit: number,
  fn: (item: string) => Promise<T>
): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export interface TradingCycleDeps {
  db: Database.Database;
  runsRepo: RunsRepo;
  assessmentsRepo: AssessmentsRepo;
  decisionsRepo: DecisionsRepo;
  ordersRepo: OrdersRepo;
  portfolioService: PortfolioService;
  broker: Broker;
  analystDeps: AnalystAgentDeps;
  priceFeed: RiskPriceFeed;
  getSettings: () => Settings;
  watchlistRepo: WatchlistRepo;
  calibrationRepo?: CalibrationRepo;
  semanticMemory?: SemanticMemoryService;
}

export interface TradingCycleService {
  execute(trigger: 'scheduled' | 'manual'): Promise<void>;
}

export function createTradingCycleService(deps: TradingCycleDeps): TradingCycleService {
  return new TradingCycleServiceImpl(deps);
}

class TradingCycleServiceImpl implements TradingCycleService {
  constructor(private readonly deps: TradingCycleDeps) {}

  async execute(trigger: 'scheduled' | 'manual'): Promise<void> {
    // -- Step A: Pre-run guards ----------------------------------------
    const settings = this.deps.getSettings();

    if (settings.trading.killSwitch) {
      const id = this.deps.runsRepo.create({
        trigger,
        status: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        model: settings.llm.model,
        settingsSnapshot: JSON.stringify(settings),
        error: null,
        tokenUsageJson: null,
        skipReason: null,
      });
      this.deps.runsRepo.setSkipped(id, 'kill switch is active');
      return;
    }

    if (!settings.trading.enabled) {
      const id = this.deps.runsRepo.create({
        trigger,
        status: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        model: settings.llm.model,
        settingsSnapshot: JSON.stringify(settings),
        error: null,
        tokenUsageJson: null,
        skipReason: null,
      });
      this.deps.runsRepo.setSkipped(id, 'trading is disabled');
      return;
    }

    if (trigger !== 'manual' && !isTradingDay(new Date())) {
      const id = this.deps.runsRepo.create({
        trigger,
        status: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        model: settings.llm.model,
        settingsSnapshot: JSON.stringify(settings),
        error: null,
        tokenUsageJson: null,
        skipReason: null,
      });
      this.deps.runsRepo.setSkipped(id, 'not a trading day');
      return;
    }

    // -- Step B: Run lock ----------------------------------------------
    const recentRuns = this.deps.runsRepo.list(10);
    const activeRun = recentRuns.find(r => r.status === 'running');
    if (activeRun) {
      if (Date.now() - activeRun.startedAt > RUN_TIMEOUT_MS) {
        this.deps.runsRepo.updateStatus(activeRun.id, 'failed', 'run timed out (stale lock)');
        // continue normally
      } else {
        log.warn('another run is active, skipping', { activeRunId: activeRun.id });
        return; // no new run record
      }
    }

    // -- Step C: Create run record -------------------------------------
    const runId = this.deps.runsRepo.create({
      trigger,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
      model: settings.llm.model,
      settingsSnapshot: JSON.stringify(settings),
      error: null,
      tokenUsageJson: null,
      skipReason: null,
    });

    // From here — try/catch wrapper
    try {
      // -- Step C1: Process pending orders from prior session ---------
      if (this.deps.broker.processPendingOrders) {
        try {
          await this.deps.broker.processPendingOrders();
        } catch (err) {
          log.warn('processPendingOrders failed', {
            runId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // -- Step D: Snapshot portfolio --------------------------------
      const portfolio = await this.deps.portfolioService.getPortfolio();

      // -- Step E: Get symbols ---------------------------------------
      const symbols = this.deps.watchlistRepo.list()
        .filter(s => s.enabled)
        .map(s => s.symbol);

      if (symbols.length === 0) {
        this.deps.runsRepo.setSkipped(runId, 'watchlist is empty');
        return;
      }

      // -- Step F: Prefetch data for all symbols concurrently --------
      const llmConfig = { model: settings.llm.model, temperature: settings.llm.temperature };
      emitProgress(runId, 'analyst', `Prefetching data for ${symbols.length} symbols`);
      await Promise.all(symbols.map(symbol => prefetchForSymbol(symbol, this.deps.analystDeps.toolsDeps)));

      // -- Step G: Run analysts (bounded concurrency) ----------------
      emitProgress(runId, 'analyst', `Starting analysis for ${symbols.length} symbols`);

      const rawResults = await runWithConcurrency(symbols, ANALYST_CONCURRENCY, async (symbol) => {
        try {
          return await runAnalystAgent(runId, symbol, this.deps.analystDeps, llmConfig);
        } catch (err) {
          log.warn('analyst agent threw unexpectedly', {
            symbol,
            runId,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        }
      });

      const assessments = rawResults.filter((a): a is SymbolAssessment => a !== null);
      log.info('analyst phase complete', {
        runId,
        total: symbols.length,
        succeeded: assessments.length,
      });

      if (assessments.length === 0) {
        this.deps.runsRepo.updateStatus(runId, 'failed', 'all analyst agents failed');
        return;
      }

      // -- Step G: Persist assessments -------------------------------
      const assessmentIdBySymbol = new Map<string, string>();
      for (const a of assessments) {
        const id = this.deps.assessmentsRepo.create({
          runId,
          symbol: a.symbol,
          score: a.score,
          confidence: a.confidence,
          thesis: a.thesis,
          risks: a.risks ?? null,
          catalysts: a.catalysts ?? null,
          evidenceIdsJson: null,
        });
        assessmentIdBySymbol.set(a.symbol, id);

        // Store embedding for semantic memory (fire-and-forget)
        if (this.deps.semanticMemory) {
          this.deps.semanticMemory.storeAssessmentEmbedding({
            assessmentId: id,
            runId,
            symbol: a.symbol,
            score: a.score,
            thesis: a.thesis,
            risks: a.risks,
            catalysts: a.catalysts,
          }).catch(err => {
            log.warn('failed to store assessment embedding', {
              assessmentId: id,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }
      }

      // -- Step H: Build portfolio context and constraints -----------
      const portfolioContext: PortfolioContext = {
        cashPercent:
          portfolio.totalValueCents > 0
            ? (portfolio.cashCents / portfolio.totalValueCents) * 100
            : 100,
        currentPositions: portfolio.positions.map(p => p.symbol),
        positionCount: portfolio.positions.length,
      };

      const portfolioConstraints: PortfolioConstraints = {
        maxPositionWeightPercent: settings.risk.maxPositionWeightPercent,
        maxConcurrentPositions: settings.risk.maxConcurrentPositions,
        maxNewPositionsPerRun: settings.risk.maxNewPositionsPerRun,
        minCashReservePercent: settings.risk.minCashReservePercent,
        minConfidenceThreshold: settings.risk.minConfidenceThreshold,
        symbolBlocklist: settings.risk.symbolBlocklist,
      };

      // -- Step I: Portfolio manager ------------------------------
      emitProgress(runId, 'portfolio-manager', 'Portfolio manager making decisions');
      const decisionSet = await runPortfolioManagerAgent(
        runId,
        assessments,
        portfolioContext,
        portfolioConstraints,
        llmConfig
      );

      if (!decisionSet) {
        this.deps.runsRepo.updateStatus(runId, 'failed', 'portfolio manager returned no decisions');
        return;
      }

      // -- Step J: Persist decisions --------------------------------
      const persistedDecisions: Decision[] = decisionSet.decisions.map(d => {
        const id = this.deps.decisionsRepo.create({
          runId,
          symbol: d.symbol,
          action: d.action,
          targetWeight: d.targetWeight ?? null,
          confidence: d.confidence,
          rationale: d.rationale,
          assessmentId: assessmentIdBySymbol.get(d.symbol) ?? null,
        });
        return { ...d, id };
      });

      const decisionSetWithIds = { decisions: persistedDecisions, timestamp: decisionSet.timestamp };

      // -- Step J2: Record calibration baselines ------------------------
      if (this.deps.calibrationRepo) {
        for (const d of persistedDecisions) {
          const predictedDirection: 'long' | 'short' | 'hold' =
            d.action === 'buy' || d.action === 'add'
              ? 'long'
              : d.action === 'sell' || d.action === 'trim'
              ? 'short'
              : 'hold';

          this.deps.calibrationRepo.create({
            runId,
            symbol: d.symbol,
            predictedDirection,
            confidence: d.confidence,
          });
        }
      }

      // -- Step K: Risk engine ----------------------------------
      emitProgress(runId, 'risk', 'Evaluating risk constraints');
      const riskConstraints: RiskConstraints = {
        maxPositionWeightPercent: settings.risk.maxPositionWeightPercent,
        maxConcurrentPositions: settings.risk.maxConcurrentPositions,
        maxNewPositionsPerRun: settings.risk.maxNewPositionsPerRun,
        minCashReservePercent: settings.risk.minCashReservePercent,
        maxOrderNotionalCents: settings.risk.maxOrderNotionalCents,
        minConfidenceThreshold: settings.risk.minConfidenceThreshold,
        symbolBlocklist: settings.risk.symbolBlocklist,
        broker: settings.trading.mode,
      };

      const riskService = createRiskService(riskConstraints, this.deps.priceFeed);
      const { orders, rejections } = await riskService.evaluate({
        decisionSet: decisionSetWithIds,
        portfolio,
        runId,
        earningsBlackoutSymbols: undefined,
      });

      // Persist rejections to database
      const rejectionsRepo = new RejectionsRepo(this.deps.db);
      for (const r of rejections) {
        rejectionsRepo.create(r, runId);
        log.debug('order rejected', { symbol: r.symbol, reason: r.reason });
      }

      // -- Step L: Submit orders ------------------------------------
      let ordersSubmitted = 0;
      for (const proposal of orders) {
        try {
          const req: OrderRequest = {
            clientOrderId: proposal.order.clientOrderId,
            symbol: proposal.order.symbol,
            side: proposal.order.side,
            qty: proposal.order.qty,
            type: proposal.order.type,
            tif: proposal.order.tif,
          };
          const orderState = await this.deps.broker.submitOrder(req);
          this.deps.ordersRepo.updateRunContext(orderState.id, proposal.order.decisionId ?? null, runId);
          ordersSubmitted++;
          log.info('order submitted', {
            runId,
            symbol: proposal.order.symbol,
            side: proposal.order.side,
            qty: proposal.order.qty,
            status: orderState.status,
          });
        } catch (err) {
          log.warn('order submission failed', {
            symbol: proposal.order.symbol,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // -- Step M: Mark succeeded -----------------------------------
      this.deps.runsRepo.updateStatus(runId, 'succeeded');
      emitProgress(runId, 'complete', `Run complete: ${ordersSubmitted} orders submitted`);
      log.info('trading cycle complete', {
        runId,
        ordersSubmitted,
        totalOrders: orders.length,
        rejections: rejections.length,
      });
    } catch (err) {
      this.deps.runsRepo.updateStatus(
        runId,
        'failed',
        err instanceof Error ? err.message : String(err)
      );
      log.error('trading cycle failed', {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
