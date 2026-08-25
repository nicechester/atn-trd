import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { SecretField } from '../components/SecretField';
import { useToast } from '../context/ToastContext';
import styles from './SettingsForm.module.css';

type LlmFormState = {
  model: string;
  baseUrl: string;
  temperature: number;
  timeoutSeconds: number;
  localLlmMode: boolean;
  analystModel: string;
  portfolioManagerModel: string;
  semanticMemoryEnabled: boolean;
};

type LlmTestResult = {
  model: string;
  latency: number;
  tokens?: { inputTokens: number; outputTokens: number; totalTokens?: number };
} | null;

export default function SettingsLlm(): JSX.Element {
  const { addToast } = useToast();
  const [form, setForm] = useState<LlmFormState | null>(null);
  const [apiKeyIsSet, setApiKeyIsSet] = useState(false);
  const [lastResult, setLastResult] = useState<LlmTestResult>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.settings.get(), api.secrets.list()])
      .then(([settingsRes, secretsRes]) => {
        const llm = settingsRes.data.llm;
        setForm({
          model: llm.model,
          baseUrl: llm.baseUrl ?? '',
          temperature: llm.temperature,
          timeoutSeconds: llm.timeoutMs / 1000,
          localLlmMode: llm.localLlmMode ?? false,
          analystModel: llm.agents?.analyst?.model ?? '',
          portfolioManagerModel: llm.agents?.portfolioManager?.model ?? '',
          semanticMemoryEnabled: settingsRes.data.semanticMemory?.enabled ?? false,
        });
        setApiKeyIsSet(secretsRes.data.some((s: { name: string; isSet: boolean }) => s.name === 'LLM_API_KEY' && s.isSet));
      })
      .catch(err => addToast(err instanceof Error ? err.message : 'Failed to load LLM settings', 'error'));
  }, []);

  async function handleTest() {
    setTesting(true);
    try {
      const res = await api.llm.test();
      addToast('LLM test passed', 'success');
      setLastResult((res.data ?? null) as LlmTestResult);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'LLM test failed', 'error');
      setLastResult(null);
    } finally {
      setTesting(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.timeoutSeconds < 1) { addToast('Timeout must be at least 1 second', 'error'); return; }
    setSaving(true);
    try {
      await api.settings.patch({
        llm: {
          provider: 'openai',
          model: form.model.trim(),
          baseUrl: form.baseUrl.trim(),
          temperature: form.temperature,
          timeoutMs: form.timeoutSeconds * 1000,
          localLlmMode: form.localLlmMode,
          agents: {
            analyst: { model: form.analystModel.trim() },
            portfolioManager: { model: form.portfolioManagerModel.trim() },
          },
        },
        semanticMemory: {
          enabled: form.semanticMemoryEnabled,
        },
      });
      addToast('LLM settings saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <Card><p>Loading...</p></Card>;

  return (
    <div>
      <Card title="LLM Configuration">
        <form onSubmit={handleSave}>
          <div className={styles.field}>
            <SecretField
              label="API Key"
              name="LLM_API_KEY"
              isSet={apiKeyIsSet}
              onSet={async (value) => {
                await api.secrets.set('LLM_API_KEY', value);
                addToast('Key saved', 'success');
                setApiKeyIsSet(true);
              }}
              onClear={async () => {
                await api.secrets.clear('LLM_API_KEY');
                addToast('Key cleared', 'info');
                setApiKeyIsSet(false);
              }}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Base URL</label>
            <input
              className={styles.input}
              type="text"
              value={form.baseUrl}
              onChange={e => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
            <p className={styles.hint}>Leave blank to use the default OpenAI endpoint</p>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Model</label>
            <input
              className={styles.input}
              type="text"
              value={form.model}
              onChange={e => setForm({ ...form, model: e.target.value })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Temperature</label>
            <input
              className={styles.input}
              type="number"
              min="0"
              max="2"
              step="0.1"
              value={form.temperature}
              onChange={e => setForm({ ...form, temperature: Number(e.target.value) })}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Timeout (seconds)</label>
            <input
              className={styles.input}
              type="number"
              min="1"
              step="1"
              value={form.timeoutSeconds}
              onChange={e => setForm({ ...form, timeoutSeconds: Number(e.target.value) })}
            />
            <p className={styles.hint}>Stored as milliseconds; min 1 second</p>
          </div>
          <div className={`${styles.field} ${styles.checkboxField}`}>
            <input
              type="checkbox"
              id="localLlmMode"
              checked={form.localLlmMode}
              onChange={e => setForm({ ...form, localLlmMode: e.target.checked })}
            />
            <label className={styles.label} htmlFor="localLlmMode">Local LLM Mode</label>
          </div>
          <p className={styles.hint}>
            Optimizes for limited VRAM: sequential processing, fewer news articles (10), shorter lookback (7 days), 
            truncated summaries, and 28K token context limit. Disable for cloud APIs like GPT-4.
          </p>
          <div className={styles.field}>
            <label className={styles.label}>Analyst Model Override</label>
            <input
              className={styles.input}
              type="text"
              value={form.analystModel}
              onChange={e => setForm({ ...form, analystModel: e.target.value })}
              placeholder="e.g., gpt-4o"
            />
            <p className={styles.hint}>Leave blank to use the default model above.</p>
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Portfolio Manager Model Override</label>
            <input
              className={styles.input}
              type="text"
              value={form.portfolioManagerModel}
              onChange={e => setForm({ ...form, portfolioManagerModel: e.target.value })}
              placeholder="e.g., gpt-4o-mini"
            />
            <p className={styles.hint}>Leave blank to use the default model above.</p>
          </div>
          <div className={`${styles.field} ${styles.checkboxField}`}>
            <input
              type="checkbox"
              id="semanticMemoryEnabled"
              checked={form.semanticMemoryEnabled}
              onChange={e => setForm({ ...form, semanticMemoryEnabled: e.target.checked })}
            />
            <label className={styles.label} htmlFor="semanticMemoryEnabled">Semantic Memory (learn from past assessments and trade outcomes)</label>
          </div>
          <p className={styles.hint}>Requires an API key above. Embeds assessments and realized trade outcomes so the agent can recall similar past situations.</p>
          <div className={styles.actions} style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
            <button
              type="button"
              className={styles.saveBtn}
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
              onClick={handleTest}
              disabled={testing}
            >
              {testing ? 'Testing...' : 'Test'}
            </button>
            <button className={styles.saveBtn} type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </Card>

      {lastResult && (
        <div style={{ marginTop: 'var(--spacing-md)' }}>
          <Card title="Last Test Result">
            <p>Model: {lastResult.model}</p>
            <p>Latency: {lastResult.latency}ms</p>
            {lastResult.tokens && (
              <p>Tokens: {lastResult.tokens.inputTokens} in / {lastResult.tokens.outputTokens} out</p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
