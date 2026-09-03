import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Card } from '../components/Card';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import styles from './SettingsForm.module.css';

type WatchlistRow = { symbol: string; enabled: boolean; addedAt: number | null; note: string | null };
type UniverseOption = 'sp500' | 'nasdaq100' | 'russell2000' | 'tech' | 'healthcare' | 'commodity' | 'crypto' | 'custom';

type WatchlistSettings = {
  autoBacktest: boolean;
  autoBacktestMonths: number;
  mode: 'manual' | 'dynamic';
  dynamic: {
    universes: UniverseOption[];
    customSymbols: string[];
    maxCandidates: number;
    minPrice: number;
    maxPrice: number;
    minVolume: number;
    minMarketCap: number;
  };
};

export default function SettingsWatchlist(): JSX.Element {
  const { addToast } = useToast();
  const { canWrite } = useAuth();
  const [symbols, setSymbols] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [adding, setAdding] = useState(false);
  const [runningScreener, setRunningScreener] = useState(false);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [watchlistSettings, setWatchlistSettings] = useState<WatchlistSettings>({
    autoBacktest: true,
    autoBacktestMonths: 12,
    mode: 'manual',
    dynamic: {
      universes: ['sp500'],
      customSymbols: [],
      maxCandidates: 50,
      minPrice: 1,
      maxPrice: 10000,
      minVolume: 1000000,
      minMarketCap: 0,
    },
  });

  useEffect(() => {
    Promise.all([
      api.watchlist.list(),
      api.settings.get(),
    ]).then(([watchlistRes, settingsRes]) => {
      setSymbols(watchlistRes.data);
      if (settingsRes.data?.watchlist) {
        setWatchlistSettings(prev => ({
          ...prev,
          autoBacktest: settingsRes.data.watchlist.autoBacktest ?? true,
          autoBacktestMonths: settingsRes.data.watchlist.autoBacktestMonths ?? 12,
          mode: settingsRes.data.watchlist.mode ?? 'manual',
          dynamic: settingsRes.data.watchlist.dynamic ?? prev.dynamic,
        }));
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

  async function handleModeChange(newMode: 'manual' | 'dynamic') {
    try {
      await api.settings.patch({ watchlist: { mode: newMode }, screener: { enabled: newMode === 'dynamic' } });
      setWatchlistSettings(prev => ({ ...prev, mode: newMode }));
      addToast(`Watchlist mode changed to ${newMode}`, 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update setting', 'error');
    }
  }

  async function handleDynamicConfigChange(updates: Partial<WatchlistSettings['dynamic']>) {
    try {
      await api.settings.patch({ watchlist: { dynamic: { ...watchlistSettings.dynamic, ...updates } } });
      setWatchlistSettings(prev => ({
        ...prev,
        dynamic: { ...prev.dynamic, ...updates },
      }));
      addToast('Pre-filter settings updated', 'success');
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
        <Card title="Watchlist Mode">
          <div style={{ display: 'flex', gap: 'var(--spacing-md)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', cursor: 'pointer' }}>
              <input
                type="radio"
                name="watchlist-mode"
                value="manual"
                checked={watchlistSettings.mode === 'manual'}
                onChange={() => handleModeChange('manual')}
              />
              <span>Manual (use watchlist symbols)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', cursor: 'pointer' }}>
              <input
                type="radio"
                name="watchlist-mode"
                value="dynamic"
                checked={watchlistSettings.mode === 'dynamic'}
                onChange={() => handleModeChange('dynamic')}
              />
              <span>Dynamic (use screener)</span>
            </label>
          </div>
          <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 'var(--spacing-sm)', marginBottom: 0 }}>
            Choose how to populate the candidate symbols: manually or via the AI screener.
          </p>
        </Card>
      </div>

      {watchlistSettings.mode === 'dynamic' && (
        <div style={{ marginTop: 'var(--spacing-md)' }}>
          <Card title="Screener Universe & Pre-Filter">
            <div className={styles.field}>
              <label className={styles.label}>Universes (Select Multiple)</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--spacing-sm)' }}>
                {(['sp500', 'nasdaq100', 'russell2000', 'tech', 'healthcare', 'commodity', 'crypto', 'custom'] as const).map(universeKey => {
                  const labels: Record<UniverseOption, string> = {
                    sp500: 'S&P 500',
                    nasdaq100: 'NASDAQ 100',
                    russell2000: 'Russell 2000',
                    tech: 'Tech Sector',
                    healthcare: 'Healthcare Sector',
                    commodity: 'Commodity ETFs',
                    crypto: 'Crypto ETFs',
                    custom: 'Custom List',
                  };
                  return (
                    <label key={universeKey} style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={watchlistSettings.dynamic.universes.includes(universeKey)}
                        onChange={e => {
                          const updated = e.target.checked
                            ? [...watchlistSettings.dynamic.universes, universeKey]
                            : watchlistSettings.dynamic.universes.filter(u => u !== universeKey);
                          handleDynamicConfigChange({ universes: updated });
                        }}
                      />
                      <span>{labels[universeKey]}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {watchlistSettings.dynamic.universes.includes('custom') && (
              <div className={styles.field}>
                <label className={styles.label}>Custom Symbols (comma-separated)</label>
                <textarea
                  className={styles.input}
                  value={watchlistSettings.dynamic.customSymbols.join(', ')}
                  onChange={e => handleDynamicConfigChange({
                    customSymbols: e.target.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
                  })}
                  rows={4}
                  placeholder="AAPL, MSFT, NVDA, ..."
                />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-md)' }}>
              <div className={styles.field}>
                <label className={styles.label}>Max Candidates</label>
                <input
                  className={styles.input}
                  type="number"
                  value={watchlistSettings.dynamic.maxCandidates}
                  onChange={e => handleDynamicConfigChange({ maxCandidates: parseInt(e.target.value) || 50 })}
                  min="1"
                  max="500"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Min Volume (shares)</label>
                <input
                  className={styles.input}
                  type="number"
                  value={watchlistSettings.dynamic.minVolume}
                  onChange={e => handleDynamicConfigChange({ minVolume: parseFloat(e.target.value) || 0 })}
                  min="0"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Price Range (Min)</label>
                <input
                  className={styles.input}
                  type="number"
                  value={watchlistSettings.dynamic.minPrice}
                  onChange={e => handleDynamicConfigChange({ minPrice: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step="0.01"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Price Range (Max)</label>
                <input
                  className={styles.input}
                  type="number"
                  value={watchlistSettings.dynamic.maxPrice}
                  onChange={e => handleDynamicConfigChange({ maxPrice: parseFloat(e.target.value) || 10000 })}
                  min="0"
                  step="0.01"
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Min Market Cap (optional)</label>
                <input
                  className={styles.input}
                  type="number"
                  value={watchlistSettings.dynamic.minMarketCap}
                  onChange={e => handleDynamicConfigChange({ minMarketCap: parseFloat(e.target.value) || 0 })}
                  min="0"
                />
              </div>
            </div>

            <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginTop: 'var(--spacing-md)', marginBottom: 0 }}>
              The screener will filter the universe using these quantitative criteria, then use AI analysis to identify the most promising candidates.
            </p>

            {canWrite && (
              <div style={{ marginTop: 'var(--spacing-md)', paddingTop: 'var(--spacing-md)', borderTop: '1px solid var(--color-border)' }}>
                <button
                  className={runningScreener ? styles.disabledBtn : styles.saveBtn}
                  onClick={async () => {
                    setRunningScreener(true);
                    try {
                      addToast('Running screener...', 'info');
                      const res = await api.strategicJobs.runScreener();
                      const { symbolsAdded, symbolsUpdated, totalInWatchlist } = res.summary;
                      addToast(
                        `Screener complete: ${symbolsAdded.length} added, ${symbolsUpdated.length} updated. Total: ${totalInWatchlist}`,
                        'success'
                      );
                      // Refresh watchlist
                      const watchlistRes = await api.watchlist.list();
                      setSymbols(watchlistRes.data);
                    } catch (err) {
                      addToast(err instanceof Error ? err.message : 'Screener failed', 'error');
                    } finally {
                      setRunningScreener(false);
                    }
                  }}
                  disabled={runningScreener}
                >
                  {runningScreener ? 'Running Screener...' : 'Run Screener'}
                </button>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem', marginTop: 'var(--spacing-sm)', marginBottom: 0 }}>
                  Runs the AI screener to pick symbols from the universe and add them to your watchlist with categories.
                </p>
              </div>
            )}
          </Card>
        </div>
      )}

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
