/**
 * Price backfill job - fetches historical price data for all tracked symbols.
 * 
 * Uses Alpaca Market Data API (free tier supports historical bars).
 * Runs on startup and can be triggered manually. Fetches data for:
 * - User watchlist symbols (for trading)
 * - Static symbols (sector ETFs, benchmarks) for analysis tools
 */

import type Database from 'better-sqlite3';
import { logger } from '../../lib/logger.js';
import { PricesRepo } from '../../repos/pricesRepo.js';
import { WatchlistRepo } from '../../repos/watchlistRepo.js';
import { getStaticSymbols } from '../../config/staticSymbols.js';
import { HttpClient } from '../../datasources/http.js';

const log = logger.child({ component: 'price-backfill' });

const BACKFILL_DAYS = 120;

interface AlpacaBar {
  t: string;  // timestamp ISO
  o: number;  // open
  h: number;  // high
  l: number;  // low
  c: number;  // close
  v: number;  // volume
  n: number;  // trade count
  vw: number; // vwap
}

interface AlpacaBarsResponse {
  bars: AlpacaBar[];
  symbol: string;
  next_page_token?: string;
}

function createAlpacaClient(): HttpClient | null {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_API_SECRET;

  if (!apiKey || !apiSecret) {
    return null;
  }

  return new HttpClient({
    name: 'alpaca-backfill',
    baseUrl: 'https://data.alpaca.markets/v2/',
    defaultHeaders: {
      'APCA-API-KEY-ID': apiKey,
      'APCA-API-SECRET-KEY': apiSecret,
      accept: 'application/json',
    },
    rateLimit: { capacity: 10, refillPerSecond: 3 }, // Alpaca allows 200/min
    retry: { retries: 2, baseDelayMs: 500, maxDelayMs: 5000 },
  });
}

/**
 * Backfill historical prices for a single symbol using Alpaca.
 */
async function backfillSymbol(
  symbol: string,
  pricesRepo: PricesRepo,
  days: number,
  http: HttpClient
): Promise<number> {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const path = `stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&start=${startDate}&limit=1000`;

  try {
    const result = await http.json<AlpacaBarsResponse>(path);

    if (!result.bars || result.bars.length === 0) {
      log.debug('no bar data', { symbol });
      return 0;
    }

    let count = 0;
    for (const bar of result.bars) {
      const barDate = bar.t.slice(0, 10);

      pricesRepo.upsert({
        symbol: symbol.toUpperCase(),
        barDate,
        openCents: Math.round(bar.o * 100),
        highCents: Math.round(bar.h * 100),
        lowCents: Math.round(bar.l * 100),
        closeCents: Math.round(bar.c * 100),
        adjCloseCents: Math.round(bar.c * 100),
        volume: bar.v ?? null,
        provider: 'alpaca',
        fetchedAt: Date.now(),
      });
      count++;
    }

    return count;
  } catch (err) {
    log.warn('backfill failed for symbol', {
      symbol,
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * Get all symbols that need price data: watchlist + static symbols.
 */
export function getAllTrackedSymbols(db: Database.Database): string[] {
  const watchlistRepo = new WatchlistRepo(db);
  const watchlistSymbols = watchlistRepo.list().map(w => w.symbol);
  const staticSymbols = getStaticSymbols();

  const all = new Set([...watchlistSymbols, ...staticSymbols].map(s => s.toUpperCase()));
  return Array.from(all).sort();
}

/**
 * Run the price backfill job.
 */
export async function runPriceBackfillJob(
  db: Database.Database,
  options: { days?: number; symbols?: string[] } = {}
): Promise<{ total: number; succeeded: number; bars: number }> {
  const days = options.days ?? BACKFILL_DAYS;
  const symbols = options.symbols ?? getAllTrackedSymbols(db);
  const pricesRepo = new PricesRepo(db);

  const http = createAlpacaClient();
  if (!http) {
    log.error('ALPACA_API_KEY/SECRET not configured, cannot backfill');
    return { total: 0, succeeded: 0, bars: 0 };
  }

  log.info('starting price backfill', { symbolCount: symbols.length, days });

  let succeeded = 0;
  let totalBars = 0;

  for (const symbol of symbols) {
    const bars = await backfillSymbol(symbol, pricesRepo, days, http);
    if (bars > 0) {
      succeeded++;
      totalBars += bars;
      log.debug('backfilled symbol', { symbol, bars });
    }
    // Small delay to be nice to API
    await new Promise(r => setTimeout(r, 300));
  }

  log.info('price backfill complete', { total: symbols.length, succeeded, bars: totalBars });

  return { total: symbols.length, succeeded, bars: totalBars };
}
