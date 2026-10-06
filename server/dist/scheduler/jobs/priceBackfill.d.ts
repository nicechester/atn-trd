/**
 * Price backfill job - fetches historical price data for all tracked symbols.
 *
 * Uses Alpaca Market Data API (free tier supports historical bars).
 * Runs on startup and can be triggered manually. Fetches data for:
 * - User watchlist symbols (for trading)
 * - Static symbols (sector ETFs, benchmarks) for analysis tools
 */
import type Database from 'better-sqlite3';
import { type RunTrigger } from '../../repos/runsRepo.js';
/**
 * Get all symbols that need price data: watchlist + static symbols.
 */
export declare function getAllTrackedSymbols(db: Database.Database): string[];
export interface PriceBackfillSummary {
    total: number;
    succeeded: number;
    bars: number;
    symbols: string[];
    startDate: string;
}
/**
 * Run the price backfill job.
 */
export declare function runPriceBackfillJob(db: Database.Database, options?: {
    days?: number;
    startDate?: string;
    symbols?: string[];
}, trigger?: RunTrigger): Promise<PriceBackfillSummary>;
//# sourceMappingURL=priceBackfill.d.ts.map