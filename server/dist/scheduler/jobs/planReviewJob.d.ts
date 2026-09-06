/**
 * Plan review job.
 * Can run weekly (via weeklyPlanner) or on-demand.
 * Evaluates watchlist signals and creates/updates strategic plans.
 */
import type Database from 'better-sqlite3';
import { type RunTrigger } from '../../repos/runsRepo.js';
export interface PlanReviewSummary {
    regime: string;
    watchlistCount: number;
    positionsCount: number;
    plansCreated: number;
    trimPlansCreated: number;
    plansSkipped: Array<{
        symbol: string;
        reason: string;
    }>;
    existingActivePlans: number;
    symbolsPruned: string[];
}
export declare function runPlanReviewJob(db: Database.Database, trigger?: RunTrigger): Promise<PlanReviewSummary>;
//# sourceMappingURL=planReviewJob.d.ts.map