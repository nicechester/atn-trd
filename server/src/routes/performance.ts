import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { SnapshotsRepo } from '../repos/snapshotsRepo.js';
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

    let initialStrategyValue: number | null = null;
    let initialBenchmarkValue: number | null = null;

    for (const pSnapshot of portfolioSnapshots) {
      const bSnapshot = benchmarkMap.get(pSnapshot.asOfDate);
      if (!bSnapshot) {
        log.debug('no benchmark for date', { date: pSnapshot.asOfDate });
        continue;
      }

      if (initialStrategyValue === null) {
        initialStrategyValue = pSnapshot.totalValueCents;
        initialBenchmarkValue = bSnapshot.adjCloseCents;
        log.debug('initialized values', { strategy: initialStrategyValue, benchmark: initialBenchmarkValue });
      }

      const strategyReturn = (pSnapshot.totalValueCents - initialStrategyValue!) / initialStrategyValue!;
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
