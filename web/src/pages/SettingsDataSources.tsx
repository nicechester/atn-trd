import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { SecretField } from '../components/SecretField';
import { TestButton } from '../components/TestButton';
import { useToast } from '../context/ToastContext';
import styles from './SettingsForm.module.css';

type DsEntry = {
  id: string;
  name: string;
  provider: string;
  configured: boolean;
  enabled: boolean;
  requiresKey: boolean;
  secretName: string | null;
};

type DsFormValues = {
  news: { provider: 'finnhub' | 'yahoo'; enabled: boolean };
  fundamentals: { provider: 'yahoo'; enabled: boolean };
  macro: { provider: 'fred'; enabled: boolean };
  options: { provider: 'yahoo'; enabled: boolean };
};

type SecretMap = Record<string, boolean>;

export default function SettingsDataSources(): JSX.Element {
  const { addToast } = useToast();
  const [entries, setEntries] = useState<DsEntry[] | null>(null);
  const [form, setForm] = useState<DsFormValues | null>(null);
  const [secrets, setSecrets] = useState<SecretMap>({});
  const [saving, setSaving] = useState(false);

  async function fetchData() {
    try {
      const [dsRes, secRes] = await Promise.all([api.datasources.list(), api.secrets.list()]);
      setEntries(dsRes.data as DsEntry[]);
      const secretMap: SecretMap = {};
      for (const s of secRes.data) { secretMap[s.name] = s.isSet; }
      setSecrets(secretMap);
      const findEntry = (id: string) => dsRes.data.find(e => e.id === id);
      const news = findEntry('news');
      const fundamentals = findEntry('fundamentals');
      const macro = findEntry('macro');
      const options = findEntry('options');
      setForm({
        news: { provider: (news?.provider as 'finnhub' | 'yahoo') ?? 'yahoo', enabled: news?.enabled ?? false },
        fundamentals: { provider: 'yahoo', enabled: fundamentals?.enabled ?? false },
        macro: { provider: 'fred', enabled: macro?.enabled ?? false },
        options: { provider: 'yahoo', enabled: options?.enabled ?? false },
      });
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to load data sources', 'error');
    }
  }

  useEffect(() => { fetchData(); }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    try {
      await api.settings.patch({
        dataSources: {
          news: { provider: form.news.provider, enabled: form.news.enabled },
          fundamentals: { provider: 'yahoo', enabled: form.fundamentals.enabled },
          macro: { provider: 'fred', enabled: form.macro.enabled },
          options: { provider: 'yahoo', enabled: form.options.enabled },
        },
      });
      addToast('Data source settings saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!entries || !form) return <Card><p>Loading...</p></Card>;

  const SOURCE_ORDER = ['news', 'fundamentals', 'macro', 'options'];
  const orderedEntries = SOURCE_ORDER
    .map(id => entries.find(e => e.id === id))
    .filter((e): e is DsEntry => Boolean(e));

  return (
    <form onSubmit={handleSave}>
      {orderedEntries.map(entry => {
        const id = entry.id as keyof DsFormValues;
        const formEntry = form[id];
        const showKeyField = entry.requiresKey &&
          (entry.id !== 'news' || form.news.provider === 'finnhub');

        return (
          <div key={entry.id} style={{ marginBottom: 'var(--spacing-lg)' }}>
            <Card title={entry.name}>
              <div className={`${styles.field} ${styles.checkboxField}`}>
                <input
                  type="checkbox"
                  id={`${entry.id}-enabled`}
                  checked={formEntry.enabled}
                  onChange={e => setForm({ ...form, [id]: { ...formEntry, enabled: e.target.checked } })}
                />
                <label className={styles.label} htmlFor={`${entry.id}-enabled`}>Enabled</label>
              </div>

              {entry.id === 'news' && (
                <div className={styles.field}>
                  <label className={styles.label}>Provider</label>
                  <select
                    className={styles.select}
                    value={form.news.provider}
                    onChange={e => setForm({ ...form, news: { ...form.news, provider: e.target.value as 'finnhub' | 'yahoo' } })}
                  >
                    <option value="finnhub">Finnhub</option>
                    <option value="yahoo">Yahoo</option>
                  </select>
                </div>
              )}

              {showKeyField && entry.secretName && (
                <div className={styles.field}>
                  <SecretField
                    label={entry.id === 'news' ? 'Finnhub API Key' : entry.id === 'macro' ? 'FRED API Key' : 'API Key'}
                    name={entry.secretName}
                    isSet={secrets[entry.secretName] ?? false}
                    onSet={async (value) => {
                      await api.secrets.set(entry.secretName!, value);
                      addToast('Key saved', 'success');
                      await fetchData();
                    }}
                    onClear={async () => {
                      await api.secrets.clear(entry.secretName!);
                      addToast('Key cleared', 'info');
                      await fetchData();
                    }}
                  />
                </div>
              )}

              <div style={{ marginTop: 'var(--spacing-sm)' }}>
                <TestButton
                  label="Test Connection"
                  onTest={async () => {
                    const r = await api.datasources.test(entry.id);
                    return r;
                  }}
                />
              </div>
            </Card>
          </div>
        );
      })}

      <div className={styles.actions}>
        <button className={styles.saveBtn} type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save All'}
        </button>
      </div>
    </form>
  );
}
