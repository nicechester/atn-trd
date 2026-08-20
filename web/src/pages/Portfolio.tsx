import { useEffect, useState } from 'react';
import { portfolio as portfolioApi, type Portfolio } from '../api/client';
import { centsToUSD, formatPnl } from '../lib/format';
import { useToast } from '../context/ToastContext';
import styles from './Portfolio.module.css';

export default function PortfolioPage() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => {
    portfolioApi.get()
      .then(res => setData(res.data))
      .catch(e => {
        const msg = e instanceof Error ? e.message : 'Failed to load portfolio';
        if (!msg.includes('not initialized')) {
          addToast(msg, 'error');
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading…</p>;

  if (!data) {
    return (
      <div>
        <h1>Portfolio</h1>
        <p className={styles.muted}>Portfolio not initialized. Run the agent to create a paper portfolio.</p>
      </div>
    );
  }

  return (
    <div>
      <h1>Portfolio</h1>
      <p className={styles.asOf}>As of {data.asOfDate}</p>

      <div className={styles.statsRow}>
        <div>
          <div className={styles.statLabel}>NAV</div>
          <div className={styles.statValue}>{centsToUSD(data.totalValueCents)}</div>
        </div>
        <div>
          <div className={styles.statLabel}>Cash</div>
          <div className={styles.statValue}>{centsToUSD(data.cashCents)}</div>
        </div>
        <div>
          <div className={styles.statLabel}>Positions Value</div>
          <div className={styles.statValue}>{centsToUSD(data.positionsValueCents)}</div>
        </div>
        <div>
          <div className={styles.statLabel}>Unrealized P&L</div>
          <div className={`${styles.statValue} ${data.totalUnrealizedPnlCents >= 0 ? styles.positive : styles.negative}`}>
            {formatPnl(data.totalUnrealizedPnlCents)}
          </div>
        </div>
        <div>
          <div className={styles.statLabel}>Total Return</div>
          <div className={`${styles.statValue} ${data.totalReturnPercent >= 0 ? styles.positive : styles.negative}`}>
            {data.totalReturnPercent >= 0 ? '+' : ''}{data.totalReturnPercent.toFixed(2)}%
          </div>
        </div>
      </div>

      {data.positions.length === 0
        ? <p className={styles.muted}>No open positions.</p>
        : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Symbol</th>
                <th className={`${styles.th} ${styles.tdNum}`}>Qty</th>
                <th className={`${styles.th} ${styles.tdNum}`}>Avg Cost</th>
                <th className={`${styles.th} ${styles.tdNum}`}>Current Price</th>
                <th className={`${styles.th} ${styles.tdNum}`}>Cost Basis</th>
                <th className={`${styles.th} ${styles.tdNum}`}>Market Value</th>
                <th className={`${styles.th} ${styles.tdNum}`}>Weight</th>
                <th className={`${styles.th} ${styles.tdNum}`}>Unrealized P&L</th>
                <th className={`${styles.th} ${styles.tdNum}`}>Realized P&L</th>
              </tr>
            </thead>
            <tbody>
              {data.positions.map(p => (
                <tr key={p.symbol}>
                  <td className={styles.td}><strong>{p.symbol}</strong></td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{p.qty}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{centsToUSD(p.avgCostCents)}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{centsToUSD(p.currentPriceCents)}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{centsToUSD(p.costBasisCents)}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{centsToUSD(p.marketValueCents)}</td>
                  <td className={`${styles.td} ${styles.tdNum}`}>{p.weightPercent.toFixed(1)}%</td>
                  <td className={`${styles.td} ${styles.tdNum} ${p.unrealizedPnlCents >= 0 ? styles.positive : styles.negative}`}>
                    {formatPnl(p.unrealizedPnlCents)}
                  </td>
                  <td className={`${styles.td} ${styles.tdNum} ${p.realizedPnlCents >= 0 ? styles.positive : styles.negative}`}>
                    {formatPnl(p.realizedPnlCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}
