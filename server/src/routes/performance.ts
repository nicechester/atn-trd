import { Request, Response, NextFunction } from 'express';
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

function calculateSharpeRatio(returns: number[]): number {
  if (returns.length < 2) return 0;
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (meanReturn / stdDev) * Math.sqrt(252);
}

async function fetchSPYPrices(
  apiKey: string,
  apiSecret: string,
  startDate: string
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  let pageToken: string | null = null;

  do {
    const url = new URL('https://data.alpaca.markets/v2/stocks/SPY/bars');
    url.searchParams.set('timeframe', '1Day');
    url.searchParams.set('start', startDate);
    url.searchParams.set('limit', '1000');
    if (pageToken) url.searchParams.set('page_token', pageToken);

    const res = await fetch(url.toString(), {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': apiSecret,
      },
    });

    if (!res.ok) {
      log.warn('failed to fetch SPY bars', { status: res.status });
      break;
    }

    const data = await res.json();
    for (const bar of data.bars || []) {
      const date = bar.t.split('T')[0];
      map.set(date, bar.c);
    }
    pageToken = data.next_page_token || null;
  } while (pageToken);

  return map;
}

/** GET /api/performance?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD */
export async function getPerformanceHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;

    if (!apiKey || !apiSecret) {
      res.status(500).json({ ok: false, error: 'Alpaca credentials not configured' });
      return;
    }

    const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });

    // Fetch portfolio history from Alpaca
    const history = await broker.getPortfolioHistory('3M', '1D');

    if (history.points.length === 0) {
      res.json({
        ok: true,
        data: {
          totalStrategyReturn: 0,
          totalBenchmarkReturn: 0,
          strategyMaxDrawdown: 0,
          benchmarkMaxDrawdown: 0,
          series: [],
        },
      });
      return;
    }

    // Get date range from portfolio history
    const firstDate = new Date(history.points[0].timestamp * 1000).toISOString().split('T')[0];

    // Fetch SPY benchmark data
    const spyPrices = await fetchSPYPrices(apiKey, apiSecret, firstDate);

    // Build series
    const series: PerformancePoint[] = [];
    const strategyValues: number[] = [];
    const benchmarkValues: number[] = [];
    const dailyReturns: number[] = [];

    const baseValue = history.points[0].equity;
    let initialSPY: number | null = null;

    // Apply date filters if provided
    const fromDate = req.query.fromDate as string | undefined;
    const toDate = req.query.toDate as string | undefined;

    for (const point of history.points) {
      const date = new Date(point.timestamp * 1000).toISOString().split('T')[0];

      // Apply date filters
      if (fromDate && date < fromDate) continue;
      if (toDate && date > toDate) continue;

      const spyPrice = spyPrices.get(date);
      if (!spyPrice) continue;

      if (initialSPY === null) initialSPY = spyPrice;

      const strategyReturn = (point.equity - baseValue) / baseValue;
      const benchmarkReturn = (spyPrice - initialSPY) / initialSPY;

      series.push({ date, strategyReturn, benchmarkReturn });
      strategyValues.push(point.equity);
      benchmarkValues.push(spyPrice);

      if (strategyValues.length > 1) {
        const prevEquity = strategyValues[strategyValues.length - 2];
        dailyReturns.push((point.equity - prevEquity) / prevEquity);
      }
    }

    const totalStrategyReturn = series.length > 0
      ? series[series.length - 1].strategyReturn
      : 0;
    const totalBenchmarkReturn = series.length > 0
      ? series[series.length - 1].benchmarkReturn
      : 0;

    const metrics: PerformanceMetrics = {
      totalStrategyReturn,
      totalBenchmarkReturn,
      strategyMaxDrawdown: calculateDrawdown(strategyValues),
      benchmarkMaxDrawdown: calculateDrawdown(benchmarkValues),
      sharpeRatio: calculateSharpeRatio(dailyReturns),
      series,
    };

    log.info('performance calculated from Alpaca', {
      points: series.length,
      strategyReturn: `${(totalStrategyReturn * 100).toFixed(2)}%`,
      benchmarkReturn: `${(totalBenchmarkReturn * 100).toFixed(2)}%`,
    });

    res.json({ ok: true, data: metrics });
  } catch (err) {
    log.error('performance request failed', { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
