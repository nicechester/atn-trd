import { useEffect, useState } from 'react';
import { trades as tradesApi, type FillWithOrder, type OrderRow } from '../api/client';
import { centsToUSD, formatTimestamp, formatQty } from '../lib/format';
import { useToast } from '../context/ToastContext';
import styles from './Trades.module.css';

export default function TradesPage() {
  const [tradeList, setTradeList] = useState<FillWithOrder[]>([]);
  const [pendingOrders, setPendingOrders] = useState<OrderRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [symbolFilter, setSymbolFilter] = useState('');
  const { addToast } = useToast();

  const loadData = () => {
    Promise.all([
      tradesApi.list(200, 0),
      tradesApi.pending(),
    ])
      .then(([tradesRes, pendingRes]) => {
        setTradeList(tradesRes.data);
        setPendingOrders(pendingRes.data);
        setSelected(prev => {
          const validIds = new Set(pendingRes.data.map(o => o.id));
          return new Set([...prev].filter(id => validIds.has(id)));
        });
      })
      .catch(e => addToast(e instanceof Error ? e.message : 'Failed to load trades', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const filtered = symbolFilter
    ? tradeList.filter(t => t.symbol.toLowerCase().includes(symbolFilter.toLowerCase()))
    : tradeList;

  const filteredPending = symbolFilter
    ? pendingOrders.filter(o => o.symbol.toLowerCase().includes(symbolFilter.toLowerCase()))
    : pendingOrders;

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const allIds = filteredPending.map(o => o.id);
    const allSelected = allIds.every(id => selected.has(id));
    if (allSelected) {
      setSelected(prev => {
        const next = new Set(prev);
        allIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelected(prev => new Set([...prev, ...allIds]));
    }
  };

  const cancelSelected = async () => {
    if (selected.size === 0) return;
    try {
      await tradesApi.cancelBulk([...selected]);
      addToast(`Canceled ${selected.size} order(s)`, 'success');
      setSelected(new Set());
      loadData();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to cancel', 'error');
    }
  };

  const cancelOne = async (id: string) => {
    try {
      await tradesApi.cancel(id);
      addToast('Order canceled', 'success');
      loadData();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to cancel', 'error');
    }
  };

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

      {filteredPending.length > 0 && (
        <>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Pending Orders ({filteredPending.length})</h2>
            {selected.size > 0 && (
              <button className={styles.cancelBtn} onClick={cancelSelected}>
                Cancel Selected ({selected.size})
              </button>
            )}
          </div>
          <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>
                  <input
                    type="checkbox"
                    checked={filteredPending.length > 0 && filteredPending.every(o => selected.has(o.id))}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className={styles.th}>Submitted</th>
                <th className={styles.th}>Symbol</th>
                <th className={styles.th}>Side</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Qty</th>
                <th className={styles.th}>Type</th>
                <th className={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {filteredPending.map(o => (
                <tr key={o.id}>
                  <td className={styles.td}>
                    <input
                      type="checkbox"
                      checked={selected.has(o.id)}
                      onChange={() => toggleSelect(o.id)}
                    />
                  </td>
                  <td className={styles.td}>{formatTimestamp(o.submittedAt)}</td>
                  <td className={styles.td}><strong>{o.symbol}</strong></td>
                  <td className={styles.td}>
                    <span className={o.side === 'buy' ? styles.badgeGreen : styles.badgeRed}>{o.side}</span>
                  </td>
                  <td className={styles.td}>
                    <span className={styles.badgeYellow}>{o.status}</span>
                  </td>
                  <td className={styles.td}>{formatQty(o.qty)}</td>
                  <td className={styles.td}>{o.type}{o.limitPriceCents ? ` @ ${centsToUSD(o.limitPriceCents)}` : ''}</td>
                  <td className={styles.td}>
                    <button className={styles.cancelBtnSmall} onClick={() => cancelOne(o.id)}>Cancel</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}

      <h2 className={styles.sectionTitle}>Filled Trades ({filtered.length})</h2>
      {filtered.length === 0
        ? <p className={styles.muted}>No trades found.</p>
        : (
          <div className={styles.tableWrapper}>
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
                  <td className={styles.td}>{formatQty(t.qty)}</td>
                  <td className={styles.td}>{centsToUSD(t.priceCents)}</td>
                  <td className={styles.td}>{centsToUSD(t.feeCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )
      }
    </div>
  );
}
