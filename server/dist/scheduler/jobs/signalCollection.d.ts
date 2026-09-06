/**
 * Daily signal collection job.
 * Runs on trading days to collect market signals for watchlist symbols.
 * Does NOT make trading decisions — just collects data.
 */
import type Database from 'better-sqlite3';
import { type RunTrigger } from '../../repos/runsRepo.js';
export interface SignalCollectionSummary {
    symbolsUpdated: number;
    errors: number;
    symbols: string[];
    tokensUsed: number;
}
export declare function runSignalCollectionJob(db: Database.Database, trigger?: RunTrigger): Promise<SignalCollectionSummary>;
//# sourceMappingURL=signalCollection.d.ts.map