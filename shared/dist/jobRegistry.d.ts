/**
 * Job Registry: Single source of truth for all jobs in the system.
 *
 * Each job has:
 * - id: unique identifier for the job type
 * - label: human-readable name for dashboard display
 * - description: what the job does
 * - dependencies: list of job IDs that must run before this job
 * - estimatedRuntimeSeconds: estimated duration for progress indication
 */
export interface Job {
    id: string;
    label: string;
    description: string;
    dependencies: string[];
    estimatedRuntimeSeconds: number;
}
export declare const JOB_REGISTRY: Record<string, Job>;
export type JobId = keyof typeof JOB_REGISTRY;
/**
 * Topological sort of selected jobs based on dependencies.
 * Returns jobs in execution order, with tie-breaking by canonical order (as defined in JOB_REGISTRY).
 *
 * @param selectedJobIds - Array of job IDs to execute
 * @returns Array of jobs in execution order
 * @throws Error if there's a circular dependency or missing job definition
 */
export declare function resolveExecutionOrder(selectedJobIds: string[]): Job[];
//# sourceMappingURL=jobRegistry.d.ts.map