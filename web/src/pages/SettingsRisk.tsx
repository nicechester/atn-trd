import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import styles from './SettingsForm.module.css';

type FormState = {
  maxPositionWeightPercent: number;
  maxConcurrentPositions: number;
  maxNewPositionsPerRun: number;
  maxNewAllocationPercentPerRun: number;
  minCashReservePercent: number;
  maxOrderNotionalDollars: number;
  maxDrawdownPercent: number;
  minConfidenceThreshold: number;
  symbolBlocklistText: string;
  earningsBlackoutDays: number;
};

export default function SettingsRisk(): JSX.Element {
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings.get()
      .then(res => {
        const r = res.data.risk;
        setForm({
          maxPositionWeightPercent: r.maxPositionWeightPercent,
          maxConcurrentPositions: r.maxConcurrentPositions,
          maxNewPositionsPerRun: r.maxNewPositionsPerRun,
          maxNewAllocationPercentPerRun: r.maxNewAllocationPercentPerRun,
          minCashReservePercent: r.minCashReservePercent,
          maxOrderNotionalDollars: Math.round(r.maxOrderNotionalCents / 100),
          maxDrawdownPercent: r.maxDrawdownPercent,
          minConfidenceThreshold: r.minConfidenceThreshold,
          symbolBlocklistText: r.symbolBlocklist.join('\n'),
          earningsBlackoutDays: r.earningsBlackoutDays,
        });
      })
      .catch(err => addToast(err instanceof Error ? err.message : 'Failed to load settings', 'error'));
  }, []);

  function n(field: keyof FormState) {
    return {
      value: form![field] as number,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm({ ...form!, [field]: Number(e.target.value) }),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const symbolBlocklist = form.symbolBlocklistText
      .split('\n').map(s => s.trim().toUpperCase()).filter(Boolean);
    setSaving(true);
    try {
      await api.settings.patch({
        risk: {
          maxPositionWeightPercent: form.maxPositionWeightPercent,
          maxConcurrentPositions: form.maxConcurrentPositions,
          maxNewPositionsPerRun: form.maxNewPositionsPerRun,
          maxNewAllocationPercentPerRun: form.maxNewAllocationPercentPerRun,
          minCashReservePercent: form.minCashReservePercent,
          maxOrderNotionalCents: Math.round(form.maxOrderNotionalDollars * 100),
          maxDrawdownPercent: form.maxDrawdownPercent,
          minConfidenceThreshold: form.minConfidenceThreshold,
          symbolBlocklist,
          earningsBlackoutDays: form.earningsBlackoutDays,
        },
      });
      addToast('Risk settings saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <Card><p>Loading...</p></Card>;

  return (
    <Card title="Risk Parameters">
      <form onSubmit={handleSubmit}>
        {[
          { label: 'Max Position Weight (%)', field: 'maxPositionWeightPercent', min: 0, max: 100, step: 0.1 },
          { label: 'Max Concurrent Positions', field: 'maxConcurrentPositions', min: 1, step: 1 },
          { label: 'Max New Positions Per Run', field: 'maxNewPositionsPerRun', min: 0, step: 1 },
          { label: 'Max New Allocation Per Run (%)', field: 'maxNewAllocationPercentPerRun', min: 0, max: 100, step: 1 },
          { label: 'Min Cash Reserve (%)', field: 'minCashReservePercent', min: 0, max: 100, step: 0.1 },
          { label: 'Max Order Notional (USD)', field: 'maxOrderNotionalDollars', min: 1, step: 1 },
          { label: 'Max Drawdown (%)', field: 'maxDrawdownPercent', min: 0, max: 100, step: 0.1 },
          { label: 'Min Confidence Threshold', field: 'minConfidenceThreshold', min: 0, max: 1, step: 0.01 },
          { label: 'Earnings Blackout Days', field: 'earningsBlackoutDays', min: 0, step: 1 },
        ].map(({ label, field, min, max, step }) => (
          <div key={field} className={styles.field}>
            <label className={styles.label}>{label}</label>
            <input
              className={styles.input}
              type="number"
              min={min}
              max={max}
              step={step}
              {...n(field as keyof FormState)}
            />
          </div>
        ))}
        <div className={styles.field}>
          <label className={styles.label}>Symbol Blocklist (one per line)</label>
          <textarea
            className={styles.textarea}
            value={form.symbolBlocklistText}
            onChange={e => setForm({ ...form, symbolBlocklistText: e.target.value })}
            placeholder="TSLA&#10;GME"
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
