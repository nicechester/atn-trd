import { useEffect, useState } from 'react';
import { performance as performanceApi, type PerformanceMetrics } from '../api/client';
import { useToast } from '../context/ToastContext';
import styles from './Performance.module.css';

export default function PerformancePage() {
  const [data, setData] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const { addToast } = useToast();

  useEffect(() => {
    loadPerformance();
  }, []);

  async function loadPerformance() {
    setLoading(true);
    try {
      const result = await performanceApi.get(dateRange.from || undefined, dateRange.to || undefined);
      setData(result.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load performance data';
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleApplyDateRange() {
    loadPerformance();
  }

  if (loading) return <p>Loading…</p>;

  if (!data || data.series.length === 0) {
    return (
      <div>
        <h1>Performance</h1>
        <p className={styles.muted}>No performance data available. Run the agent to generate portfolio snapshots.</p>
      </div>
    );
  }

  // Find min/max returns for scaling the chart
  const allReturns = [
    ...data.series.map(p => p.strategyReturn),
    ...data.series.map(p => p.benchmarkReturn),
  ];
  const minReturn = Math.min(...allReturns, 0);
  const maxReturn = Math.max(...allReturns, 0);
  const returnRange = maxReturn - minReturn;
  const chartHeight = 300;
  const chartWidth = 1000;

  // Scale functions - now using full viewBox since labels are outside
  const scaleX = (index: number) => (index / Math.max(data.series.length - 1, 1)) * chartWidth;
  const scaleY = (value: number) => chartHeight - ((value - minReturn) / (returnRange || 1)) * chartHeight;

  // Generate SVG path for line chart
  const strategyPath = data.series
    .map((point, i) => `${scaleX(i)},${scaleY(point.strategyReturn)}`)
    .join(' ');
  const benchmarkPath = data.series
    .map((point, i) => `${scaleX(i)},${scaleY(point.benchmarkReturn)}`)
    .join(' ');

  const strategyReturn = (data.totalStrategyReturn * 100).toFixed(2);
  const benchmarkReturn = (data.totalBenchmarkReturn * 100).toFixed(2);
  const strategyDD = (data.strategyMaxDrawdown * 100).toFixed(2);
  const benchmarkDD = (data.benchmarkMaxDrawdown * 100).toFixed(2);

  return (
    <div>
      <h1>Performance vs SPY</h1>

      <div className={styles.controls}>
        <div className={styles.dateInputGroup}>
          <label>
            From:
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange({ ...dateRange, from: e.target.value })}
            />
          </label>
          <label>
            To:
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange({ ...dateRange, to: e.target.value })}
            />
          </label>
          <button onClick={handleApplyDateRange} className={styles.applyBtn}>
            Apply
          </button>
        </div>
      </div>

      <div className={styles.metricsRow}>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Strategy Return</div>
          <div className={`${styles.metricValue} ${data.totalStrategyReturn >= 0 ? styles.positive : styles.negative}`}>
            {strategyReturn}%
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>SPY Return</div>
          <div className={`${styles.metricValue} ${data.totalBenchmarkReturn >= 0 ? styles.positive : styles.negative}`}>
            {benchmarkReturn}%
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>Strategy Max Drawdown</div>
          <div className={`${styles.metricValue} ${styles.negative}`}>
            -{strategyDD}%
          </div>
        </div>
        <div className={styles.metricCard}>
          <div className={styles.metricLabel}>SPY Max Drawdown</div>
          <div className={`${styles.metricValue} ${styles.negative}`}>
            -{benchmarkDD}%
          </div>
        </div>
        {data.sharpeRatio !== undefined && (
          <div className={styles.metricCard}>
            <div className={styles.metricLabel}>Sharpe Ratio</div>
            <div className={styles.metricValue}>
              {data.sharpeRatio.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      <div className={styles.chartContainer}>
        <div className={styles.chartWrapper}>
          <div className={styles.yAxis}>
            {[1, 0.75, 0.5, 0.25, 0].map((tick) => {
              const value = minReturn + tick * returnRange;
              return <span key={tick}>{(value * 100).toFixed(0)}%</span>;
            })}
          </div>
          <div className={styles.chartArea}>
            <svg
              className={styles.chart}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
            >
              {/* Grid lines */}
              {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
                const y = chartHeight - tick * chartHeight;
                return (
                  <line key={`grid-${tick}`} x1={0} y1={y} x2={chartWidth} y2={y} className={styles.gridLine} />
                );
              })}

              {/* Benchmark line (SPY) */}
              <polyline points={benchmarkPath} className={styles.benchmarkLine} />

              {/* Strategy line */}
              <polyline points={strategyPath} className={styles.strategyLine} />
            </svg>
            <div className={styles.xAxis}>
              {data.series.filter((_, i) => i === 0 || i === data.series.length - 1 || i % Math.ceil(data.series.length / 5) === 0).map((point) => (
                <span key={point.date}>{point.date.slice(5)}</span>
              ))}
            </div>
          </div>
          <div className={styles.legendBox}>
            <div className={styles.legendItem}><span className={styles.legendLineStrategy} /> Strategy</div>
            <div className={styles.legendItem}><span className={styles.legendLineBenchmark} /> SPY</div>
          </div>
        </div>
      </div>

      <p className={styles.note}>
        {data.series.length} trading days of data | Last update: {data.series[data.series.length - 1].date}
      </p>
    </div>
  );
}
