/**
 * Scheduled Watchlist Curator Job
 *
 * Runs the screener to refresh watchlist picks on a configurable schedule.
 * Only runs when watchlist.mode === 'dynamic' and curatorSchedule !== 'manual'.
 */
import type Database from 'better-sqlite3';
export declare function runWatchlistCuratorJob(db: Database.Database): Promise<void>;
//# sourceMappingURL=watchlistCurator.d.ts.map