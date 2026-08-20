import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { runs as runsApi, type AgentRunRow } from '../api/client';
import { formatTimestamp, formatDuration } from '../lib/format';
import { useToast } from '../context/ToastContext';
import styles from './RunsList.module.css';

export default function RunsListPage() {
  const [runList, setRunList] = useState<AgentRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const navigate = useNavigate();
  const { addToast } = useToast();

  useEffect(() => {
    runsApi.list(100, 0)
      .then(res => setRunList(res.data))
      .catch(e => addToast(e instanceof Error ? e.message : 'Failed to load runs', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = statusFilter === 'all' ? runList : runList.filter(r => r.status === statusFilter);

  function badgeClass(status: AgentRunRow['status']) {
    if (status === 'succeeded') return styles.badgeGreen;
    if (status === 'failed') return styles.badgeRed;
    if (status === 'running') return styles.badgeYellow;
    return styles.badgeGray;
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <h1>Runs</h1>
      <div className={styles.filterBar}>
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
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Trigger</th>
                <th className={styles.th}>Started</th>
                <th className={styles.th}>Duration</th>
                <th className={styles.th}>Model</th>
                <th className={styles.th}>Error</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(run => (
                <tr key={run.id} className={styles.row} onClick={() => navigate(`/runs/${run.id}`)}>
                  <td className={styles.td}><span className={badgeClass(run.status)}>{run.status}</span></td>
                  <td className={styles.td}>{run.trigger}</td>
                  <td className={styles.td}>{formatTimestamp(run.startedAt)}</td>
                  <td className={styles.td}>{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td className={styles.td}>{run.model ?? '—'}</td>
                  <td className={styles.td}>{run.error ? (run.error.length > 60 ? run.error.slice(0, 60) + '…' : run.error) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}
