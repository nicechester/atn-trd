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
  const navigate = useNavigate();
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [metrics, setMetrics] = useState<BacktestMetrics | null>(null);
  const [equity, setEquity] = useState<BacktestEquityPoint[]>([]);
  const [trades, setTrades] = useState<BacktestTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [rerunning, setRerunning] = useState(false);
  const { addToast } = useToast();

  useEffect(() => {
    loadBacktest();
  }, [id]);

  // Poll while running
  useEffect(() => {
    if (run?.status !== 'running') return;
    const interval = setInterval(loadBacktest, 3000);
    return () => clearInterval(interval);
  }, [run?.status]);

  async function loadBacktest() {
    try {
      const result = await backtestApi.get(id);
      setRun(result.run);
      setMetrics(result.metrics);
      if (result.equityCurve) setEquity(result.equityCurve);
      if (result.trades) setTrades(result.trades);

      // Load equity curve separately if not included and backtest is done
      if (!result.equityCurve && result.run.status !== 'running') {
        const eqResult = await backtestApi.getEquity(id);
        setEquity(eqResult.equityCurve);
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to load backtest', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleRunAgain() {
    if (!run) return;
    setRerunning(true);
    try {
      const result = await backtestApi.create({
        name: run.name ? `${run.name} (rerun)` : undefined,
        startDate: run.startDate,
        endDate: run.endDate,
        symbols: run.symbols,
      });
      addToast('Backtest started', 'success');
      navigate(`/backtest/${result.backtestId}`);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to start backtest', 'error');
    } finally {
      setRerunning(false);
    }
  }

  if (loading) return <p>Loading…</p>;
  if (!run) return <p>Backtest not found</p>;

  return (
    <div>
      <div className={styles.detailHeader}>
        <Link to="/backtest" className={styles.backLink}>← Back to Backtests</Link>
        {run.status !== 'running' && (
          <div className={styles.detailActions}>
            <button onClick={handleRunAgain} disabled={rerunning} className={styles.runAgainBtn}>
              {rerunning ? 'Starting...' : '↻ Run Again'}
            </button>
            <button onClick={() => window.print()} className={styles.printBtn}>
              🖨 Print
            </button>
          </div>
        )}
      </div>
      <h1>{run.name || `Backtest ${run.id.slice(0, 8)}`}</h1>
      <p className={styles.dateRange}>{run.startDate} → {run.endDate}</p>

      {run.status === 'running' && (
        <div className={styles.runningBox}>
          <span className={styles.spinner} /> Running backtest... (backfilling prices, then simulating trades)
        </div>
      )}

      {run.status === 'failed' && run.error && (
        <div className={styles.errorBox}>{run.error}</div>
      )}

      {metrics && <MetricsPanel metrics={metrics} />}
      {run.settingsSnapshot && Object.keys(run.settingsSnapshot).length > 0 && (
        <SettingsPanel settings={run.settingsSnapshot} />
      )}
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

function SettingsPanel({ settings }: { settings: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  // Extract key settings for display
  const signals = settings.signals as Record<string, unknown> | undefined;
  const weights = signals?.weights as Record<string, number> | undefined;
  const risk = settings.risk as Record<string, unknown> | undefined;

  const buyThreshold = signals?.buyThreshold as number | undefined;
  const sellThreshold = signals?.sellThreshold as number | undefined;
  const maxPositions = risk?.maxConcurrentPositions as number | undefined;
  const maxPositionWeight = risk?.maxPositionWeightPercent as number | undefined;

  const hasKeySettings = weights || buyThreshold !== undefined;

  const content = hasKeySettings ? (
    <div className={styles.settingsGrid}>
      {weights && (
        <div className={styles.settingsGroup}>
          <h4>Signal Weights</h4>
          <ul>
            {Object.entries(weights)
              .filter(([, val]) => val > 0)
              .map(([key, val]) => (
                <li key={key}>{key}: {(val * 100).toFixed(0)}%</li>
              ))}
          </ul>
        </div>
      )}
      <div className={styles.settingsGroup}>
        <h4>Thresholds</h4>
        <ul>
          <li>Buy: {buyThreshold ?? '—'}</li>
          <li>Sell: {sellThreshold ?? '—'}</li>
        </ul>
      </div>
      {(maxPositions || maxPositionWeight) && (
        <div className={styles.settingsGroup}>
          <h4>Risk Limits</h4>
          <ul>
            {maxPositions && <li>Max positions: {maxPositions}</li>}
            {maxPositionWeight && <li>Max position weight: {maxPositionWeight}%</li>}
          </ul>
        </div>
      )}
    </div>
  ) : (
    <pre className={styles.settingsJson}>{JSON.stringify(settings, null, 2)}</pre>
  );

  return (
    <div className={styles.settingsSection}>
      <h3 onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }} className={styles.settingsToggle}>
        Strategy Settings {expanded ? '▼' : '▶'}
      </h3>
      {/* Screen: show based on expanded state */}
      {expanded && <div className={styles.settingsContent}>{content}</div>}
      {/* Print: always show */}
      <div className={styles.settingsContentPrint}>{content}</div>
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
    strategy: startValue > 0 ? (p.value - startValue) / startValue : 0,
    benchmark: p.benchmark && startBenchmark > 0 ? (p.benchmark - startBenchmark) / startBenchmark : 0,
  }));

  const allReturns = [...returns.map(r => r.strategy), ...returns.map(r => r.benchmark)];
  const minReturn = Math.min(...allReturns, 0);
  const maxReturn = Math.max(...allReturns, 0);
  const returnRange = maxReturn - minReturn || 0.01;

  const chartHeight = 280;
  const chartWidth = Math.max(600, Math.min(900, returns.length * 3));
  const paddingLeft = 60;
  const paddingRight = 20;
  const paddingTop = 30;
  const paddingBottom = 50;

  const xRange = returns.length > 1 ? returns.length - 1 : 1;
  const scaleX = (i: number) => paddingLeft + (i / xRange) * (chartWidth - paddingLeft - paddingRight);
  const scaleY = (v: number) => chartHeight - paddingBottom - ((v - minReturn) / returnRange) * (chartHeight - paddingTop - paddingBottom);

  const strategyPoints = returns.map((r, i) => `${scaleX(i).toFixed(2)},${scaleY(r.strategy).toFixed(2)}`);
  const benchmarkPoints = returns.map((r, i) => `${scaleX(i).toFixed(2)},${scaleY(r.benchmark).toFixed(2)}`);
  const strategyPath = `M${strategyPoints[0]} L${strategyPoints.slice(1).join(' L')}`;
  const benchmarkPath = `M${benchmarkPoints[0]} L${benchmarkPoints.slice(1).join(' L')}`;

  // Y-axis ticks (return %)
  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount }, (_, i) => minReturn + (returnRange * i) / (yTickCount - 1));

  // X-axis ticks (dates) - show ~5 evenly spaced dates
  const xTickCount = Math.min(5, returns.length);
  const xTickIndices = Array.from({ length: xTickCount }, (_, i) => Math.round((i / (xTickCount - 1)) * (returns.length - 1)));

  return (
    <div className={styles.chartSection}>
      <h3>Equity Curve</h3>
      <div className={styles.chartContainer}>
        <svg width={chartWidth} height={chartHeight} className={styles.chart}>
        {/* Y-axis line */}
        <line x1={paddingLeft} y1={paddingTop} x2={paddingLeft} y2={chartHeight - paddingBottom} className={styles.axisLine} />
        {/* X-axis line */}
        <line x1={paddingLeft} y1={chartHeight - paddingBottom} x2={chartWidth - paddingRight} y2={chartHeight - paddingBottom} className={styles.axisLine} />

        {/* Y-axis ticks and labels */}
        {yTicks.map((tick, i) => (
          <g key={`y-${i}`}>
            <line x1={paddingLeft - 5} y1={scaleY(tick)} x2={paddingLeft} y2={scaleY(tick)} className={styles.axisLine} />
            <text x={paddingLeft - 8} y={scaleY(tick) + 4} className={styles.axisLabel} textAnchor="end">
              {(tick * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* X-axis ticks and labels */}
        {xTickIndices.map((idx) => (
          <g key={`x-${idx}`}>
            <line x1={scaleX(idx)} y1={chartHeight - paddingBottom} x2={scaleX(idx)} y2={chartHeight - paddingBottom + 5} className={styles.axisLine} />
            <text x={scaleX(idx)} y={chartHeight - paddingBottom + 18} className={styles.axisLabel} textAnchor="middle">
              {returns[idx].date.slice(5)}
            </text>
          </g>
        ))}

        {/* Zero line */}
        {minReturn < 0 && maxReturn > 0 && (
          <line x1={paddingLeft} y1={scaleY(0)} x2={chartWidth - paddingRight} y2={scaleY(0)} className={styles.zeroLine} />
        )}

        {/* Benchmark */}
        <path d={benchmarkPath} className={styles.benchmarkLine} />

        {/* Strategy */}
        <path d={strategyPath} className={styles.strategyLine} />

      </svg>
      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={styles.legendLineStrategy} />
          <span>Strategy</span>
        </div>
        <div className={styles.legendItem}>
          <span className={styles.legendLineBenchmark} />
          <span>SPY (Benchmark)</span>
        </div>
      </div>
      </div>
    </div>
  );
}

function TradesTable({ trades }: { trades: BacktestTrade[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayTrades = showAll ? trades : trades.slice(0, 20);

  return (
    <div className={styles.tradesSection}>
      <h3>Trades ({trades.length})</h3>
      {/* Screen: paginated */}
      <table className={`${styles.table} ${styles.screenOnly}`}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Quantity</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {displayTrades.map((t, i) => (
            <tr key={i}>
              <td>{t.date}</td>
              <td>{t.symbol}</td>
              <td className={t.side === 'buy' ? styles.buy : styles.sell}>{t.side}</td>
              <td>{Number.isInteger(t.qty) ? t.qty : t.qty.toFixed(2)}</td>
              <td>${t.price.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Print: all trades */}
      <table className={`${styles.table} ${styles.printOnly}`}>
        <thead>
          <tr>
            <th>Date</th>
            <th>Symbol</th>
            <th>Side</th>
            <th>Quantity</th>
            <th>Price</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i}>
              <td>{t.date}</td>
              <td>{t.symbol}</td>
              <td className={t.side === 'buy' ? styles.buy : styles.sell}>{t.side}</td>
              <td>{Number.isInteger(t.qty) ? t.qty : t.qty.toFixed(2)}</td>
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

function SymbolAttribution({ perSymbol }: { perSymbol: Record<string, { return: number | null; trades: number }> }) {
  const symbols = Object.entries(perSymbol).sort((a, b) => {
    // Sort by return descending, nulls last
    if (a[1].return === null && b[1].return === null) return 0;
    if (a[1].return === null) return 1;
    if (b[1].return === null) return -1;
    return b[1].return - a[1].return;
  });

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
              <td className={data.return !== null && data.return >= 0 ? styles.positive : data.return !== null ? styles.negative : ''}>
                {data.return !== null ? `${(data.return * 100).toFixed(2)}%` : '—'}
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
  const [dateRange, setDateRange] = useState<{ minDate: string; maxDate: string } | null>(null);

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

    // Load available date range
    backtestApi.getDateRange().then(range => {
      setDateRange(range);
      // Set default dates to last 6 months of available data
      const end = new Date(range.maxDate);
      const start = new Date(range.maxDate);
      start.setMonth(start.getMonth() - 6);
      if (start < new Date(range.minDate)) {
        start.setTime(new Date(range.minDate).getTime());
      }
      setStartDate(start.toISOString().slice(0, 10));
      setEndDate(end.toISOString().slice(0, 10));
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
        <label>Start Date {dateRange && <span className={styles.muted}>(data available: {dateRange.minDate} to {dateRange.maxDate})</span>}</label>
        <input 
          type="date" 
          value={startDate} 
          onChange={e => setStartDate(e.target.value)} 
          min={dateRange?.minDate} 
          max={dateRange?.maxDate}
          required 
        />
      </div>
      <div className={styles.formRow}>
        <label>End Date</label>
        <input 
          type="date" 
          value={endDate} 
          onChange={e => setEndDate(e.target.value)} 
          min={dateRange?.minDate} 
          max={dateRange?.maxDate}
          required 
        />
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
