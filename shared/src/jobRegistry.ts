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

export const JOB_REGISTRY: Record<string, Job> = {
  'signal-collection': {
    id: 'signal-collection',
    label: 'Signal Collection',
    description: 'Collect market signals for watchlist symbols (news, technicals, macro)',
    dependencies: [],
    estimatedRuntimeSeconds: 120,
  },
  'plan-review': {
    id: 'plan-review',
    label: 'Plan Review',
    description: 'Review trading plans and generate portfolio decisions',
    dependencies: ['signal-collection'], // Needs fresh signals
    estimatedRuntimeSeconds: 180,
  },
  'tranche-execution': {
    id: 'tranche-execution',
    label: 'Tranche Execution',
    description: 'Execute planned trades in tranches based on portfolio decisions',
    dependencies: ['plan-review'], // Needs decisions from plan review
    estimatedRuntimeSeconds: 90,
  },
  'watchlist-curation': {
    id: 'watchlist-curation',
    label: 'Watchlist Curation',
    description: 'Run screener and populate watchlist with qualified symbols',
    dependencies: [], // Independent of other jobs
    estimatedRuntimeSeconds: 150,
  },
  'snapshot': {
    id: 'snapshot',
    label: 'Portfolio Snapshot',
    description: 'Capture daily portfolio snapshot and benchmark comparison',
    dependencies: [], // Can run independently
    estimatedRuntimeSeconds: 60,
  },
};

export type JobId = keyof typeof JOB_REGISTRY;

/**
 * Topological sort of selected jobs based on dependencies.
 * Returns jobs in execution order, with tie-breaking by canonical order (as defined in JOB_REGISTRY).
 *
 * @param selectedJobIds - Array of job IDs to execute
 * @returns Array of jobs in execution order
 * @throws Error if there's a circular dependency or missing job definition
 */
export function resolveExecutionOrder(selectedJobIds: string[]): Job[] {
  // Validate all jobs exist
  const missing = selectedJobIds.filter(id => !JOB_REGISTRY[id as JobId]);
  if (missing.length > 0) {
    throw new Error(`Unknown job IDs: ${missing.join(', ')}`);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const result: Job[] = [];

  // Helper function to expand dependencies recursively
  function expandDependencies(jobId: string, expanded: Set<string>): void {
    const job = JOB_REGISTRY[jobId as JobId];
    if (!job) return;

    for (const depId of job.dependencies) {
      if (!expanded.has(depId)) {
        expanded.add(depId);
        expandDependencies(depId, expanded);
      }
    }
  }

  // Expand all dependencies for selected jobs
  const allJobsNeeded = new Set(selectedJobIds);
  for (const jobId of selectedJobIds) {
    expandDependencies(jobId, allJobsNeeded);
  }

  // Perform topological sort using DFS
  function visit(jobId: string): void {
    if (visited.has(jobId)) return;
    if (recursionStack.has(jobId)) {
      throw new Error(`Circular dependency detected: ${jobId}`);
    }

    recursionStack.add(jobId);

    const job = JOB_REGISTRY[jobId as JobId];
    if (job) {
      for (const depId of job.dependencies) {
        if (allJobsNeeded.has(depId)) {
          visit(depId);
        }
      }
    }

    recursionStack.delete(jobId);
    visited.add(jobId);
    const job_final = JOB_REGISTRY[jobId as JobId];
    if (job_final) {
      result.push(job_final);
    }
  }

  // Sort jobs by canonical order from registry for stable tie-breaking
  const canonicalOrder = Object.keys(JOB_REGISTRY);
  const sortedByCanonical = Array.from(allJobsNeeded).sort(
    (a, b) => canonicalOrder.indexOf(a) - canonicalOrder.indexOf(b)
  );

  for (const jobId of sortedByCanonical) {
    visit(jobId);
  }

  return result;
}
