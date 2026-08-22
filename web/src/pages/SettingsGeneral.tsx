import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import styles from './SettingsForm.module.css';

type FormState = {
  mode: 'paper' | 'live';
  enabled: boolean;
  baseCurrency: string;
  killSwitch: boolean;
};

export default function SettingsGeneral(): JSX.Element {
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings.get()
      .then(res => {
        const t = res.data.trading;
        setForm({
          mode: t.mode,
          enabled: t.enabled,
          baseCurrency: t.baseCurrency,
          killSwitch: t.killSwitch,
        });
      })
      .catch(err => addToast(err instanceof Error ? err.message : 'Failed to load settings', 'error'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (!form.baseCurrency.trim()) {
      addToast('Base currency is required', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.settings.patch({
        trading: {
          mode: form.mode,
          enabled: form.enabled,
          baseCurrency: form.baseCurrency.trim().toUpperCase(),
          killSwitch: form.killSwitch,
        },
      });
      addToast('General settings saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <Card><p>Loading...</p></Card>;

  return (
    <Card title="General">
      <form onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label}>Trading Mode</label>
          <select
            className={styles.select}
            value={form.mode}
            onChange={e => setForm({ ...form, mode: e.target.value as 'paper' | 'live' })}
          >
            <option value="paper">Paper</option>
            <option value="live">Live</option>
          </select>
        </div>
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input
            type="checkbox"
            id="enabled"
            checked={form.enabled}
            onChange={e => setForm({ ...form, enabled: e.target.checked })}
          />
          <label className={styles.label} htmlFor="enabled">Trading Enabled</label>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Base Currency</label>
          <input
            className={styles.input}
            type="text"
            maxLength={3}
            value={form.baseCurrency}
            onChange={e => setForm({ ...form, baseCurrency: e.target.value.toUpperCase() })}
          />
        </div>
        <div className={`${styles.field} ${styles.checkboxField}`}>
          <input
            type="checkbox"
            id="killSwitch"
            checked={form.killSwitch}
            onChange={e => setForm({ ...form, killSwitch: e.target.checked })}
          />
          <label className={styles.label} htmlFor="killSwitch">Kill Switch</label>
        </div>
        {form.killSwitch && (
          <p className={styles.warning}>Warning: this halts all trading activity.</p>
        )}
        <div className={styles.actions}>
          <button className={styles.saveBtn} type="submit" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Card>
  );
}
