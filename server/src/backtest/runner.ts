/**
 * BacktestRunner: Replays historical data through the trading pipeline.
 */

import type Database from 'better-sqlite3';
import type { Settings } from '@atn-trd/shared';
import { BacktestRepo } from '../repos/backtestRepo.js';
import { MockBroker, type HistoricalPriceProvider } from '../brokers/mockBroker.js';
import { calculateMetrics } from './metrics.js';
import { logger } from '../lib/logger.js';
import { nextTradingDateStr, isTradingDayStr } from '../scheduler/marketCalendar.js';

const log = logger.child({ component: 'backtest-runner' });

export interface BacktestConfig {
  backtestId?: string; // If provided, use existing record instead of creating new
  name?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  symbols: string[];
  startingCashCents?: number;
  slippageBps?: number;
}

export interface BacktestResult {
  backtestId: string;
  status: 'succeeded' | 'failed';
  error?: string;
  metrics?: {
    totalReturn: number;
    benchmarkReturn: number;
    sharpeRatio: number | null;
    sortinoRatio: number | null;
    maxDrawdown: number;
    winRate: number | null;
    totalTrades: number;
  };
}

export interface BacktestDeps {
  db: Database.Database;
  priceProvider: HistoricalPriceProvider;
  getBenchmarkPrice: (date: string) => Promise<number | null>; // SPY close in cents
  runTradingLogic: (params: {
    date: string;
    symbols: string[];
    broker: MockBroker;
    settings: Settings;
  }) => Promise<void>;
  settings: Settings;
}

export class BacktestRunner {
  private readonly repo: BacktestRepo;
  private readonly deps: BacktestDeps;

  constructor(deps: BacktestDeps) {
    this.deps = deps;
    this.repo = new BacktestRepo(deps.db);
  }

  async run(config: BacktestConfig): Promise<BacktestResult> {
    // Use existing backtestId or create new
    const backtestId = config.backtestId ?? this.repo.createRun({
      name: config.name,
      startDate: config.startDate,
      endDate: config.endDate,
      symbols: config.symbols,
      settingsSnapshot: JSON.stringify(this.deps.settings),
    });

    log.info('starting backtest', {
      backtestId,
      startDate: config.startDate,
      endDate: config.endDate,
      symbols: config.symbols.length,
    });

    const broker = new MockBroker(this.deps.priceProvider, {
      startingCashCents: config.startingCashCents ?? 100_000_00,
      slippageBps: config.slippageBps ?? 5,
    });

    try {
      // Get initial benchmark price
      const initialBenchmark = await this.deps.getBenchmarkPrice(config.startDate);

      // Record initial snapshot
      const initialValue = await broker.getPortfolioValue(config.startDate);
      this.repo.createSnapshot({
        backtestId,
        asOfDate: config.startDate,
        cashCents: broker.getCashCents(),
        positions: broker.getPositionsSnapshot(),
        totalValueCents: initialValue,
        benchmarkValueCents: initialBenchmark ?? undefined,
      });

      // Iterate through each trading day (start after initial snapshot)
      let currentDate = nextTradingDateStr(config.startDate);
      while (currentDate <= config.endDate) {
        if (isTradingDayStr(currentDate)) {
          broker.setCurrentDate(currentDate);

          // Run trading logic for this day
          await this.deps.runTradingLogic({
            date: currentDate,
            symbols: config.symbols,
            broker,
            settings: this.deps.settings,
          });

          // Record any trades that occurred
          const orders = await broker.listOrders({ status: ['filled'] });
          for (const order of orders) {
            if (order.status === 'filled') {
              this.repo.createTrade({
                backtestId,
                tradeDate: currentDate,
                symbol: order.symbol,
                side: order.side,
                qty: order.qty,
                priceCents: order.fillPriceCents ?? order.limitPriceCents ?? 0,
              });
            }
          }

          // Record end-of-day snapshot
          const portfolioValue = await broker.getPortfolioValue(currentDate);
          const benchmarkPrice = await this.deps.getBenchmarkPrice(currentDate);

          this.repo.createSnapshot({
            backtestId,
            asOfDate: currentDate,
            cashCents: broker.getCashCents(),
            positions: broker.getPositionsSnapshot(),
            totalValueCents: portfolioValue,
            benchmarkValueCents: benchmarkPrice ?? undefined,
          });

          log.debug('backtest day complete', {
            backtestId,
            date: currentDate,
            portfolioValue: portfolioValue / 100,
          });
        }

        currentDate = nextTradingDateStr(currentDate);
      }

      // Calculate metrics
      const snapshots = this.repo.getSnapshots(backtestId);
      const trades = this.repo.getTrades(backtestId);
      const metrics = calculateMetrics({ backtestId, snapshots, trades });
      this.repo.saveMetrics(metrics);

      this.repo.updateRunStatus(backtestId, 'succeeded');

      log.info('backtest complete', {
        backtestId,
        totalReturn: (metrics.totalReturn * 100).toFixed(2) + '%',
        benchmarkReturn: (metrics.benchmarkReturn * 100).toFixed(2) + '%',
        sharpeRatio: metrics.sharpeRatio?.toFixed(2),
        maxDrawdown: (metrics.maxDrawdown * 100).toFixed(2) + '%',
        totalTrades: metrics.totalTrades,
      });

      return {
        backtestId,
        status: 'succeeded',
        metrics: {
          totalReturn: metrics.totalReturn,
          benchmarkReturn: metrics.benchmarkReturn,
          sharpeRatio: metrics.sharpeRatio,
          sortinoRatio: metrics.sortinoRatio,
          maxDrawdown: metrics.maxDrawdown,
          winRate: metrics.winRate,
          totalTrades: metrics.totalTrades,
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.repo.updateRunStatus(backtestId, 'failed', errorMsg);
      log.error('backtest failed', { backtestId, error: errorMsg });

      return {
        backtestId,
        status: 'failed',
        error: errorMsg,
      };
    }
  }

  getResult(backtestId: string): BacktestResult | null {
    const run = this.repo.getRun(backtestId);
    if (!run) return null;

    const metrics = this.repo.getMetrics(backtestId);

    return {
      backtestId,
      status: run.status === 'running' ? 'failed' : run.status,
      error: run.error ?? undefined,
      metrics: metrics ? {
        totalReturn: metrics.totalReturn,
        benchmarkReturn: metrics.benchmarkReturn,
        sharpeRatio: metrics.sharpeRatio,
        sortinoRatio: metrics.sortinoRatio,
        maxDrawdown: metrics.maxDrawdown,
        winRate: metrics.winRate,
        totalTrades: metrics.totalTrades,
      } : undefined,
    };
  }

  listRuns(limit = 20) {
    return this.repo.listRuns(limit);
  }
}
