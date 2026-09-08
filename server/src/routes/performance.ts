import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { SnapshotsRepo } from '../repos/snapshotsRepo.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { AlpacaBroker } from '../brokers/alpacaBroker.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'performance-route' });

interface PerformancePoint {
  date: string;
  strategyReturn: number;
  benchmarkReturn: number;
}

interface PerformanceMetrics {
  totalStrategyReturn: number;
  totalBenchmarkReturn: number;
  strategyMaxDrawdown: number;
  benchmarkMaxDrawdown: number;
  sharpeRatio?: number;
  series: PerformancePoint[];
}

function calculateDrawdown(values: number[]): number {
  if (values.length === 0) return 0;

  let maxDrawdown = 0;
  let peak = values[0];

  for (const value of values) {
    if (value > peak) peak = value;
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return maxDrawdown;
}

function calculateSharpeRatio(returns: number[], riskFreeRate: number = 0): number {
  if (returns.length < 2) return 0;

  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;
  return (meanReturn - riskFreeRate) / stdDev * Math.sqrt(252);
}

/** GET /api/performance?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD */
export async function getPerformanceHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const db = getDatabase();
    const snapshotsRepo = new SnapshotsRepo(db);
    const pricesRepo = new PricesRepo(db);
    const priceService = new PriceService(pricesRepo);
    const positionsRepo = new PositionsRepo(db);
    const portfolioRepo = new PortfolioRepo(db);

    // Sync Alpaca data before calculating performance
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const alpacaAccount = await broker.getAccount();
        const alpacaPositions = await broker.getPositions();

        // Update local portfolio
        const currentPortfolio = portfolioRepo.read();
        if (currentPortfolio) {
          portfolioRepo.write({
            ...currentPortfolio,
            cashCents: alpacaAccount.cashCents,
          });
        }

        // Sync positions
        const alpacaSymbols = new Set(alpacaPositions.map(p => p.symbol));
        const localPositions = positionsRepo.listAll();
        for (const localPos of localPositions) {
          if (!alpacaSymbols.has(localPos.symbol) && localPos.qty !== 0) {
            positionsRepo.upsert({ ...localPos, qty: 0, updatedAt: Date.now() });
          }
        }
        for (const pos of alpacaPositions) {
          const existing = positionsRepo.get(pos.symbol);
          positionsRepo.upsert({
            symbol: pos.symbol,
            qty: pos.qty,
            avgCostCents: pos.avgCostCents,
            realizedPnlCents: existing?.realizedPnlCents ?? 0,
            openedAt: existing?.openedAt ?? Date.now(),
            updatedAt: Date.now(),
          });
        }
      } catch (err) {
        log.warn('failed to sync Alpaca data for performance', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const portfolioService = new PortfolioServiceImpl(db, priceService, positionsRepo, portfolioRepo);

    const fromDate = (req.query.fromDate as string) || '';
    const toDate = (req.query.toDate as string) || '';

    let portfolioSnapshots;
    let benchmarkSnapshots;

    if (fromDate && toDate) {
      portfolioSnapshots = snapshotsRepo.listPortfolioSnapshotsByDateRange(fromDate, toDate);
      benchmarkSnapshots = snapshotsRepo.listBenchmarkSnapshotsByDateRange('SPY', fromDate, toDate);
    } else {
      portfolioSnapshots = snapshotsRepo.listPortfolioSnapshots(252);
      benchmarkSnapshots = snapshotsRepo.listBenchmarkSnapshots('SPY', 252);
    }

    log.info('fetched snapshots', { portfolio: portfolioSnapshots.length, benchmark: benchmarkSnapshots.length });

    portfolioSnapshots.reverse();
    benchmarkSnapshots.reverse();

    const benchmarkMap = new Map<string, (typeof benchmarkSnapshots)[0]>();
    for (const snap of benchmarkSnapshots) {
      benchmarkMap.set(snap.asOfDate, snap);
    }

    const series: PerformancePoint[] = [];
    const strategyValues: number[] = [];
    const benchmarkValues: number[] = [];
    const dailyStrategyReturns: number[] = [];

    // Get cost base for performance calculation
    const costBaseCents = portfolioService.getCostBase();
    let initialStrategyValue: number | null = costBaseCents > 0 ? costBaseCents : null;
    let initialBenchmarkValue: number | null = null;

    for (const pSnapshot of portfolioSnapshots) {
      const bSnapshot = benchmarkMap.get(pSnapshot.asOfDate);
      if (!bSnapshot) {
        log.debug('no benchmark for date', { date: pSnapshot.asOfDate });
        continue;
      }

      if (initialBenchmarkValue === null) {
        initialBenchmarkValue = bSnapshot.adjCloseCents;
        log.debug('initialized values', { costBase: initialStrategyValue, benchmark: initialBenchmarkValue });
      }

      // Use cost base for strategy return calculation
      let strategyReturn = 0;
      if (initialStrategyValue !== null && initialStrategyValue > 0) {
        strategyReturn = (pSnapshot.totalValueCents - initialStrategyValue) / initialStrategyValue;
      }
      const benchmarkReturn = (bSnapshot.adjCloseCents - initialBenchmarkValue!) / initialBenchmarkValue!;

      series.push({
        date: pSnapshot.asOfDate,
        strategyReturn,
        benchmarkReturn,
      });

      strategyValues.push(pSnapshot.totalValueCents);
      benchmarkValues.push(bSnapshot.adjCloseCents);

      if (strategyValues.length > 1) {
        const dailyReturn =
          (pSnapshot.totalValueCents - strategyValues[strategyValues.length - 2]) /
          strategyValues[strategyValues.length - 2];
        dailyStrategyReturns.push(dailyReturn);
      }
    }

    log.info('calculated series', { points: series.length });

    const totalStrategyReturn =
      initialStrategyValue !== null && strategyValues.length > 0
        ? (strategyValues[strategyValues.length - 1] - initialStrategyValue) / initialStrategyValue
        : 0;
    const totalBenchmarkReturn =
      initialBenchmarkValue !== null && benchmarkValues.length > 0
        ? (benchmarkValues[benchmarkValues.length - 1] - initialBenchmarkValue) / initialBenchmarkValue
        : 0;

    const strategyMaxDrawdown = calculateDrawdown(strategyValues);
    const benchmarkMaxDrawdown = calculateDrawdown(benchmarkValues);
    const sharpeRatio = dailyStrategyReturns.length > 0 ? calculateSharpeRatio(dailyStrategyReturns) : undefined;

    const metrics: PerformanceMetrics = {
      totalStrategyReturn,
      totalBenchmarkReturn,
      strategyMaxDrawdown,
      benchmarkMaxDrawdown,
      ...(sharpeRatio !== undefined && { sharpeRatio }),
      series,
    };

    res.json({ ok: true, data: metrics });
  } catch (err) {
    log.error('performance request failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
