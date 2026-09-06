import { Router } from 'express';
import type Database from 'better-sqlite3';
/**
 * Run backtest in background (fire-and-forget from HTTP handler).
 * Exported for use by auto-backtest service.
 */
export declare function runBacktestInBackground(db: Database.Database, backtestId: string, config: {
    name?: string;
    startDate: string;
    endDate: string;
    symbols: string[];
    startingCashCents?: number;
}): Promise<void>;
export declare function createBacktestRoutes(db: Database.Database): Router;
//# sourceMappingURL=backtest.d.ts.map