/**
 * Weekly planner job.
 * Runs weekly to evaluate watchlist symbols and create strategic plans
 * when signal thresholds are crossed.
 * Delegates to planReviewJob for the actual logic.
 */

import type Database from 'better-sqlite3';
import { logger } from '../../lib/logger.js';
import { runPlanReviewJob } from './planReviewJob.js';

const log = logger.child({ component: 'weekly-planner-job' });

export async function runWeeklyPlannerJob(db: Database.Database): Promise<void> {
  try {
    const summary = await runPlanReviewJob(db, 'plan_review');
    log.info('weekly planner job complete', { ...summary });
  } catch (err) {
    log.error('weekly planner job failed', { error: err instanceof Error ? err.message : String(err) });
  }
}
