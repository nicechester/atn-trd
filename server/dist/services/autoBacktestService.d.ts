import type Database from 'better-sqlite3';
/**
 * Queue an auto-backtest for the current watchlist if enabled.
 * Called when watchlist changes (add/remove/toggle).
 * Debounced to handle batch additions (comma-separated symbols).
 */
export declare function queueWatchlistBacktest(db: Database.Database): void;
//# sourceMappingURL=autoBacktestService.d.ts.map