import { Request, Response } from 'express';
import { getNextRuns, getJobSchedules } from '../scheduler/index.js';

/** GET /api/scheduler/next-runs?n=5 */
export function nextRunsHandler(req: Request, res: Response): void {
  const n = Math.min(Math.max(parseInt((req.query['n'] as string) || '5', 10), 1), 20);
  res.json({ nextRuns: getNextRuns(n) });
}

/** GET /api/scheduler/jobs */
export function jobSchedulesHandler(_req: Request, res: Response): void {
  res.json({ jobs: getJobSchedules() });
}
