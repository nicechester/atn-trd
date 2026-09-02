import { useEffect, useState } from 'react';
import { api, EnhancedWatchlistRow, SymbolCategory } from '../api/client';
import { useToast } from '../context/ToastContext';
import styles from './Watchlist.module.css';

const CATEGORY_ICONS: Record<SymbolCategory, string> = {
  GROWTH_CORE: '🚀',
  DIVIDEND_GROWTH: '💰',
  INCOME_BOOSTER: '💵',
  HEDGE: '🛡️',
};

const CATEGORY_LABELS: Record<SymbolCategory, string> = {
  GROWTH_CORE: 'Growth',
  DIVIDEND_GROWTH: 'Div Growth',
  INCOME_BOOSTER: 'Income',
  HEDGE: 'Hedge',
};

function CategoryBadge({ category }: { category: SymbolCategory | null }) {
  if (!category) return <span className={styles.muted}>—</span>;
  return (
    <span className={`${styles.categoryBadge} ${styles[category.toLowerCase()]}`}>
      {CATEGORY_ICONS[category]} {CATEGORY_LABELS[category]}
    </span>
  );
}

function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value.toFixed(1)}%`;
}

function formatDate(ts: number | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString();
}

export default function WatchlistPage(): JSX.Element {
  const { addToast } = useToast();
  const [data, setData] = useState<EnhancedWatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastScreened, setLastScreened] = useState<number | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await api.watchlist.listEnhanced();
        setData(res.data);
        const maxScreened = res.data.reduce((max, r) => 
          r.lastScreenedAt && r.lastScreenedAt > (max ?? 0) ? r.lastScreenedAt : max, null as number | null);
        setLastScreened(maxScreened);
      } catch (e) {
        addToast(e instanceof Error ? e.message : 'Failed to load watchlist', 'error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [addToast]);

  if (loading) return <div><p>Loading...</p></div>;

  return (
    <div>
      <div className={styles.header}>
        <h1>Watchlist</h1>
        {lastScreened && (
          <span className={styles.lastScreened}>Last screener: {formatDate(lastScreened)}</span>
        )}
      </div>

      <div className={styles.legend}>
        <span>🚀 GROWTH_CORE</span>
        <span>💰 DIVIDEND_GROWTH</span>
        <span>💵 INCOME_BOOSTER</span>
        <span>🛡️ HEDGE</span>
      </div>

      <table className={styles.table}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Category</th>
            <th>Yield</th>
            <th>Div Growth</th>
            <th>Est. CAGR</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr><td colSpan={6} className={styles.empty}>No symbols in watchlist</td></tr>
          ) : (
            data.map(row => (
              <tr key={row.symbol} className={!row.enabled ? styles.disabled : ''}>
                <td className={styles.symbol}>{row.symbol}</td>
                <td><CategoryBadge category={row.category} /></td>
                <td>{formatPercent(row.yieldPercent)}</td>
                <td>{formatPercent(row.dividendGrowthPercent)}</td>
                <td>{formatPercent(row.estCagrPercent)}</td>
                <td>
                  <span className={row.planStatus.startsWith('Plan') ? styles.planActive : styles.watching}>
                    {row.planStatus}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
