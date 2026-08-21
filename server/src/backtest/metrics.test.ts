import { describe, it } from 'node:test';
import assert from 'node:assert';
import { calculateMetrics } from './metrics.js';
import type { BacktestSnapshotRow, BacktestTradeRow } from '../repos/backtestRepo.js';

describe('calculateMetrics', () => {
  it('returns zero metrics for insufficient snapshots', () => {
    const result = calculateMetrics({
      backtestId: 'test-1',
      snapshots: [{ id: '1', backtestId: 'test-1', asOfDate: '2024-01-01', cashCents: 100000, positions: [], totalValueCents: 100000, benchmarkValueCents: 100000 }],
      trades: [],
    });

    assert.strictEqual(result.totalReturn, 0);
    assert.strictEqual(result.maxDrawdown, 0);
    assert.strictEqual(result.totalTrades, 0);
  });

  it('calculates total return correctly', () => {
    const snapshots: BacktestSnapshotRow[] = [
      { id: '1', backtestId: 'test-1', asOfDate: '2024-01-01', cashCents: 100000_00, positions: [], totalValueCents: 100000_00, benchmarkValueCents: 100000_00 },
      { id: '2', backtestId: 'test-1', asOfDate: '2024-01-02', cashCents: 110000_00, positions: [], totalValueCents: 110000_00, benchmarkValueCents: 105000_00 },
    ];

    const result = calculateMetrics({
      backtestId: 'test-1',
      snapshots,
      trades: [],
    });

    assert.ok(Math.abs(result.totalReturn - 0.10) < 0.01); // 10% return
    assert.ok(Math.abs(result.benchmarkReturn - 0.05) < 0.01); // 5% benchmark return
  });

  it('calculates max drawdown correctly', () => {
    const snapshots: BacktestSnapshotRow[] = [
      { id: '1', backtestId: 'test-1', asOfDate: '2024-01-01', cashCents: 100000_00, positions: [], totalValueCents: 100000_00, benchmarkValueCents: null },
      { id: '2', backtestId: 'test-1', asOfDate: '2024-01-02', cashCents: 120000_00, positions: [], totalValueCents: 120000_00, benchmarkValueCents: null },
      { id: '3', backtestId: 'test-1', asOfDate: '2024-01-03', cashCents: 96000_00, positions: [], totalValueCents: 96000_00, benchmarkValueCents: null }, // 20% drawdown from peak
      { id: '4', backtestId: 'test-1', asOfDate: '2024-01-04', cashCents: 110000_00, positions: [], totalValueCents: 110000_00, benchmarkValueCents: null },
    ];

    const result = calculateMetrics({
      backtestId: 'test-1',
      snapshots,
      trades: [],
    });

    assert.ok(Math.abs(result.maxDrawdown - 0.20) < 0.01); // 20% max drawdown
  });

  it('calculates win rate from trades', () => {
    const snapshots: BacktestSnapshotRow[] = [
      { id: '1', backtestId: 'test-1', asOfDate: '2024-01-01', cashCents: 100000_00, positions: [], totalValueCents: 100000_00, benchmarkValueCents: null },
      { id: '2', backtestId: 'test-1', asOfDate: '2024-01-10', cashCents: 105000_00, positions: [], totalValueCents: 105000_00, benchmarkValueCents: null },
    ];

    const trades: BacktestTradeRow[] = [
      { id: '1', backtestId: 'test-1', tradeDate: '2024-01-02', symbol: 'AAPL', side: 'buy', qty: 10, priceCents: 150_00, rationale: null },
      { id: '2', backtestId: 'test-1', tradeDate: '2024-01-05', symbol: 'AAPL', side: 'sell', qty: 10, priceCents: 160_00, rationale: null }, // Win: +$100
      { id: '3', backtestId: 'test-1', tradeDate: '2024-01-03', symbol: 'MSFT', side: 'buy', qty: 5, priceCents: 300_00, rationale: null },
      { id: '4', backtestId: 'test-1', tradeDate: '2024-01-06', symbol: 'MSFT', side: 'sell', qty: 5, priceCents: 290_00, rationale: null }, // Loss: -$50
    ];

    const result = calculateMetrics({
      backtestId: 'test-1',
      snapshots,
      trades,
    });

    assert.ok(result.winRate !== null && Math.abs(result.winRate - 0.5) < 0.01); // 1 win, 1 loss = 50%
    assert.strictEqual(result.totalTrades, 4);
  });

  it('calculates per-symbol attribution', () => {
    const snapshots: BacktestSnapshotRow[] = [
      { id: '1', backtestId: 'test-1', asOfDate: '2024-01-01', cashCents: 100000_00, positions: [], totalValueCents: 100000_00, benchmarkValueCents: null },
      { id: '2', backtestId: 'test-1', asOfDate: '2024-01-10', cashCents: 105000_00, positions: [], totalValueCents: 105000_00, benchmarkValueCents: null },
    ];

    const trades: BacktestTradeRow[] = [
      { id: '1', backtestId: 'test-1', tradeDate: '2024-01-02', symbol: 'AAPL', side: 'buy', qty: 10, priceCents: 100_00, rationale: null },
      { id: '2', backtestId: 'test-1', tradeDate: '2024-01-05', symbol: 'AAPL', side: 'sell', qty: 10, priceCents: 120_00, rationale: null }, // +20%
    ];

    const result = calculateMetrics({
      backtestId: 'test-1',
      snapshots,
      trades,
    });

    assert.ok(result.perSymbol !== null);
    assert.ok(result.perSymbol!['AAPL'] !== undefined);
    assert.ok(result.perSymbol!['AAPL'].return !== null && Math.abs(result.perSymbol!['AAPL'].return - 0.20) < 0.01); // 20% return on AAPL
    assert.strictEqual(result.perSymbol!['AAPL'].trades, 2);
  });
});
