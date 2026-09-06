/**
 * Weekly planner job.
 * Runs weekly to evaluate watchlist symbols and create strategic plans
 * when signal thresholds are crossed.
 * Delegates to planReviewJob for the actual logic.
 */
import type Database from 'better-sqlite3';
export declare function runWeeklyPlannerJob(db: Database.Database): Promise<void>;
//# sourceMappingURL=weeklyPlanner.d.ts.map