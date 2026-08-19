/**
 * Croner-based job scheduler.
 *
 * Loads the cron expression and timezone from settings, registers jobs, and
 * re-registers them whenever settings change. In Phase 1 only the snapshot
 * job is registered, as a no-op placeholder for the Phase 2 trading cycle.
 *
 * Public API:
 *   startScheduler()   — initialise once at startup
 *   stopScheduler()    — graceful shutdown
 *   getNextRuns(n)     — next N scheduled run times (ISO strings)
 */

import { Cron } from 'croner';
import { getSettings } from '../config/settingsService.js';
import { settingsEvents } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'scheduler' });

// Active job handle; replaced on every settings change.
let activeJob: Cron | null = null;

// ── job handlers ──────────────────────────────────────────────────────────────

/**
 * Phase 1 no-op snapshot job.
 * In Phase 2 this will invoke the trading agent pipeline.
 */
function snapshotJob(): void {
  log.info('snapshot job fired (no-op placeholder)');
}

// ── internal ──────────────────────────────────────────────────────────────────

function registerJobs(): void {
  const settings = getSettings();
  const { cron, timezone } = settings.schedule;

  if (activeJob) {
    activeJob.stop();
    activeJob = null;
    log.info('previous jobs stopped');
  }

  try {
    activeJob = new Cron(cron, { timezone, protect: true }, snapshotJob);
    const nextRun = activeJob.nextRun();
    log.info('scheduler registered', { cron, timezone, nextRun: nextRun?.toISOString() ?? null });
  } catch (err) {
    log.error('failed to register scheduler jobs', {
      error: err instanceof Error ? err.message : String(err),
      cron,
      timezone,
    });
    activeJob = null;
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/** Initialise the scheduler. Must be called once after settings are available. */
export function startScheduler(): void {
  registerJobs();

  settingsEvents.on('change', () => {
    log.info('settings changed, re-registering scheduler jobs');
    registerJobs();
  });
}

/** Stop all active jobs (call on SIGTERM/SIGINT). */
export function stopScheduler(): void {
  if (activeJob) {
    activeJob.stop();
    activeJob = null;
    log.info('scheduler stopped');
  }
}

/**
 * Return the next `n` scheduled run times as ISO-8601 strings.
 * Returns an empty array if no job is registered or the expression
 * produces no future runs.
 */
export function getNextRuns(n: number): string[] {
  if (!activeJob) return [];
  try {
    return activeJob.nextRuns(n).map((d) => d.toISOString());
  } catch {
    return [];
  }
}
