import { useEffect, useState } from 'react';
import { portfolio as portfolioApi, type Portfolio } from '../api/client';
import { centsToUSD, formatPnl, formatQty } from '../lib/format';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import styles from './Portfolio.module.css';

export default function PortfolioPage() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [seedAmount, setSeedAmount] = useState('10000');
  const [initializing, setInitializing] = useState(false);
  const [marketOpen, setMarketOpen] = useState<boolean | null>(null);
  const { addToast } = useToast();
  const { canWrite } = useAuth();

  // Quick Trade state
  const [tradeSymbol, setTradeSymbol] = useState('');
  const [tradeSide, setTradeSide] = useState<'buy' | 'sell'>('buy');
  const [tradeQty, setTradeQty] = useState('');
  const [tradeType, setTradeType] = useState<'market' | 'limit'>('market');
  const [tradePrice, setTradePrice] = useState('');
  const [submittingTrade, setSubmittingTrade] = useState(false);

  // Reset state
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetConfirmed, setResetConfirmed] = useState(false);
  const [preserveHistory, setPreserveHistory] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    loadPortfolio();
    loadMarketStatus();
  }, []);

  function loadMarketStatus() {
    portfolioApi.marketStatus()
      .then(res => setMarketOpen(res.isOpen))
      .catch(() => setMarketOpen(false));
  }

  function loadPortfolio() {
    portfolioApi.get()
      .then(res => setData(res.data))
      .catch(e => {
        const msg = e instanceof Error ? e.message : 'Failed to load portfolio';
        if (!msg.includes('not initialized')) {
          addToast(msg, 'error');
        }
      })
      .finally(() => setLoading(false));
  }

  async function handleTransfer(type: 'deposit' | 'withdraw') {
    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      addToast('Enter a valid amount', 'error');
      return;
    }
    setTransferring(true);
    try {
      await portfolioApi.transfer(Math.round(amount * 100), type);
      addToast(`${type === 'deposit' ? 'Deposited' : 'Withdrew'} ${centsToUSD(Math.round(amount * 100))}`, 'success');
      setTransferAmount('');
      loadPortfolio();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Transfer failed', 'error');
    } finally {
      setTransferring(false);
    }
  }

  async function handleInit() {
    const amount = parseFloat(seedAmount);
    if (isNaN(amount) || amount <= 0) {
      addToast('Enter a valid amount', 'error');
      return;
    }
    setInitializing(true);
    try {
      await portfolioApi.init(Math.round(amount * 100));
      addToast(`Portfolio initialized with ${centsToUSD(Math.round(amount * 100))}`, 'success');
      loadPortfolio();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Init failed', 'error');
    } finally {
      setInitializing(false);
    }
  }

  async function handleQuickTrade() {
    const symbol = tradeSymbol.trim().toUpperCase();
    const qty = parseFloat(tradeQty);
    if (!symbol) {
      addToast('Enter a symbol', 'error');
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      addToast('Enter a valid quantity', 'error');
      return;
    }
    if (tradeType === 'limit' && (!tradePrice || parseFloat(tradePrice) <= 0)) {
      addToast('Enter a valid limit price', 'error');
      return;
    }

    setSubmittingTrade(true);
    try {
      const limitPriceCents = tradeType === 'limit' ? Math.round(parseFloat(tradePrice) * 100) : undefined;
      const result = await portfolioApi.order(symbol, tradeSide, qty, tradeType, limitPriceCents);
      
      if (result.data.status === 'rejected') {
        addToast(`Order rejected: ${result.data.rejectReason || 'Unknown reason'}`, 'error');
      } else {
        addToast(`${tradeSide.toUpperCase()} order for ${qty} ${symbol} ${result.data.status}`, 'success');
        setTradeSymbol('');
        setTradeQty('');
        setTradePrice('');
        loadPortfolio();
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Order failed', 'error');
    } finally {
      setSubmittingTrade(false);
    }
  }

  async function handleReset() {
    if (!resetConfirmed) return;
    
    setResetting(true);
    try {
      const result = await portfolioApi.reset(preserveHistory);
      addToast(`Portfolio reset. ${result.data.positionsCleared} positions cleared.`, 'success');
      setShowResetDialog(false);
      setResetConfirmed(false);
      setPreserveHistory(false);
      loadPortfolio();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Reset failed', 'error');
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <p>Loading…</p>;

  if (!data) {
    return (
      <div>
        <h1>Portfolio</h1>
        <p className={styles.muted}>Portfolio not initialized.</p>
        {canWrite && (
          <div className={styles.initSection}>
            <div className={styles.transferRow}>
              <span className={styles.dollarSign}>$</span>
              <input
                type="number"
                className={styles.transferInput}
                placeholder="10000"
                value={seedAmount}
                onChange={e => setSeedAmount(e.target.value)}
                min="0"
                step="1000"
              />
              <button
                className={styles.depositBtn}
                onClick={handleInit}
                disabled={initializing || !seedAmount}
              >
                {initializing ? 'Initializing...' : 'Initialize Portfolio'}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className={styles.headerRow}>
        <h1>Portfolio</h1>
        {canWrite && (
          <button className={styles.resetBtn} onClick={() => setShowResetDialog(true)}>
            Reset Portfolio
          </button>
        )}
      </div>
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

      {/* Quick Trade Section */}
      {canWrite && (
        <div className={styles.tradeSection}>
          <div className={styles.transferLabel}>
            Quick Trade
            {marketOpen === false && (
              <span className={styles.marketClosed}> — Market Closed</span>
            )}
            {marketOpen === true && (
              <span className={styles.marketOpen}> — Market Open</span>
            )}
          </div>
          {marketOpen === false && (
            <p className={styles.marketClosedNote}>
              Trading is only available during market hours (9:30 AM - 4:00 PM ET, Mon-Fri).
            </p>
          )}
          <div className={styles.tradeForm}>
            <div className={styles.tradeRow}>
              <input
                type="text"
                className={styles.symbolInput}
                placeholder="Symbol"
                value={tradeSymbol}
                onChange={e => setTradeSymbol(e.target.value.toUpperCase())}
                maxLength={10}
                disabled={!marketOpen}
              />
              <select
                className={styles.sideSelect}
                value={tradeSide}
                onChange={e => setTradeSide(e.target.value as 'buy' | 'sell')}
                disabled={!marketOpen}
              >
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </select>
              <input
                type="number"
                className={styles.qtyInput}
                placeholder="Qty"
                value={tradeQty}
                onChange={e => setTradeQty(e.target.value)}
                min="0"
                step="1"
                disabled={!marketOpen}
              />
              <select
                className={styles.typeSelect}
                value={tradeType}
                onChange={e => setTradeType(e.target.value as 'market' | 'limit')}
                disabled={!marketOpen}
              >
                <option value="market">Market</option>
                <option value="limit">Limit</option>
              </select>
              {tradeType === 'limit' && (
                <>
                  <span className={styles.dollarSign}>$</span>
                  <input
                    type="number"
                    className={styles.priceInput}
                    placeholder="Price"
                    value={tradePrice}
                    onChange={e => setTradePrice(e.target.value)}
                    min="0"
                    step="0.01"
                    disabled={!marketOpen}
                  />
                </>
              )}
              <button
                className={tradeSide === 'buy' ? styles.buyBtn : styles.sellBtn}
                onClick={handleQuickTrade}
                disabled={submittingTrade || !tradeSymbol || !tradeQty || !marketOpen}
              >
                {submittingTrade ? 'Submitting...' : tradeSide === 'buy' ? 'Buy' : 'Sell'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={styles.transferSection}>
        <div className={styles.transferLabel}>Transfer Funds</div>
        <div className={styles.transferRow}>
          <span className={styles.dollarSign}>$</span>
          <input
            type="number"
            className={styles.transferInput}
            placeholder="0.00"
            value={transferAmount}
            onChange={e => setTransferAmount(e.target.value)}
            min="0"
            step="100"
          />
          <button
            className={styles.depositBtn}
            onClick={() => handleTransfer('deposit')}
            disabled={transferring || !transferAmount}
          >
            Deposit
          </button>
          <button
            className={styles.withdrawBtn}
            onClick={() => handleTransfer('withdraw')}
            disabled={transferring || !transferAmount}
          >
            Withdraw
          </button>
        </div>
      </div>

      {data.positions.length === 0
        ? <p className={styles.muted}>No open positions.</p>
        : (
          <div className={styles.tableWrapper}>
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
                  <td className={`${styles.td} ${styles.tdNum}`}>{formatQty(p.qty)}</td>
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
          </div>
        )
      }

      {/* Reset Dialog */}
      {showResetDialog && (
        <div className={styles.dialogOverlay} onClick={() => setShowResetDialog(false)}>
          <div className={styles.dialog} onClick={e => e.stopPropagation()}>
            <div className={styles.dialogHeader}>
              <span className={styles.warningIcon}>⚠️</span>
              <h2>Reset Portfolio</h2>
            </div>
            <div className={styles.dialogBody}>
              <p className={styles.warningText}>
                <strong>Warning:</strong> This will clear all positions and reset your cash balance to the starting amount.
              </p>
              <p className={styles.warningDetail}>
                • All {data.positions.length} position(s) will be closed<br />
                • Cash will be reset to {centsToUSD(data.totalValueCents)}<br />
                • This action cannot be undone
              </p>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={preserveHistory}
                  onChange={e => setPreserveHistory(e.target.checked)}
                />
                Preserve trade history (for analytics)
              </label>
              <label className={styles.confirmLabel}>
                <input
                  type="checkbox"
                  checked={resetConfirmed}
                  onChange={e => setResetConfirmed(e.target.checked)}
                />
                <strong>I understand this will reset my portfolio</strong>
              </label>
            </div>
            <div className={styles.dialogActions}>
              <button
                className={styles.cancelBtn}
                onClick={() => {
                  setShowResetDialog(false);
                  setResetConfirmed(false);
                }}
              >
                Cancel
              </button>
              <button
                className={styles.confirmResetBtn}
                onClick={handleReset}
                disabled={!resetConfirmed || resetting}
              >
                {resetting ? 'Resetting...' : 'Reset Portfolio'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
