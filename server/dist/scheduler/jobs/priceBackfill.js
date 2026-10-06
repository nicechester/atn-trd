/**
 * Price backfill job - fetches historical price data for all tracked symbols.
 *
 * Uses Alpaca Market Data API (free tier supports historical bars).
 * Runs on startup and can be triggered manually. Fetches data for:
 * - User watchlist symbols (for trading)
 * - Static symbols (sector ETFs, benchmarks) for analysis tools
 */
import { logger } from '../../lib/logger.js';
import { PricesRepo } from '../../repos/pricesRepo.js';
import { WatchlistRepo } from '../../repos/watchlistRepo.js';
import { RunsRepo } from '../../repos/runsRepo.js';
import { getStaticSymbols } from '../../config/staticSymbols.js';
import { getSettings } from '../../config/settingsService.js';
import { HttpClient } from '../../datasources/http.js';
const log = logger.child({ component: 'price-backfill' });
const BACKFILL_DAYS = 120;
function createAlpacaClient() {
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
async function backfillSymbol(symbol, pricesRepo, startDate, http) {
    const path = `stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&start=${startDate}&limit=1000`;
    try {
        const result = await http.json(path);
        if (!result.bars || result.bars.length === 0) {
            log.debug('no bar data', { symbol, startDate });
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
    }
    catch (err) {
        log.warn('backfill failed for symbol', {
            symbol,
            startDate,
            error: err instanceof Error ? err.message : String(err),
        });
        return 0;
    }
}
/**
 * Get all symbols that need price data: watchlist + static symbols.
 */
export function getAllTrackedSymbols(db) {
    const watchlistRepo = new WatchlistRepo(db);
    const watchlistSymbols = watchlistRepo.list().map(w => w.symbol);
    const staticSymbols = getStaticSymbols();
    const all = new Set([...watchlistSymbols, ...staticSymbols].map(s => s.toUpperCase()));
    return Array.from(all).sort();
}
/**
 * Run the price backfill job.
 */
export async function runPriceBackfillJob(db, options = {}, trigger = 'price_backfill') {
    const settings = getSettings();
    const runsRepo = new RunsRepo(db);
    // Calculate start date: use explicit startDate, or days back from today
    const startDate = options.startDate ??
        new Date(Date.now() - (options.days ?? BACKFILL_DAYS) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const symbols = options.symbols ?? getAllTrackedSymbols(db);
    const pricesRepo = new PricesRepo(db);
    const summary = {
        total: symbols.length,
        succeeded: 0,
        bars: 0,
        symbols: [],
        startDate,
    };
    // Create run record
    const runId = runsRepo.create({
        trigger,
        status: 'running',
        startedAt: Date.now(),
        finishedAt: null,
        model: null,
        settingsSnapshot: JSON.stringify(settings),
        error: null,
        tokenUsageJson: null,
        skipReason: null,
        summaryJson: null,
    });
    try {
        const http = createAlpacaClient();
        if (!http) {
            const error = 'ALPACA_API_KEY/SECRET not configured, cannot backfill';
            log.error(error);
            runsRepo.setSkipped(runId, error);
            return summary;
        }
        log.info('starting price backfill', { symbolCount: symbols.length, startDate });
        for (const symbol of symbols) {
            const bars = await backfillSymbol(symbol, pricesRepo, startDate, http);
            if (bars > 0) {
                summary.succeeded++;
                summary.bars += bars;
                summary.symbols.push(symbol);
                log.debug('backfilled symbol', { symbol, bars });
            }
            // Small delay to be nice to API
            await new Promise(r => setTimeout(r, 300));
        }
        runsRepo.updateStatus(runId, 'succeeded');
        runsRepo.updateSummary(runId, JSON.stringify(summary));
        log.info('price backfill complete', { total: summary.total, succeeded: summary.succeeded, bars: summary.bars });
        return summary;
    }
    catch (err) {
        runsRepo.updateStatus(runId, 'failed', err instanceof Error ? err.message : String(err));
        log.error('price backfill job failed', { error: err instanceof Error ? err.message : String(err) });
        throw err;
    }
}
//# sourceMappingURL=priceBackfill.js.map