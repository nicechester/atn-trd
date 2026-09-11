import { useState } from 'react';
import { JOB_REGISTRY } from '@atn-trd/shared';
import { api } from '../api/client';
import styles from './JobRunnerCompact.module.css';

interface ProgressEvent {
  runId: string;
  phase: string;
  jobId?: string;
  jobName?: string;
  message: string;
  timestamp: number;
}

interface JobRunnerCompactProps {
  onComplete?: () => void | Promise<void>;
}

export function JobRunnerCompact({ onComplete }: JobRunnerCompactProps): JSX.Element {
  const [selectedJob, setSelectedJob] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  const handleRun = async () => {
    if (!selectedJob) return;

    try {
      setIsRunning(true);
      setStatus({ type: 'info', message: 'Starting...' });

      const eventSource = new EventSource('/api/runs/progress/stream');
      eventSource.onmessage = (event: MessageEvent<string>) => {
        try {
          const data = JSON.parse(event.data) as ProgressEvent;
          if (data.phase === 'job-complete' && data.jobId === selectedJob) {
            const isError = data.message.includes('failed') || data.message.includes('Error');
            const isSkipped = data.message.includes('Skipped');
            setStatus({
              type: isError ? 'error' : isSkipped ? 'info' : 'success',
              message: data.message,
            });
          } else if (data.phase === 'complete') {
            eventSource.close();
          }
        } catch {}
      };

      const response = await api.strategicJobs.triggerRunSelected({ jobIds: [selectedJob] });

      if (!response.ok) {
        setStatus({ type: 'error', message: response.error || 'Failed to trigger job' });
      }

      setIsRunning(false);
      onComplete?.();
    } catch (err) {
      setStatus({ type: 'error', message: err instanceof Error ? err.message : 'Failed to run job' });
      setIsRunning(false);
    }
  };

  const allJobIds = Object.keys(JOB_REGISTRY);

  return (
    <div className={styles.container}>
      <div className={styles.row}>
        <select
          className={styles.select}
          value={selectedJob}
          onChange={e => { setSelectedJob(e.target.value); setStatus(null); }}
          disabled={isRunning}
        >
          <option value="">Select a job...</option>
          {allJobIds.map(jobId => {
            const job = JOB_REGISTRY[jobId as keyof typeof JOB_REGISTRY];
            return (
              <option key={jobId} value={jobId}>
                {job.label}
              </option>
            );
          })}
        </select>
        <button
          className={styles.runButton}
          onClick={handleRun}
          disabled={!selectedJob || isRunning}
        >
          {isRunning ? 'Running...' : 'Run'}
        </button>
      </div>
      {status && (
        <div className={`${styles.status} ${styles[status.type]}`}>
          {status.message}
        </div>
      )}
    </div>
  );
}
