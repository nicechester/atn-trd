import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import styles from './SettingsForm.module.css';

type FormState = { timezone: string; cron: string; minIntervalHours: number };

export default function SettingsSchedule(): JSX.Element {
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [nextRuns, setNextRuns] = useState<string[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);

  function fetchNextRuns() {
    setLoadingRuns(true);
    api.scheduler.nextRuns(3)
      .then(res => setNextRuns(res.nextRuns))
      .catch(() => setNextRuns([]))
      .finally(() => setLoadingRuns(false));
  }

  useEffect(() => {
    api.settings.get()
      .then(res => {
        const s = res.data.schedule;
        setForm({ timezone: s.timezone, cron: s.cron, minIntervalHours: s.minIntervalHours });
      })
      .catch(err => addToast(err instanceof Error ? err.message : 'Failed to load settings', 'error'));
    fetchNextRuns();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.timezone.trim()) { addToast('Timezone is required', 'error'); return; }
    if (!form.cron.trim()) { addToast('Cron expression is required', 'error'); return; }
    if (form.minIntervalHours < 1) { addToast('Min interval must be at least 1 hour', 'error'); return; }
    setSaving(true);
    try {
      await api.settings.patch({
        schedule: { timezone: form.timezone.trim(), cron: form.cron.trim(), minIntervalHours: form.minIntervalHours },
      });
      addToast('Schedule settings saved', 'success');
      fetchNextRuns();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  function nextRunsHint(): string {
    if (loadingRuns) return 'Fetching next runs…';
    if (nextRuns.length === 0) return '';
    return 'Next runs: ' + nextRuns.map(r => new Date(r).toLocaleString()).join(', ');
  }

  if (!form) return <Card><p>Loading...</p></Card>;

  return (
    <Card title="Schedule">
      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label}>Timezone</label>
          <input
            className={styles.input}
            type="text"
            value={form.timezone}
            onChange={e => setForm({ ...form, timezone: e.target.value })}
            placeholder="America/New_York"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Cron Expression</label>
          <input
            className={styles.input}
            type="text"
            value={form.cron}
            onChange={e => setForm({ ...form, cron: e.target.value })}
            placeholder="30 16 * * 1-5"
          />
          {nextRunsHint() && <p className={styles.hint}>{nextRunsHint()}</p>}
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Min Interval (hours)</label>
          <input
            className={styles.input}
            type="number"
            min="1"
            step="1"
            value={form.minIntervalHours}
            onChange={e => setForm({ ...form, minIntervalHours: Number(e.target.value) })}
          />
        </div>
        <div className={styles.actions}>
          <button className={styles.saveBtn} type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Card>
  );
}
