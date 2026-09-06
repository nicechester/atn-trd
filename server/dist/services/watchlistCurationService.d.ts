/**
 * Watchlist Curation Service
 *
 * Runs the screener to pick symbols from dynamic universe,
 * then populates the watchlist table with categories.
 *
 * This is triggered manually (not scheduled) when user wants fresh picks.
 */
import type Database from 'better-sqlite3';
export interface WatchlistCurationSummary {
    symbolsAdded: string[];
    symbolsUpdated: string[];
    totalInWatchlist: number;
    screenerSelections: number;
}
/**
 * Run screener and populate watchlist table with results.
 */
export declare function runWatchlistCuration(db: Database.Database): Promise<WatchlistCurationSummary>;
/**
 * Backfill sector data from Finnhub profile2 endpoint for watchlist symbols missing sector.
 */
export declare function backfillSectors(db: Database.Database): Promise<{
    updated: number;
    errors: number;
    symbols: string[];
}>;
//# sourceMappingURL=watchlistCurationService.d.ts.map