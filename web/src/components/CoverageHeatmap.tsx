import type { RunCoverageData } from '../api/client';
import styles from '../pages/RunDetail.module.css';

interface CoverageHeatmapProps {
  coverage: RunCoverageData;
}

/**
 * Heatmap component to visualize data source coverage per symbol.
 * Shows a grid of symbols × sources with color-coded status cells.
 */
export default function CoverageHeatmap({ coverage }: CoverageHeatmapProps) {
  const { matrix, sources, sourceSummary, overallCoveragePercent, belowThreshold, thresholdPercent } = coverage;

  // Helper to get cell color based on status
  function getCellClass(status: string): string {
    if (status === 'ok') return styles.heatOk;
    if (status === 'error') return styles.heatError;
    return styles.heatMissing;
  }

  // Helper to get tooltip text
  function getTooltip(cell: any): string {
    const parts = [cell.source, `Status: ${cell.status}`];
    if (cell.provider) parts.push(`Provider: ${cell.provider}`);
    if (cell.error) parts.push(`Error: ${cell.error}`);
    if (cell.fetchedAt) {
      const date = new Date(cell.fetchedAt);
      parts.push(`Fetched: ${date.toLocaleString()}`);
    }
    return parts.join('\n');
  }

  return (
    <div style={{ marginBottom: 'var(--spacing-lg)' }}>
      <div style={{ marginBottom: 'var(--spacing-md)' }}>
        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 'var(--spacing-sm)' }}>
          Data Source Coverage
        </h3>
        <div style={{ display: 'flex', gap: 'var(--spacing-md)', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <span className={styles.badgeBlue}>{Math.round(overallCoveragePercent)}% Coverage</span>
          </div>
          {belowThreshold && (
            <span className={styles.badgeRed}>Below {thresholdPercent}% threshold</span>
          )}
        </div>
      </div>

      {/* Heatmap table */}
      <div style={{ overflowX: 'auto' }}>
        <table className={styles.heatTable}>
          <thead>
            <tr>
              <th className={styles.th} style={{ minWidth: '80px' }}>Symbol</th>
              <th className={styles.th} style={{ width: '100px' }}>Coverage</th>
              {sources.map(source => (
                <th key={source} className={styles.th} style={{ textAlign: 'center', minWidth: '70px' }}>
                  {source}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map(row => (
              <tr key={row.symbol}>
                <td className={styles.td} style={{ fontWeight: 600 }}>{row.symbol}</td>
                <td className={styles.td} style={{ textAlign: 'center' }}>
                  <span className={row.coveragePercent >= 80 ? styles.badgeGreen : styles.badgeRed}>
                    {Math.round(row.coveragePercent)}%
                  </span>
                </td>
                {row.cells.map((cell, idx) => (
                  <td
                    key={idx}
                    className={`${styles.td} ${styles.heatCell} ${getCellClass(cell.status)}`}
                    title={getTooltip(cell)}
                    style={{ textAlign: 'center', padding: '6px' }}
                  >
                    {cell.status === 'ok' ? '✓' : cell.status === 'error' ? '✕' : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Source summary */}
      <div style={{ marginTop: 'var(--spacing-md)' }}>
        <h4 style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', marginBottom: 'var(--spacing-sm)' }}>
          Source Summary
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--spacing-sm)' }}>
          {sourceSummary.map(summary => (
            <div
              key={summary.source}
              style={{
                padding: 'var(--spacing-sm)',
                backgroundColor: 'var(--color-bg)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm, 4px)',
                fontSize: '0.75rem',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>{summary.source}</div>
              <div style={{ display: 'flex', gap: '4px', fontSize: '0.7rem', marginBottom: '4px' }}>
                <span title="Successful fetches">✓ {summary.okCount}</span>
                <span title="Failed fetches" style={{ color: 'var(--color-error)' }}>✕ {summary.errorCount}</span>
                <span title="Missing data">— {summary.missingCount}</span>
              </div>
              <div style={{ color: 'var(--color-text-muted)' }}>
                {Math.round(summary.coveragePercent)}% coverage
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
