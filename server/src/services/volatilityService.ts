/**
 * Volatility calculation service.
 *
 * Computes historical volatility (20-day and 60-day annualized) from price history,
 * fetches beta from fundamentals, and implied volatility from options chain.
 * Combines all metrics into a single VolatilityMetrics object.
 */

import { YahooFundamentalsDataSource } from '../datasources/fundamentals/yahooFundamentals.js';
import { YahooOptionsDataSource } from '../datasources/options/yahooOptions.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'volatility-service' });

/**
 * Volatility metrics for a symbol.
 */
export interface VolatilityMetrics {
  symbol: string;
  /** 20-day annualized historical volatility */
  historicalVol20d: number | null;
  /** 60-day annualized historical volatility */
  historicalVol60d: number | null;
  /** Beta from fundamentals (null if unavailable) */
  beta: number | null;
  /** Implied volatility from ATM option (null if unavailable) */
  impliedVol: number | null;
}

interface YahooFinanceModule {
  chart(
    symbol: string,
    queryOptions?: Record<string, unknown>,
    moduleOptions?: Record<string, unknown>
  ): Promise<unknown>;
  suppressNotices?(notices: string[]): void;
}

let cachedChartFn:
  | ((symbol: string, range: string, interval: string) => Promise<YahooChartRaw | null | undefined>)
  | null = null;

/** Lazy-loaded yahoo-finance2 chart function */
const defaultChartFn = async (
  symbol: string,
  range: string,
  interval: string
): Promise<YahooChartRaw | null | undefined> => {
  if (!cachedChartFn) {
    const mod = (await import('yahoo-finance2')) as unknown as {
      default?: YahooFinanceModule;
    } & YahooFinanceModule;
    const yf = (mod.default ?? mod) as YahooFinanceModule;
    yf.suppressNotices?.(['yahooSurvey', 'ripHistorical']);
    cachedChartFn = async (s: string, r: string, i: string) =>
      (await yf.chart(s, { period1: undefined, period2: undefined, range: r, interval: i }, { validateResult: false })) as YahooChartRaw;
  }
  return cachedChartFn(symbol, range, interval);
};

interface YahooChartRaw {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: (number | null)[];
        }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

/**
 * Calculate historical volatility from price array.
 * Uses simple returns: (price_t - price_t-1) / price_t-1
 * Annualizes by multiplying by √252 (trading days per year)
 *
 * @param prices Array of closing prices in chronological order
 * @param _days Number of days worth of data (for documentation)
 * @returns Annualized volatility as decimal (e.g., 0.25 = 25%), or null if insufficient data
 */
export function calculateHistoricalVolatility(prices: number[], _days: number): number | null {
  if (!prices || prices.length < 2) {
    return null;
  }

  // Calculate simple daily returns
  const dailyReturns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prevPrice = prices[i - 1];
    if (prevPrice > 0) {
      const dailyReturn = (prices[i] - prevPrice) / prevPrice;
      dailyReturns.push(dailyReturn);
    }
  }

  if (dailyReturns.length < 1) {
    return null;
  }

  // If only one return, variance is 0 and vol is 0
  if (dailyReturns.length === 1) {
    return 0;
  }

  // Calculate standard deviation of returns
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);

  // Annualize: multiply by sqrt(252) trading days per year
  const annualizedVol = stdDev * Math.sqrt(252);

  return annualizedVol;
}

/**
 * Get volatility metrics for a symbol.
 * Fetches price history, beta, and implied volatility.
 * Returns a Promise that resolves to VolatilityMetrics.
 *
 * @param symbol Stock ticker symbol
 * @returns Promise<VolatilityMetrics>
 */
export async function getVolatilityMetrics(symbol: string): Promise<VolatilityMetrics> {
  const normalized = symbol.trim().toUpperCase();

  let historicalVol20d: number | null = null;
  let historicalVol60d: number | null = null;
  let beta: number | null = null;
  let impliedVol: number | null = null;

  try {
    // Fetch 60 days of price history
    const priceChart = await defaultChartFn(normalized, '3mo', '1d');
    const prices = extractPrices(priceChart);

    if (prices && prices.length > 0) {
      // Calculate 20-day volatility (use last 20 days if available)
      if (prices.length >= 20) {
        const last20 = prices.slice(-20);
        historicalVol20d = calculateHistoricalVolatility(last20, 20);
      }

      // Calculate 60-day volatility
      if (prices.length >= 60) {
        const last60 = prices.slice(-60);
        historicalVol60d = calculateHistoricalVolatility(last60, 60);
      } else if (prices.length >= 2) {
        // Use all available data if less than 60 days
        historicalVol60d = calculateHistoricalVolatility(prices, prices.length);
      }
    }

    // Fetch beta from fundamentals
    const fundamentalsSource = new YahooFundamentalsDataSource();
    const fundamentalsResult = await fundamentalsSource.fetch({ symbol: normalized });
    beta = fundamentalsResult.data.beta;

    // Fetch implied volatility from options chain (ATM strike)
    const optionsSource = new YahooOptionsDataSource();
    const optionsResult = await optionsSource.fetch({ symbol: normalized });
    const atmIv = extractAtmImpliedVolatility(optionsResult.data);
    impliedVol = atmIv;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.debug('volatility metrics fetch failed', { symbol: normalized, error: errorMsg });
    // Continue with partial data (nulls will be filled)
  }

  return {
    symbol: normalized,
    historicalVol20d,
    historicalVol60d,
    beta,
    impliedVol,
  };
}

/**
 * Extract closing prices from Yahoo Finance chart response.
 * Assumes timestamps are in order (oldest first).
 *
 * @param chartRaw Raw response from yahoo-finance2 chart()
 * @returns Array of closing prices in chronological order, or null if no data
 */
function extractPrices(chartRaw: YahooChartRaw | null | undefined): number[] | null {
  if (!chartRaw?.chart?.result?.[0]) {
    return null;
  }

  const result = chartRaw.chart.result[0];
  const closes = result.indicators?.quote?.[0]?.close;

  if (!Array.isArray(closes)) {
    return null;
  }

  // Filter out nulls and return as number array
  const prices: number[] = [];
  for (const close of closes) {
    if (typeof close === 'number' && close > 0) {
      prices.push(close);
    }
  }

  return prices.length > 0 ? prices : null;
}

/**
 * Extract ATM (at-the-money) implied volatility from options chain.
 * Finds the call option closest to the current price and returns its IV.
 *
 * @param optionsData Options payload
 * @returns Implied volatility as decimal (e.g., 0.25 = 25%), or null if not available
 */
function extractAtmImpliedVolatility(optionsData: {
  underlyingPrice: number | null;
  calls: Array<{ strike: number; impliedVolatility: number | null }>;
}): number | null {
  if (!optionsData.underlyingPrice || optionsData.calls.length === 0) {
    return null;
  }

  const underlyingPrice = optionsData.underlyingPrice;

  // Find call option closest to underlying price (ATM)
  let atmCall = null;
  let minDiff = Infinity;

  for (const call of optionsData.calls) {
    const diff = Math.abs(call.strike - underlyingPrice);
    if (diff < minDiff && call.impliedVolatility !== null) {
      minDiff = diff;
      atmCall = call;
    }
  }

  return atmCall?.impliedVolatility ?? null;
}
