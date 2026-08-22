import { useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AgentRunRow, Portfolio } from '../api/client';
import { Card } from '../components/Card';
import LlmUsagePane from '../components/LlmUsagePane';
import { useToast } from '../context/ToastContext';
import { centsToUSD, formatTimestamp } from '../lib/format';
import styles from './Dashboard.module.css';

type DashState = {
  trading: { enabled: boolean; mode: 'paper' | 'live' };
  nextRuns: string[];
  dataSources: Array<{ id: string; name: string; enabled: boolean; configured: boolean }>;
  lastRun: AgentRunRow | null;
  nav: Portfolio | null;
};

export default function DashboardPage(): JSX.Element {
  const { addToast } = useToast();
  const navigate = useNavigate();
  const [state, setState] = useState<DashState | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(true);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function load() {
      const [settingsRes, schedulerRes, dsRes, runsRes, portfolioRes] = await Promise.allSettled([
        api.settings.get(),
        api.scheduler.nextRuns(3),
        api.datasources.list(),
        api.runs.list(1, 0),
        api.portfolio.get(),
      ]);

      const trading = settingsRes.status === 'fulfilled'
        ? { enabled: settingsRes.value.data.trading.enabled, mode: settingsRes.value.data.trading.mode }
        : (() => { addToast('Failed to load trading settings', 'error'); return { enabled: false, mode: 'paper' as const }; })();

      const nextRuns = schedulerRes.status === 'fulfilled'
        ? schedulerRes.value.nextRuns
        : (() => { addToast('Failed to load scheduler', 'error'); return []; })();

      const dataSources = dsRes.status === 'fulfilled'
        ? dsRes.value.data.map(ds => ({ id: ds.id, name: ds.name, enabled: ds.enabled, configured: ds.configured }))
        : (() => { addToast('Failed to load data sources', 'error'); return []; })();

      const lastRun = runsRes.status === 'fulfilled' && runsRes.value.data.length > 0
        ? runsRes.value.data[0]
        : null;

      let nav: Portfolio | null = null;
      if (portfolioRes.status === 'fulfilled') {
        nav = portfolioRes.value.data;
      } else if (portfolioRes.status === 'rejected') {
        const err = portfolioRes.reason;
        const msg = err instanceof Error ? err.message : 'Failed to load portfolio';
        if (!msg.includes('not initialized')) {
          addToast(msg, 'error');
        }
      }

      setState({ trading, nextRuns, dataSources, lastRun, nav });
    }
    load();
  }, []);

  async function runNow() {
    setRunning(true);
    setProgress([]);
    setExpanded(true);

    // Start SSE connection for progress
    const eventSource = new EventSource('/api/runs/progress/stream');
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setProgress(prev => [...prev.slice(-19), data.message]); // Keep last 20
        // Auto-scroll
        if (progressRef.current) {
          progressRef.current.scrollTop = progressRef.current.scrollHeight;
        }
        if (data.phase === 'complete') {
          eventSource.close();
          setExpanded(false);
        }
      } catch {}
    };

    try {
      const result = await api.runs.trigger();
      addToast('Run completed', 'success');
      // Small delay to show final progress
      setTimeout(() => navigate(`/runs/${result.runId}`), 1000);
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to trigger run', 'error');
      eventSource.close();
    } finally {
      setRunning(false);
    }
  }

  function statusBadgeClass(status: AgentRunRow['status']) {
    if (status === 'succeeded') return styles.badgeGreen;
    if (status === 'failed') return styles.badgeRed;
    if (status === 'running') return styles.badgeYellow;
    return styles.badgeGray;
  }

  if (!state) return <div><p>Loading...</p></div>;

  return (
    <div>
      <h1>Dashboard</h1>
      <LlmUsagePane />
      <div className={styles.grid}>
        <Card title="Trading Status">
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap' }}>
            <span className={state.trading.enabled ? styles.badgeGreen : styles.badgeRed}>
              {state.trading.enabled ? 'Enabled' : 'Disabled'}
            </span>
            <span className={styles.badgeGray}>
              {state.trading.mode === 'paper' ? 'Paper Trading' : 'Live Trading'}
            </span>
          </div>
        </Card>

        <Card title="Next Scheduled Runs">
          {state.nextRuns.length === 0
            ? <p className={styles.muted}>No scheduled runs configured</p>
            : <ul style={{ margin: 0, paddingLeft: 'var(--spacing-md)' }}>
                {state.nextRuns.map(run => (
                  <li key={run}>{new Date(run).toLocaleString()}</li>
                ))}
              </ul>
          }
        </Card>

        <Card title="Last Run">
          {state.lastRun
            ? <>
                <div style={{ display: 'flex', gap: 'var(--spacing-sm)', flexWrap: 'wrap', marginBottom: 'var(--spacing-sm)' }}>
                  <span className={statusBadgeClass(state.lastRun.status)}>{state.lastRun.status}</span>
                  <span className={styles.badgeGray}>{state.lastRun.trigger}</span>
                </div>
                <p className={styles.muted}>{formatTimestamp(state.lastRun.startedAt)}</p>
                <Link to={`/runs/${state.lastRun.id}`} style={{ color: 'var(--color-primary)', fontSize: '0.875rem' }}>View detail →</Link>
              </>
            : <p className={styles.muted}>No runs yet.</p>
          }
        </Card>

        <Card title="Current NAV">
          {state.nav
            ? <>
                <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 var(--spacing-xs, 4px)' }}>
                  {centsToUSD(state.nav.totalValueCents)}
                </p>
                <p className={state.nav.totalReturnPercent >= 0 ? styles.positive : styles.negative}>
                  {state.nav.totalReturnPercent >= 0 ? '+' : ''}{state.nav.totalReturnPercent.toFixed(2)}% total return
                </p>
              </>
            : <p className={styles.muted}>Portfolio not initialized.</p>
          }
        </Card>

        <Card title="Data Sources">
          {state.dataSources.length === 0
            ? <p className={styles.muted}>No data sources configured</p>
            : <div className={styles.tileGrid}>
                {state.dataSources.map(ds => (
                  <div key={ds.id} className={styles.tile}>
                    <span className={ds.enabled && ds.configured ? styles.dotGreen : styles.dotRed} />
                    <span>{ds.name}</span>
                  </div>
                ))}
              </div>
          }
        </Card>

        <Card title="Actions">
          <button
            className={running ? styles.disabledBtn : styles.activeBtn}
            disabled={running}
            onClick={runNow}
          >
            {running ? 'Running…' : 'Run Now'}
          </button>
          {progress.length > 0 && (
            <div className={styles.progressContainer}>
              <button
                className={styles.collapseBtn}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? '▼' : '▶'} Progress ({progress.length})
              </button>
              {expanded && (
                <div ref={progressRef} className={styles.progressLog}>
                  {progress.map((msg, i) => (
                    <div key={i} className={styles.progressLine}>{msg}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
