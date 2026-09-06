import type Database from 'better-sqlite3';
/**
 * Run the daily snapshot capture job.
 * Captures portfolio + SPY benchmark at market close (16:45 ET).
 * Skips non-trading days.
 */
export declare function runSnapshotJob(db: Database.Database): Promise<void>;
//# sourceMappingURL=snapshot.d.ts.map