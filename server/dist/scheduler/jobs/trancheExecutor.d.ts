/**
 * Daily tranche executor job.
 * Runs daily to execute tranches for active strategic plans.
 * Logs detailed "why no trade" audit trail.
 */
import type Database from 'better-sqlite3';
import { type RunTrigger } from '../../repos/runsRepo.js';
export interface TrancheExecutionSummary {
    regime: string;
    activePlans: number;
    tranchesExecuted: number;
    tranchesSkipped: Array<{
        symbol: string;
        planId: string;
        reason: string;
    }>;
    plansPaused: number;
    plansResumed: number;
    plansCancelled: number;
    autoTrimPlans: number;
    autoHedgePlan: string | null;
}
export declare function runTrancheExecutorJob(db: Database.Database, trigger?: RunTrigger): Promise<TrancheExecutionSummary>;
//# sourceMappingURL=trancheExecutor.d.ts.map