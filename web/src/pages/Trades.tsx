import { useEffect, useState } from 'react';
import { trades as tradesApi, type FillWithOrder } from '../api/client';
import { centsToUSD, formatTimestamp } from '../lib/format';
import { useToast } from '../context/ToastContext';
import styles from './Trades.module.css';

export default function TradesPage() {
  const [tradeList, setTradeList] = useState<FillWithOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [symbolFilter, setSymbolFilter] = useState('');
  const { addToast } = useToast();

  useEffect(() => {
    tradesApi.list(200, 0)
      .then(res => setTradeList(res.data))
      .catch(e => addToast(e instanceof Error ? e.message : 'Failed to load trades', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = symbolFilter
    ? tradeList.filter(t => t.symbol.toLowerCase().includes(symbolFilter.toLowerCase()))
    : tradeList;

  if (loading) return <p>Loading…</p>;

  return (
    <div>
      <h1>Trades</h1>
      <div className={styles.filterBar}>
        <input
          className={styles.filterInput}
          type="text"
          placeholder="Filter by symbol…"
          value={symbolFilter}
          onChange={e => setSymbolFilter(e.target.value)}
        />
      </div>
      {filtered.length === 0
        ? <p className={styles.muted}>No trades found.</p>
        : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Date</th>
                <th className={styles.th}>Filled At</th>
                <th className={styles.th}>Symbol</th>
                <th className={styles.th}>Side</th>
                <th className={styles.th}>Mode</th>
                <th className={styles.th}>Qty</th>
                <th className={styles.th}>Price</th>
                <th className={styles.th}>Fee</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id}>
                  <td className={styles.td}>{t.barDate}</td>
                  <td className={styles.td}>{formatTimestamp(t.filledAt)}</td>
                  <td className={styles.td}><strong>{t.symbol}</strong></td>
                  <td className={styles.td}>
                    <span className={t.side === 'buy' ? styles.badgeGreen : styles.badgeRed}>{t.side}</span>
                  </td>
                  <td className={styles.td}>{t.mode}</td>
                  <td className={styles.td}>{t.qty}</td>
                  <td className={styles.td}>{centsToUSD(t.priceCents)}</td>
                  <td className={styles.td}>{centsToUSD(t.feeCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    </div>
  );
}
