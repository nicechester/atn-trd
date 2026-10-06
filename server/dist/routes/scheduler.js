import { getNextRuns, getJobSchedules } from '../scheduler/index.js';
/** GET /api/scheduler/next-runs?n=5 */
export function nextRunsHandler(req, res) {
    const n = Math.min(Math.max(parseInt(req.query['n'] || '5', 10), 1), 20);
    res.json({ nextRuns: getNextRuns(n) });
}
/** GET /api/scheduler/jobs */
export function jobSchedulesHandler(_req, res) {
    res.json({ jobs: getJobSchedules() });
}
//# sourceMappingURL=scheduler.js.map