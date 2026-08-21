import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import styles from './SettingsForm.module.css';

type WatchlistRow = { symbol: string; enabled: boolean; addedAt: number | null; note: string | null };
type WatchlistSettings = { autoBacktest: boolean; autoBacktestMonths: number };

export default function SettingsWatchlist(): JSX.Element {
  const { addToast } = useToast();
  const [symbols, setSymbols] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [watchlistSettings, setWatchlistSettings] = useState<WatchlistSettings>({ autoBacktest: true, autoBacktestMonths: 12 });

  useEffect(() => {
    Promise.all([
      api.watchlist.list(),
      api.settings.get(),
    ]).then(([watchlistRes, settingsRes]) => {
      setSymbols(watchlistRes.data);
      if (settingsRes.data?.watchlist) {
        setWatchlistSettings({
          autoBacktest: settingsRes.data.watchlist.autoBacktest ?? true,
          autoBacktestMonths: settingsRes.data.watchlist.autoBacktestMonths ?? 12,
        });
      }
    }).catch(err => addToast(err instanceof Error ? err.message : 'Failed to load', 'error'))
      .finally(() => setLoading(false));
  }, []);

  async function handleToggle(symbol: string, enabled: boolean) {
    setToggling(prev => new Set(prev).add(symbol));
    try {
      await api.watchlist.patch(symbol, !enabled);
      setSymbols(prev => prev.map(r => r.symbol === symbol ? { ...r, enabled: !enabled } : r));
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Toggle failed', 'error');
    } finally {
      setToggling(prev => { const s = new Set(prev); s.delete(symbol); return s; });
    }
  }

  async function handleRemove(symbol: string) {
    try {
      await api.watchlist.remove(symbol);
      setSymbols(prev => prev.filter(r => r.symbol !== symbol));
      addToast(`Removed ${symbol}`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Remove failed', 'error');
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const syms = input.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    if (syms.length === 0) return;
    setAdding(true);
    const added: string[] = [];
    const failed: string[] = [];
    try {
      for (const sym of syms) {
        try {
          const validation = await api.symbols.validate(sym);
          if (!validation.ok || !validation.data) { failed.push(sym); continue; }
          await api.watchlist.add(sym);
          setSymbols(prev => prev.find(r => r.symbol === sym) ? prev : [...prev, { symbol: sym, enabled: true, addedAt: Date.now(), note: null }]);
          added.push(sym);
        } catch {
          failed.push(sym);
        }
      }
      if (added.length) addToast(`Added: ${added.join(', ')}`, 'success');
      if (failed.length) addToast(`Not found: ${failed.join(', ')}`, 'error');
      if (added.length) setInput('');
    } finally {
      setAdding(false);
    }
  }

  async function handleAutoBacktestToggle(enabled: boolean) {
    try {
      await api.settings.patch({ watchlist: { autoBacktest: enabled } });
      setWatchlistSettings(prev => ({ ...prev, autoBacktest: enabled }));
      addToast(`Auto-backtest ${enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update setting', 'error');
    }
  }

  return (
    <div>
      <Card title="Watchlist Settings">
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={watchlistSettings.autoBacktest}
            onChange={e => handleAutoBacktestToggle(e.target.checked)}
          />
          <span>Run backtest automatically when watchlist changes</span>
        </label>
        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 'var(--spacing-sm)', marginBottom: 0 }}>
          Backtests the last {watchlistSettings.autoBacktestMonths} months to help the agent learn from historical patterns.
        </p>
      </Card>

      <div style={{ marginTop: 'var(--spacing-md)' }}>
      <Card title="Watchlist">
        {loading ? <p>Loading...</p> : symbols.length === 0 ? (
          <p style={{ color: 'var(--color-text-muted)' }}>No symbols in watchlist.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', paddingBottom: 'var(--spacing-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Symbol</th>
                <th style={{ textAlign: 'left', paddingBottom: 'var(--spacing-sm)', color: 'var(--color-text-muted)', fontWeight: 500 }}>Enabled</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {symbols.map(row => (
                <tr key={row.symbol} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: 'var(--spacing-sm) 0', fontWeight: 600 }}>{row.symbol}</td>
                  <td style={{ padding: 'var(--spacing-sm) 0' }}>
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      disabled={toggling.has(row.symbol)}
                      onChange={() => handleToggle(row.symbol, row.enabled)}
                    />
                  </td>
                  <td style={{ padding: 'var(--spacing-sm) 0', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => handleRemove(row.symbol)}
                      style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', color: 'var(--color-text-muted)', padding: '2px 8px' }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      </div>
      <div style={{ marginTop: 'var(--spacing-md)' }}>
        <Card title="Add Symbol">
          <form onSubmit={handleAdd} style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-end' }}>
            <div className={styles.field} style={{ marginBottom: 0, flex: 1 }}>
              <label className={styles.label}>Symbol</label>
              <input
                className={styles.input}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value.toUpperCase())}
                placeholder="e.g. AAPL, MSFT, NVDA"
                style={{ maxWidth: '100%' }}
              />
            </div>
            <button className={styles.saveBtn} type="submit" disabled={adding || !input.trim()} style={{ marginBottom: 0 }}>
              {adding ? 'Adding...' : 'Add'}
            </button>
          </form>
        </Card>
      </div>
    </div>
  );
}
