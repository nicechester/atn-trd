import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { backtest as backtestApi, watchlist as watchlistApi, type BacktestRun, type BacktestMetrics, type BacktestEquityPoint, type BacktestTrade } from '../api/client';
import { useToast } from '../context/ToastContext';
import styles from './Backtest.module.css';

export default function BacktestPage() {
  const { id } = useParams<{ id?: string }>();

  if (id) {
    return <BacktestDetail id={id} />;
  }
  return <BacktestList />;
}

function BacktestList() {
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    loadRuns();
  }, []);

  async function loadRuns() {
    try {
      const result = await backtestApi.list();
      setRuns(result.runs);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to load backtests', 'error');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <div className={styles.header}>
        <h1>Backtests</h1>
        <button onClick={() => setShowForm(!showForm)} className={styles.newBtn}>
          {showForm ? 'Cancel' : '+ New Backtest'}
        </button>
      </div>
      <p className={styles.description}>
        Historical strategy validation. Run backtests to answer "Would this have worked in the past?"
      </p>

      {showForm && <NewBacktestForm onCreated={() => { setShowForm(false); loadRuns(); }} />}

      {runs.length === 0 && !showForm ? (
        <p className={styles.muted}>No backtests yet. Click "+ New Backtest" to run one.</p>
      ) : runs.length === 0 ? null : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Date Range</th>
              <th>Symbols</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>
                  <Link to={`/backtest/${run.id}`} className={styles.link}>
                    {run.name || run.id.slice(0, 8)}
                  </Link>
                </td>
                <td>{run.startDate} → {run.endDate}</td>
                <td>{run.symbols.length} symbols</td>
                <td>
                  <span className={`${styles.status} ${styles[run.status]}`}>
                    {run.status}
                  </span>
                </td>
                <td>{new Date(run.startedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function BacktestDetail({ id }: { id: string }) {
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [metrics, setMetrics] = useState<BacktestMetrics | null>(null);
  const [equity, setEquity] = useState<BacktestEquityPoint[]>([]);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    loadBacktest();
  }, [id]);

  async function loadBacktest() {
    try {
      const result = await backtestApi.get(id);
      setRun(result.run);
      setMetrics(result.metrics);
      if (result.equityCurve) setEquity(result.equityCurve);
      if (result.trades) setTrades(result.trades);

      // Load equity curve separately if not included
      if (!result.equityCurve) {
        const eqResult = await backtestApi.getEquity(id);
        setEquity(eqResult.equityCurve);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to load backtest', 'error');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (!run) return <p>Backtest not found</p>;

  return (
    <div>
      <Link to="/backtest" className={styles.backLink}>← Back to Backtests</Link>
      <h1>{run.name || `Backtest ${run.id.slice(0, 8)}`}</h1>
      <p className={styles.dateRange}>{run.startDate} → {run.endDate}</p>

      {run.status === 'failed' && run.error && (
        <div className={styles.errorBox}>{run.error}</div>
      )}

      {metrics && <MetricsPanel metrics={metrics} />}
      {equity.length > 0 && <EquityChart equity={equity} />}
      {trades.length > 0 && <TradesTable trades={trades} />}
      {metrics?.perSymbol && <SymbolAttribution perSymbol={metrics.perSymbol} />}
    </div>
  );
}

function MetricsPanel({ metrics }: { metrics: BacktestMetrics }) {
  const fmt = (v: number | null, suffix = '%') => v !== null ? `${(v * 100).toFixed(2)}${suffix}` : '—';
  const fmtNum = (v: number | null) => v !== null ? v.toFixed(2) : '—';

  return (
    <div className={styles.metricsGrid}>
      <div className={styles.metricCard}>
        <div className={styles.metricLabel}>Total Return</div>
        <div className={`${styles.metricValue} ${metrics.totalReturn >= 0 ? styles.positive : styles.negative}`}>
          {fmt(metrics.totalReturn)}
        </div>
      </div>
      <div className={styles.metricCard}>
        <div className={styles.metricLabel}>Benchmark (SPY)</div>
        <div className={`${styles.metricValue} ${metrics.benchmarkReturn >= 0 ? styles.positive : styles.negative}`}>
          {fmt(metrics.benchmarkReturn)}
        </div>
      </div>
      <div className={styles.metricCard}>
        <div className={styles.metricLabel}>Max Drawdown</div>
        <div className={`${styles.metricValue} ${styles.negative}`}>
          -{fmt(metrics.maxDrawdown)}
        </div>
      </div>
      <div className={styles.metricCard}>
        <div className={styles.metricLabel}>Sharpe Ratio</div>
        <div className={styles.metricValue}>{fmtNum(metrics.sharpeRatio)}</div>
      </div>
      <div className={styles.metricCard}>
        <div className={styles.metricLabel}>Sortino Ratio</div>
        <div className={styles.metricValue}>{fmtNum(metrics.sortinoRatio)}</div>
      </div>
      <div className={styles.metricCard}>
        <div className={styles.metricLabel}>Win Rate</div>
        <div className={styles.metricValue}>{fmt(metrics.winRate)}</div>
      </div>
      <div className={styles.metricCard}>
        <div className={styles.metricLabel}>Total Trades</div>
        <div className={styles.metricValue}>{metrics.totalTrades}</div>
      </div>
    </div>
  );
}

function EquityChart({ equity }: { equity: BacktestEquityPoint[] }) {
  if (equity.length < 2) return null;

  const startValue = equity[0].value;
  const startBenchmark = equity[0].benchmark ?? startValue;

  // Normalize to returns
  const returns = equity.map(p => ({
    date: p.date,
    strategy: (p.value - startValue) / startValue,
    benchmark: p.benchmark ? (p.benchmark - startBenchmark) / startBenchmark : 0,
  }));

  const allReturns = [...returns.map(r => r.strategy), ...returns.map(r => r.benchmark)];
  const minReturn = Math.min(...allReturns, 0);
  const maxReturn = Math.max(...allReturns, 0);
  const returnRange = maxReturn - minReturn || 0.01;

  const chartHeight = 250;
  const chartWidth = Math.max(600, Math.min(900, returns.length * 3));
  const padding = 50;

  const scaleX = (i: number) => padding + (i / (returns.length - 1)) * (chartWidth - 2 * padding);
  const scaleY = (v: number) => chartHeight - padding - ((v - minReturn) / returnRange) * (chartHeight - 2 * padding);

  const strategyPath = returns.map((r, i) => `${scaleX(i)},${scaleY(r.strategy)}`).join(' L ');
  const benchmarkPath = returns.map((r, i) => `${scaleX(i)},${scaleY(r.benchmark)}`).join(' L ');

  return (
    <div className={styles.chartSection}>
      <h3>Equity Curve</h3>
      <svg width={chartWidth} height={chartHeight} className={styles.chart}>
        {/* Zero line */}
        <line x1={padding} y1={scaleY(0)} x2={chartWidth - padding} y2={scaleY(0)} className={styles.zeroLine} />

        {/* Benchmark */}
        <polyline points={benchmarkPath} className={styles.benchmarkLine} />

        {/* Strategy */}
        <polyline points={strategyPath} className={styles.strategyLine} />

        {/* Legend */}
        <g transform={`translate(${chartWidth - 150}, ${padding})`}>
          <line x1={0} y1={0} x2={20} y2={0} className={styles.strategyLine} />
          <text x={25} y={4} className={styles.legendText}>Strategy</text>
          <line x1={0} y1={20} x2={20} y2={20} className={styles.benchmarkLine} />
          <text x={25} y={24} className={styles.legendText}>SPY</text>
        </g>
      </svg>
    </div>
  );
}

function TradesTable({ trades }: { trades: BacktestTrade[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayTrades = showAll ? trades : trades.slice(0, 20);

  return (
    <div className={styles.tradesSection}>
      <h3>Trades ({trades.length})</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Qty</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {displayTrades.map((t, i) => (
            <tr key={i}>
              <td>{t.date}</td>
              <td>{t.symbol}</td>
              <td className={t.side === 'buy' ? styles.buy : styles.sell}>{t.side}</td>
              <td>{t.qty.toFixed(2)}</td>
              <td>${t.price.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {trades.length > 20 && !showAll && (
        <button onClick={() => setShowAll(true)} className={styles.showMoreBtn}>
          Show all {trades.length} trades
        </button>
      )}
    </div>
  );
}

function SymbolAttribution({ perSymbol }: { perSymbol: Record<string, { return: number; trades: number }> }) {
  const symbols = Object.entries(perSymbol).sort((a, b) => b[1].return - a[1].return);

  return (
    <div className={styles.attributionSection}>
      <h3>Per-Symbol Attribution</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Return</th>
            <th>Trades</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map(([symbol, data]) => (
            <tr key={symbol}>
              <td>{symbol}</td>
              <td className={data.return >= 0 ? styles.positive : styles.negative}>
                {(data.return * 100).toFixed(2)}%
              </td>
              <td>{data.trades}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface WatchlistItem { symbol: string; enabled: boolean }

function NewBacktestForm({ onCreated }: { onCreated: () => void }) {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [symbolsInput, setSymbolsInput] = useState('');
  const [useWatchlist, setUseWatchlist] = useState(true);
  const [startingCash, setStartingCash] = useState('100000');

  useEffect(() => {
    watchlistApi.list().then(res => {
      setWatchlist(res.data.filter(w => w.enabled));
    }).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate) {
      addToast('Start and end dates are required', 'error');
      return;
    }

    const symbols = useWatchlist
      ? watchlist.map(w => w.symbol)
      : symbolsInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

    if (symbols.length === 0) {
      addToast('At least one symbol is required', 'error');
      return;
    }

    setLoading(true);
    try {
      const result = await backtestApi.create({
        name: name || undefined,
        startDate,
        endDate,
        symbols,
        startingCashCents: Math.round(parseFloat(startingCash) * 100),
      });
      addToast('Backtest started', 'success');
      onCreated();
      if (result.backtestId) {
        navigate(`/backtest/${result.backtestId}`);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to start backtest', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.form}>
      <div className={styles.formRow}>
        <label>Name (optional)</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="My Backtest" />
      </div>
      <div className={styles.formRow}>
        <label>Start Date</label>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} required />
      </div>
      <div className={styles.formRow}>
        <label>End Date</label>
        <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} required />
      </div>
      <div className={styles.formRow}>
        <label>Starting Cash ($)</label>
        <input type="number" value={startingCash} onChange={e => setStartingCash(e.target.value)} min="1000" step="1000" />
      </div>
      <div className={styles.formRow}>
        <label>
          <input type="checkbox" checked={useWatchlist} onChange={e => setUseWatchlist(e.target.checked)} />
          {' '}Use watchlist ({watchlist.length} symbols)
        </label>
      </div>
      {!useWatchlist && (
        <div className={styles.formRow}>
          <label>Symbols (comma-separated)</label>
          <input type="text" value={symbolsInput} onChange={e => setSymbolsInput(e.target.value)} placeholder="AAPL, MSFT, GOOGL" />
        </div>
      )}
      <button type="submit" disabled={loading} className={styles.submitBtn}>
        {loading ? 'Running...' : 'Run Backtest'}
      </button>
    </form>
  );
}
