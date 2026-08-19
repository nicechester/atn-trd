import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import styles from './Dashboard.module.css';

type DashState = {
  trading: { enabled: boolean; mode: 'paper' | 'live' };
  nextRuns: string[];
  dataSources: Array<{ id: string; name: string; enabled: boolean; configured: boolean }>;
};

export default function DashboardPage(): JSX.Element {
  const { addToast } = useToast();
  const [state, setState] = useState<DashState | null>(null);

  useEffect(() => {
    async function load() {
      const [settingsRes, schedulerRes, dsRes] = await Promise.allSettled([
        api.settings.get(),
        api.scheduler.nextRuns(3),
        api.datasources.list(),
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

      setState({ trading, nextRuns, dataSources });
    }
    load();
  }, []);

  if (!state) return <div><p>Loading...</p></div>;

  return (
    <div>
      <h1>Dashboard</h1>
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
          <p className={styles.muted}>No runs yet. Run history will appear here.</p>
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
          <button disabled title="Available in Phase 2" className={styles.disabledBtn}>
            Run Now
          </button>
        </Card>
      </div>
    </div>
  );
}
