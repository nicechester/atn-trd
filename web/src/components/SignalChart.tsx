import { useEffect, useState } from 'react';
import { api, SignalSnapshot } from '../api/client';
import styles from './SignalChart.module.css';

interface SignalChartProps {
  symbol: string;
  buyThreshold?: number;
  pauseThreshold?: number;
}

export function SignalChart({ symbol, buyThreshold = 0.70, pauseThreshold = 0.60 }: SignalChartProps): JSX.Element {
  const [data, setData] = useState<SignalSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.signals.history(symbol, 14);
        setData(res.data.reverse()); // oldest first for chart
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load signals');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [symbol]);

  if (loading) return <div className={styles.loading}>Loading signals...</div>;
  if (error) return <div className={styles.error}>{error}</div>;
  if (data.length === 0) return <div className={styles.empty}>No signal data</div>;

  const latest = data[data.length - 1];
  const oldest = data[0];
  const trend = latest.compositeEwma && oldest.compositeEwma
    ? latest.compositeEwma > oldest.compositeEwma ? '↗' : latest.compositeEwma < oldest.compositeEwma ? '↘' : '→'
    : '—';
  const trendLabel = trend === '↗' ? 'improving' : trend === '↘' ? 'declining' : 'stable';

  // Chart dimensions
  const chartHeight = 150;
  const chartWidth = 400;
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  const xScale = (i: number) => padding.left + (i / (data.length - 1 || 1)) * innerWidth;
  const yScale = (v: number) => padding.top + innerHeight - ((v + 1) / 2) * innerHeight; // -1 to 1 range

  // Build path for composite score
  const scorePath = data
    .map((d, i) => d.compositeScore !== null ? `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.compositeScore)}` : '')
    .filter(Boolean)
    .join(' ');

  // Build path for EWMA
  const ewmaPath = data
    .map((d, i) => d.compositeEwma !== null ? `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.compositeEwma)}` : '')
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.title}>{symbol} - Signal Trend (14 days)</span>
      </div>

      <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className={styles.chart}>
        {/* Threshold lines */}
        <line x1={padding.left} y1={yScale(buyThreshold)} x2={chartWidth - padding.right} y2={yScale(buyThreshold)}
          stroke="var(--color-success)" strokeDasharray="4 2" strokeWidth="1" opacity="0.5" />
        <text x={chartWidth - padding.right + 2} y={yScale(buyThreshold)} 
          fill="var(--color-success)" fontSize="8" dominantBaseline="middle">buy</text>

        <line x1={padding.left} y1={yScale(pauseThreshold)} x2={chartWidth - padding.right} y2={yScale(pauseThreshold)}
          stroke="var(--color-warning)" strokeDasharray="4 2" strokeWidth="1" opacity="0.5" />
        <text x={chartWidth - padding.right + 2} y={yScale(pauseThreshold)} 
          fill="var(--color-warning)" fontSize="8" dominantBaseline="middle">pause</text>

        {/* Zero line */}
        <line x1={padding.left} y1={yScale(0)} x2={chartWidth - padding.right} y2={yScale(0)}
          stroke="var(--color-border)" strokeWidth="1" />

        {/* Raw score line */}
        {scorePath && <path d={scorePath} fill="none" stroke="var(--color-text-muted)" strokeWidth="1" opacity="0.5" />}

        {/* EWMA line */}
        {ewmaPath && <path d={ewmaPath} fill="none" stroke="var(--color-primary)" strokeWidth="2" />}

        {/* Latest point */}
        {latest.compositeEwma !== null && (
          <circle cx={xScale(data.length - 1)} cy={yScale(latest.compositeEwma)} r="4" fill="var(--color-primary)" />
        )}

        {/* Y axis labels */}
        {[1, 0.5, 0, -0.5, -1].map(v => (
          <text key={v} x={padding.left - 5} y={yScale(v)} 
            fill="var(--color-text-muted)" fontSize="9" textAnchor="end" dominantBaseline="middle">
            {v.toFixed(1)}
          </text>
        ))}

        {/* X axis labels */}
        {data.length > 0 && (
          <>
            <text x={xScale(0)} y={chartHeight - 5} 
              fill="var(--color-text-muted)" fontSize="9" textAnchor="start">
              {new Date(oldest.snapshotDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
            <text x={xScale(data.length - 1)} y={chartHeight - 5} 
              fill="var(--color-text-muted)" fontSize="9" textAnchor="end">
              {new Date(latest.snapshotDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </text>
          </>
        )}
      </svg>

      <div className={styles.stats}>
        <span>Raw: {latest.compositeScore?.toFixed(2) ?? '—'}</span>
        <span>EWMA: <strong>{latest.compositeEwma?.toFixed(2) ?? '—'}</strong> {latest.compositeEwma !== null && latest.compositeEwma >= buyThreshold ? '✓' : ''}</span>
        <span>Trend: {trend} {trendLabel}</span>
      </div>
    </div>
  );
}
