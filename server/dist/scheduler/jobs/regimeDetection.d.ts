/**
 * Daily regime detection job.
 * Runs on trading days to detect market regime (RISK_ON / RISK_OFF / NEUTRAL).
 */
import type Database from 'better-sqlite3';
export declare function runRegimeDetectionJob(db: Database.Database): Promise<void>;
//# sourceMappingURL=regimeDetection.d.ts.map