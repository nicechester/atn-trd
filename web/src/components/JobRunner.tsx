import { useEffect, useState } from 'react';
import { JOB_REGISTRY, resolveExecutionOrder, type JobExecutionOrder } from '@atn-trd/shared';
import { api, type TriggerRunSelectedRequest } from '../api/client';
import styles from './JobRunner.module.css';

interface JobSelection {
  [jobId: string]: boolean;
}

interface ProgressEvent {
  runId: string;
  phase: string;
  jobId?: string;
  jobName?: string;
  message: string;
  timestamp: number;
}

interface JobResult {
  jobId: string;
  jobName: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  message: string;
  runId?: string;
}

export function JobRunner(): JSX.Element {
  const [selection, setSelection] = useState<JobSelection>({});
  const [executionOrder, setExecutionOrder] = useState<ReturnType<typeof resolveExecutionOrder>>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [results, setResults] = useState<JobResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Update execution order when selection changes
  useEffect(() => {
    try {
      const selectedIds = Object.entries(selection)
        .filter(([, selected]) => selected)
        .map(([id]) => id);

      if (selectedIds.length === 0) {
        setExecutionOrder([]);
        setError(null);
      } else {
        const order = resolveExecutionOrder(selectedIds);
        setExecutionOrder(order);
        setError(null);
      }
    } catch (err) {
      setExecutionOrder([]);
      setError(err instanceof Error ? err.message : 'Failed to resolve execution order');
    }
  }, [selection]);

  const handleJobToggle = (jobId: string) => {
    setSelection(prev => ({
      ...prev,
      [jobId]: !prev[jobId],
    }));
  };

  const handleRunSelected = async () => {
    try {
      setIsRunning(true);
      setProgress([]);
      setResults([]);
      setError(null);

      const selectedIds = Object.entries(selection)
        .filter(([, selected]) => selected)
        .map(([id]) => id);

      if (selectedIds.length === 0) {
        setError('Please select at least one job');
        setIsRunning(false);
        return;
      }

      // Start streaming progress
      const eventSource = new EventSource('/api/runs/progress/stream');
      let lastRunId: string | null = null;

      eventSource.onmessage = (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as ProgressEvent;
          setProgress(prev => [...prev, data]);
          lastRunId = data.runId;

          // Update results based on progress events
          if (data.phase === 'job-start' && data.jobId && data.jobName) {
            setResults(prev => {
              const existing = prev.findIndex(r => r.jobId === data.jobId);
              const newResult = {
                jobId: data.jobId!,
                jobName: data.jobName!,
                status: 'running' as const,
                message: data.message,
              };
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = newResult;
                return updated;
              }
              return [...prev, newResult];
            });
          } else if (data.phase === 'job-complete' && data.jobId) {
            setResults(prev => {
              const existing = prev.findIndex(r => r.jobId === data.jobId);
              const status = data.message.includes('failed') || data.message.includes('Error')
                ? 'failed'
                : data.message.includes('Skipped')
                  ? 'skipped'
                  : 'completed';
              const newResult = {
                jobId: data.jobId!,
                jobName: prev[existing]?.jobName || data.jobName || data.jobId,
                status,
                message: data.message,
              };
              if (existing >= 0) {
                const updated = [...prev];
                updated[existing] = newResult;
                return updated;
              }
              return [...prev, newResult];
            });
          } else if (data.phase === 'complete') {
            // Close event source when execution is complete
            eventSource.close();
          }
        } catch (err) {
          console.error('Failed to parse progress event', err);
        }
      };

      // Make API call
      const req: TriggerRunSelectedRequest = { jobIds: selectedIds };
      const response = await api.strategicJobs.triggerRunSelected(req);

      if (!response.ok) {
        setError(response.error || 'Failed to trigger jobs');
        setIsRunning(false);
        return;
      }

      // Update results with final run IDs
      if (response.runIds && Array.isArray(response.runIds)) {
        setResults(prev =>
          prev.map((result, idx) => ({
            ...result,
            runId: response.runIds?.[idx],
          }))
        );
      }

      setIsRunning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run jobs');
      setIsRunning(false);
    }
  };

  const allJobIds = Object.keys(JOB_REGISTRY);
  const selectedCount = Object.values(selection).filter(Boolean).length;

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Available Jobs</h3>
        <div className={styles.jobList}>
          {allJobIds.map(jobId => {
            const job = JOB_REGISTRY[jobId as keyof typeof JOB_REGISTRY];
            return (
              <div key={jobId} className={styles.jobItem}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={selection[jobId] || false}
                    onChange={() => handleJobToggle(jobId)}
                    disabled={isRunning}
                  />
                  <div className={styles.jobInfo}>
                    <div className={styles.jobLabel}>{job.label}</div>
                    <div className={styles.jobDescription}>{job.description}</div>
                    {job.dependencies.length > 0 && (
                      <div className={styles.dependencies}>
                        Depends on: {job.dependencies.map(dep => JOB_REGISTRY[dep as keyof typeof JOB_REGISTRY]?.label || dep).join(', ')}
                      </div>
                    )}
                    <div className={styles.runtime}>~{job.estimatedRuntimeSeconds}s</div>
                  </div>
                </label>
              </div>
            );
          })}
        </div>
      </div>

      {executionOrder.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Execution Order ({executionOrder.length} jobs)</h3>
          <div className={styles.executionOrder}>
            {executionOrder.map((job, idx) => (
              <div key={job.id} className={styles.executionStep}>
                <div className={styles.stepNumber}>{idx + 1}</div>
                <div className={styles.stepLabel}>{job.label}</div>
                {idx < executionOrder.length - 1 && <div className={styles.arrow}>↓</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className={styles.error}>
          {error}
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.runButton}
          onClick={handleRunSelected}
          disabled={selectedCount === 0 || isRunning}
        >
          {isRunning ? 'Running...' : `Run ${selectedCount > 0 ? selectedCount : 'Selected'} Job${selectedCount !== 1 ? 's' : ''}`}
        </button>
      </div>

      {progress.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Live Progress</h3>
          <div className={styles.progressLog}>
            {progress.slice(-20).map((event, idx) => (
              <div key={idx} className={`${styles.progressItem} ${styles[event.phase] || ''}`}>
                <div className={styles.timestamp}>
                  {new Date(event.timestamp).toLocaleTimeString()}
                </div>
                <div className={styles.progressMessage}>
                  {event.message}
                  {event.jobId && <span className={styles.jobBadge}>{event.jobId}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Results</h3>
          <table className={styles.resultsTable}>
            <thead>
              <tr>
                <th>Job</th>
                <th>Status</th>
                <th>Message</th>
                <th>Run ID</th>
              </tr>
            </thead>
            <tbody>
              {results.map(result => (
                <tr key={result.jobId} className={`${styles.resultRow} ${styles[result.status]}`}>
                  <td className={styles.jobName}>{result.jobName}</td>
                  <td className={styles.status}>
                    <span className={styles.badge}>{result.status}</span>
                  </td>
                  <td className={styles.message}>{result.message}</td>
                  <td className={styles.runId}>
                    {result.runId ? (
                      <a href={`/runs/${result.runId}`} target="_blank" rel="noreferrer" className={styles.link}>
                        {result.runId.slice(0, 8)}...
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
