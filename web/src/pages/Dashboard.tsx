import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { AgentRunRow, Portfolio } from '../api/client';
import { Card } from '../components/Card';
import LlmUsagePane from '../components/LlmUsagePane';
import { DailyActivityLog } from '../components/DailyActivityLog';
import { JobRunner } from '../components/JobRunner';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { centsToUSD, formatTimestamp } from '../lib/format';
import styles from './Dashboard.module.css';

type DashState = {
  trading: { enabled: boolean; mode: 'paper' | 'live' };
  jobs: Array<{ name: string; cron: string; nextRun: string | null; enabled: boolean }>;
  dataSources: Array<{ id: string; name: string; enabled: boolean; configured: boolean }>;
  lastRun: AgentRunRow | null;
};

type NavState = {
  loading: boolean;
  nav: Portfolio | null;
};

export default function DashboardPage(): JSX.Element {
  const { addToast } = useToast();
  const { canWrite } = useAuth();
  const [state, setState] = useState<DashState | null>(null);
  const [navState, setNavState] = useState<NavState>({ loading: true, nav: null });

  useEffect(() => {
    async function load() {
      const [settingsRes, jobsRes, dsRes, runsRes] = await Promise.allSettled([
        api.settings.get(),
        fetch('/api/scheduler/jobs', { credentials: 'include' }).then(r => r.json()),
        api.datasources.list(),
        api.runs.list(1, 0),
      ]);

      const trading = settingsRes.status === 'fulfilled'
        ? { enabled: settingsRes.value.data.trading.enabled, mode: settingsRes.value.data.trading.mode }
        : (() => { addToast('Failed to load trading settings', 'error'); return { enabled: false, mode: 'paper' as const }; })();

      const jobs = jobsRes.status === 'fulfilled'
        ? jobsRes.value.jobs || []
        : (() => { addToast('Failed to load scheduler', 'error'); return []; })();

      const dataSources = dsRes.status === 'fulfilled'
        ? dsRes.value.data.map(ds => ({ id: ds.id, name: ds.name, enabled: ds.enabled, configured: ds.configured }))
        : (() => { addToast('Failed to load data sources', 'error'); return []; })();

      const lastRun = runsRes.status === 'fulfilled' && runsRes.value.data.length > 0
        ? runsRes.value.data[0]
        : null;

      setState({ trading, jobs, dataSources, lastRun });
    }
    load();
  }, []);

  // Lazy load NAV (requires live price fetches)
  useEffect(() => {
    async function loadNav() {
      try {
        const portfolioRes = await api.portfolio.get();
        setNavState({ loading: false, nav: portfolioRes.data });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load portfolio';
        if (!msg.includes('not initialized')) {
          addToast(msg, 'error');
        }
        setNavState({ loading: false, nav: null });
      }
    }
    loadNav();
  }, []);

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

        <Card title="Scheduled Jobs">
          {state.jobs.length === 0
            ? <p className={styles.muted}>No scheduled jobs configured</p>
            : (() => {
                const tz = Intl.DateTimeFormat().resolvedOptions().timeZone.split('/').pop()?.replace('_', ' ') || 'Local';
                return <ul style={{ margin: 0, paddingLeft: 'var(--spacing-md)' }}>
                  {state.jobs.filter(j => j.enabled).map(job => (
                    <li key={job.name}>
                      <strong>{job.name}</strong>: {job.nextRun ? `${new Date(job.nextRun).toLocaleString()} (${tz})` : 'N/A'}
                    </li>
                  ))}
                  {state.jobs.filter(j => j.enabled).length === 0 && (
                    <li className={styles.muted}>No jobs enabled</li>
                  )}
                </ul>;
              })()
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
          {navState.loading
            ? <p className={styles.muted}>Loading...</p>
            : navState.nav
              ? <>
                  <p style={{ fontSize: '1.5rem', fontWeight: 700, margin: '0 0 var(--spacing-xs, 4px)' }}>
                    {centsToUSD(navState.nav.totalValueCents)}
                  </p>
                  <p className={navState.nav.totalReturnPercent >= 0 ? styles.positive : styles.negative}>
                    {navState.nav.totalReturnPercent >= 0 ? '+' : ''}{navState.nav.totalReturnPercent.toFixed(2)}% total return
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

        <div className={styles.fullWidth}>
          <Card title="Job Execution">
            {canWrite ? (
              <JobRunner onComplete={async () => {
                // Refresh last run after job execution
                try {
                  const runsRes = await api.runs.list(1, 0);
                  if (runsRes.data.length > 0) {
                    setState(prev => prev ? { ...prev, lastRun: runsRes.data[0] } : null);
                  }
                } catch (err) {
                  console.error('Failed to refresh last run', err);
                }
              }} />
            ) : (
              <p className={styles.muted}>Read-only access</p>
            )}
          </Card>
        </div>

        <div className={styles.fullWidth}>
          <DailyActivityLog />
        </div>
      </div>
    </div>
  );
}
