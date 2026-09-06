/**
 * Market open fill job: fill accepted orders at market open price.
 *
 * Runs at 9:30 AM ET to fill orders submitted after previous market close.
 * Uses live quote for today's open price.
 */
import type Database from 'better-sqlite3';
export declare function runMarketOpenFillJob(db: Database.Database, config?: {
    slippageBps: number;
}): Promise<{
    filled: number;
    rejected: number;
    skipped: number;
}>;
//# sourceMappingURL=marketOpenFill.d.ts.map