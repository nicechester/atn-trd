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
/** Initialise the scheduler. Must be called once after settings are available. */
export declare function startScheduler(): void;
/** Stop all active jobs (call on SIGTERM/SIGINT). */
export declare function stopScheduler(): void;
/**
 * Return the next `n` scheduled run times as ISO-8601 strings.
 * Returns an empty array if no job is registered or the expression
 * produces no future runs.
 */
export declare function getNextRuns(n: number): string[];
export interface JobSchedule {
    name: string;
    cron: string;
    nextRun: string | null;
    enabled: boolean;
}
/** Return schedule info for all registered jobs. */
export declare function getJobSchedules(): JobSchedule[];
//# sourceMappingURL=index.d.ts.map