import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import styles from './SettingsForm.module.css';

type SectorBiasRow = {
  sector: string;
  bias: number;
};

type FormState = {
  growth: number;
  value: number;
  stability: number;
  cashFlow: number;
  momentum: number;
  maxVolatility: number;
  sectorBiasRows: SectorBiasRow[];
};

export default function SettingsInvestorProfile(): JSX.Element {
  const { addToast } = useToast();
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.settings.get()
      .then(res => {
        const profile = res.data.investorProfile;
        const sectorBiasRows = Object.entries(profile.sectorBias).map(([sector, bias]) => ({
          sector,
          bias: bias as number,
        }));
        setForm({
          growth: profile.styleWeights.growth,
          value: profile.styleWeights.value,
          stability: profile.styleWeights.stability,
          cashFlow: profile.styleWeights.cashFlow,
          momentum: profile.styleWeights.momentum,
          maxVolatility: profile.maxVolatility,
          sectorBiasRows,
        });
      })
      .catch(err => addToast(err instanceof Error ? err.message : 'Failed to load settings', 'error'));
  }, []);

  function n(field: keyof Omit<FormState, 'sectorBiasRows'>) {
    return {
      value: form![field] as number,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
        setForm({ ...form!, [field]: Number(e.target.value) }),
    };
  }

  function weightSum(): number {
    if (!form) return 0;
    return form.growth + form.value + form.stability + form.cashFlow + form.momentum;
  }

  function isValidWeightSum(): boolean {
    const sum = weightSum();
    return Math.abs(sum - 100) <= 0.5;
  }

  function handleAddSectorBias() {
    if (!form) return;
    setForm({
      ...form,
      sectorBiasRows: [...form.sectorBiasRows, { sector: '', bias: 0 }],
    });
  }

  function handleRemoveSectorBias(index: number) {
    if (!form) return;
    setForm({
      ...form,
      sectorBiasRows: form.sectorBiasRows.filter((_, i) => i !== index),
    });
  }

  function handleSectorBiasChange(index: number, field: 'sector' | 'bias', value: string | number) {
    if (!form) return;
    const updated = [...form.sectorBiasRows];
    updated[index] = {
      ...updated[index],
      [field]: field === 'bias' ? Number(value) : value,
    };
    setForm({ ...form, sectorBiasRows: updated });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;

    const sum = weightSum();
    if (Math.abs(sum - 100) > 0.5) {
      addToast(`Style weights must sum to 100 ± 0.5 (currently ${sum.toFixed(1)})`, 'error');
      return;
    }

    const sectorBias: Record<string, number> = {};
    for (const row of form.sectorBiasRows) {
      if (row.sector.trim()) {
        sectorBias[row.sector.trim()] = row.bias;
      }
    }

    setSaving(true);
    try {
      await api.settings.patch({
        investorProfile: {
          styleWeights: {
            growth: form.growth,
            value: form.value,
            stability: form.stability,
            cashFlow: form.cashFlow,
            momentum: form.momentum,
          },
          maxVolatility: form.maxVolatility,
          sectorBias,
        },
      });
      addToast('Investor profile settings saved', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!form) return <Card><p>Loading...</p></Card>;

  const weightSumValue = weightSum();
  const isValid = isValidWeightSum();
  const weightWarningClass = isValid ? '' : styles.invalid;

  return (
    <Card title="Investor Profile">
      <form onSubmit={handleSubmit}>
        {/* Intro */}
        <div style={{ marginBottom: '2rem', padding: '1rem', backgroundColor: '#f5f5f5', borderRadius: '4px' }}>
          <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#666' }}>
            Configure your investment style preferences. The five style weights must sum to 100. Each percentage represents how much you prioritize that investment approach.
          </p>
        </div>

        {/* Style Weights Section */}
        <div style={{ marginBottom: '2rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Style Weights (must sum to 100)</h3>
          <p style={{ marginBottom: '1rem', fontSize: '0.85rem', color: '#666' }}>
            Adjust sliders to match your investment philosophy. Use both the slider and number input.
          </p>
          {[
            { label: 'Growth', field: 'growth', desc: 'Strong revenue/earnings growth (expanding companies)' },
            { label: 'Value', field: 'value', desc: 'Low P/E, undervalued stocks (bargain hunting)' },
            { label: 'Stability', field: 'stability', desc: 'Low volatility, blue chips (conservative, defensive)' },
            { label: 'Cash Flow', field: 'cashFlow', desc: 'Dividends and free cash flow (income focus)' },
            { label: 'Momentum', field: 'momentum', desc: 'Price trend following (short-term moves)' },
          ].map(({ label, field, desc }) => (
            <div key={field} className={styles.field}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <div>
                  <label className={styles.label}>{label}</label>
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.75rem', color: '#999' }}>{desc}</p>
                </div>
                <span style={{ fontWeight: 'bold', marginLeft: '1rem' }}>{form[field as keyof Omit<FormState, 'sectorBiasRows'>]}</span>
              </div>
              <input
                className={styles.input}
                type="range"
                min={0}
                max={100}
                step={1}
                {...n(field as keyof Omit<FormState, 'sectorBiasRows'>)}
              />
              <input
                className={styles.input}
                type="number"
                min={0}
                max={100}
                step={0.1}
                {...n(field as keyof Omit<FormState, 'sectorBiasRows'>)}
              />
            </div>
          ))}
          <div className={styles.field}>
            <label className={styles.label}>Total Weight</label>
            <div className={weightWarningClass} style={{ padding: '0.5rem', fontWeight: 'bold' }}>
              {weightSumValue.toFixed(1)} / 100
              {!isValid && ' ⚠ Must sum to 100 ± 0.5'}
            </div>
          </div>
        </div>

        {/* Max Volatility Section */}
        <div style={{ marginBottom: '2rem', marginTop: '2rem' }}>
          <label className={styles.label}>Max Volatility Tolerance</label>
          <p style={{ marginBottom: '0.5rem', fontSize: '0.85rem', color: '#666' }}>
            Maximum annualized volatility (price swing) you'll accept. Values: 0.20 = 20%, 0.35 = 35%, 0.50 = 50%, etc. Stocks exceeding this will be filtered out.
          </p>
          <input
            className={styles.input}
            type="number"
            min={0}
            max={5}
            step={0.01}
            {...n('maxVolatility')}
            style={{ maxWidth: '150px' }}
          />
        </div>

        {/* Sector Bias Section */}
        <div style={{ marginBottom: '2rem', marginTop: '2rem' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Sector Bias (Optional)</h3>
          <p style={{ marginBottom: '1rem', fontSize: '0.85rem', color: '#666' }}>
            Adjust preference for specific sectors. 1.0 = neutral, 1.5 = 50% more preference, 0.5 = 50% less preference, 0 = avoid completely. Examples: Technology 1.5, Energy 0.5
          </p>
          {form.sectorBiasRows.length === 0 ? (
            <p style={{ color: '#999' }}>No sector biases configured</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #ddd' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Sector</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Bias</th>
                  <th style={{ textAlign: 'center', padding: '0.5rem', width: '50px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {form.sectorBiasRows.map((row, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '0.5rem' }}>
                      <input
                        type="text"
                        className={styles.input}
                        style={{ marginBottom: 0 }}
                        placeholder="e.g., Technology"
                        value={row.sector}
                        onChange={e => handleSectorBiasChange(idx, 'sector', e.target.value)}
                      />
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <input
                        type="number"
                        className={styles.input}
                        style={{ marginBottom: 0 }}
                        placeholder="0"
                        value={row.bias}
                        onChange={e => handleSectorBiasChange(idx, 'bias', e.target.value)}
                      />
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleRemoveSectorBias(idx)}
                        style={{
                          backgroundColor: '#f44336',
                          color: 'white',
                          border: 'none',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '3px',
                          cursor: 'pointer',
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <button
            type="button"
            onClick={handleAddSectorBias}
            style={{
              backgroundColor: '#2196F3',
              color: 'white',
              border: 'none',
              padding: '0.5rem 1rem',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
          >
            Add Sector Bias
          </button>
        </div>

        <div className={styles.actions}>
          <button className={styles.saveBtn} type="submit" disabled={saving || !isValid}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Example Profiles Reference */}
        <div style={{ marginTop: '3rem', padding: '1rem', backgroundColor: '#f9f9f9', borderRadius: '4px', fontSize: '0.85rem', color: '#333' }}>
          <h4 style={{ margin: '0 0 0.75rem 0', color: '#222' }}>📋 Example Profiles</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <strong>Growth Investor:</strong> Growth 60, Stability 30, Value 10, Cash Flow 0, Momentum 0
            </div>
            <div>
              <strong>Income/Dividend:</strong> Cash Flow 50, Stability 30, Value 20, Growth 0, Momentum 0
            </div>
            <div>
              <strong>Balanced:</strong> Growth 30, Value 30, Stability 20, Cash Flow 10, Momentum 10
            </div>
            <div>
              <strong>Aggressive Momentum:</strong> Momentum 50, Growth 40, Stability 10, Value 0, Cash Flow 0
            </div>
          </div>
        </div>
      </form>
    </Card>
  );
}
