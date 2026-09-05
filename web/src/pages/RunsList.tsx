import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { runs as runsApi, type AgentRunRow } from '../api/client';
import { formatTimestamp, formatDuration } from '../lib/format';
import { useToast } from '../context/ToastContext';
import styles from './RunsList.module.css';

const JOB_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All Jobs' },
  { value: 'trading_cycle', label: 'Trading Cycle' },
  { value: 'signal_collection', label: 'Signal Collection' },
  { value: 'plan_review', label: 'Plan Review' },
  { value: 'watchlist_curation', label: 'Watchlist Curation' },
  { value: 'tranche_execution', label: 'Tranche Execution' },
];

type JobType = 'trading_cycle' | 'signal_collection' | 'plan_review' | 'tranche_execution' | 'watchlist_curation';

const JOB_TYPE_LABELS: Record<JobType, string> = {
  trading_cycle: 'Trading Cycle',
  signal_collection: 'Signal Collection',
  plan_review: 'Plan Review',
  tranche_execution: 'Tranche Execution',
  watchlist_curation: 'Watchlist Curation',
};

function inferJobType(run: AgentRunRow): JobType {
  // Explicit trigger types
  if (run.trigger === 'signal_collection') return 'signal_collection';
  if (run.trigger === 'plan_review') return 'plan_review';
  if (run.trigger === 'tranche_execution') return 'tranche_execution';
  if (run.trigger === 'watchlist_curation') return 'watchlist_curation';
  
  // For manual/scheduled, infer from summaryJson
  if (run.summaryJson) {
    try {
      const summary = JSON.parse(run.summaryJson);
      if ('symbolsUpdated' in summary && 'symbols' in summary && !('regime' in summary)) return 'signal_collection';
      if ('plansCreated' in summary || 'watchlistCount' in summary) return 'plan_review';
      if ('tranchesExecuted' in summary) return 'tranche_execution';
      if ('symbolsAdded' in summary) return 'watchlist_curation';
    } catch {}
  }
  return 'trading_cycle';
}

export default function RunsListPage() {
  const [runList, setRunList] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState('all');
  const [cancelling, setCancelling] = useState<string | null>(null);
  const navigate = useNavigate();
  const { addToast } = useToast();

  const jobTypeFilter = searchParams.get('type') || 'all';

  useEffect(() => {
    loadRuns();
  }, []);

  function loadRuns() {
    runsApi.list(100, 0)
      .then(res => setRunList(res.data))
      .catch(e => addToast(e instanceof Error ? e.message : 'Failed to load runs', 'error'))
      .finally(() => setLoading(false));
  }

  async function handleCancel(e: React.MouseEvent, runId: string) {
    e.stopPropagation();
    setCancelling(runId);
    try {
      await runsApi.cancel(runId);
      addToast('Run cancelled', 'success');
      loadRuns();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to cancel', 'error');
    } finally {
      setCancelling(null);
    }
  }

  function handleJobTypeChange(value: string) {
    if (value === 'all') {
      searchParams.delete('type');
    } else {
      searchParams.set('type', value);
    }
    setSearchParams(searchParams);
  }

  const filtered = runList.filter(r => {
    // Status filter
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    // Job type filter
    if (jobTypeFilter === 'all') return true;
    return inferJobType(r) === jobTypeFilter;
  });

  function badgeClass(status: AgentRunRow['status']) {
    if (status === 'succeeded') return styles.badgeGreen;
    if (status === 'failed') return styles.badgeRed;
    if (status === 'running') return styles.badgeYellow;
    return styles.badgeGray;
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <h1>Job History</h1>
      <div className={styles.filterBar}>
        <label>Job Type:</label>
        <select value={jobTypeFilter} onChange={e => handleJobTypeChange(e.target.value)}>
          {JOB_TYPE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <label>Status:</label>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="running">Running</option>
          <option value="succeeded">Succeeded</option>
          <option value="failed">Failed</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>
      {filtered.length === 0
        ? <p className={styles.muted}>No runs found.</p>
        : (
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Job Type</th>
                <th className={styles.th}>Trigger</th>
                <th className={styles.th}>Started</th>
                <th className={styles.th}>Duration</th>
                <th className={styles.th}>Model</th>
                <th className={styles.th}>Error</th>
                <th className={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(run => (
                <tr key={run.id} className={styles.row} onClick={() => navigate(`/job-history/${run.id}`)}>
                  <td className={styles.td}><span className={badgeClass(run.status)}>{run.status}</span></td>
                  <td className={styles.td}>{JOB_TYPE_LABELS[inferJobType(run)]}</td>
                  <td className={styles.td}>{run.trigger}</td>
                  <td className={styles.td}>{formatTimestamp(run.startedAt)}</td>
                  <td className={styles.td}>{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td className={styles.td}>{run.model ?? '—'}</td>
                  <td className={styles.td}>{run.error ? (run.error.length > 60 ? run.error.slice(0, 60) + '…' : run.error) : '—'}</td>
                  <td className={styles.td}>
                    {run.status === 'running' && (
                      <button
                        className={styles.cancelBtn}
                        onClick={(e) => handleCancel(e, run.id)}
                        disabled={cancelling === run.id}
                      >
                        {cancelling === run.id ? '...' : 'Stop'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
        )
      }
    </div>
  );
}
