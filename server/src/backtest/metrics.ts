/**
 * Backtest metrics calculator.
 * Computes performance statistics from backtest snapshots and trades.
 */

import type { BacktestSnapshotRow, BacktestTradeRow, BacktestMetricsRow } from '../repos/backtestRepo.js';

const TRADING_DAYS_PER_YEAR = 252;
const RISK_FREE_RATE = 0.05; // 5% annual risk-free rate

export interface MetricsInput {
  backtestId: string;
  snapshots: BacktestSnapshotRow[];
  trades: BacktestTradeRow[];
}

export function calculateMetrics(input: MetricsInput): BacktestMetricsRow {
  const { backtestId, snapshots, trades } = input;

  if (snapshots.length < 2) {
    return {
      backtestId,
      totalReturn: 0,
      benchmarkReturn: 0,
      sharpeRatio: null,
      sortinoRatio: null,
      maxDrawdown: 0,
      winRate: null,
      avgWin: null,
      avgLoss: null,
      totalTrades: trades.length,
      perSymbol: null,
    };
  }

  const startValue = snapshots[0].totalValueCents;
  const endValue = snapshots[snapshots.length - 1].totalValueCents;
  const totalReturn = (endValue - startValue) / startValue;

  const startBenchmark = snapshots[0].benchmarkValueCents;
  const endBenchmark = snapshots[snapshots.length - 1].benchmarkValueCents;
  const benchmarkReturn = startBenchmark && endBenchmark
    ? (endBenchmark - startBenchmark) / startBenchmark
    : 0;

  const dailyReturns = calculateDailyReturns(snapshots);
  const sharpeRatio = calculateSharpeRatio(dailyReturns);
  const sortinoRatio = calculateSortinoRatio(dailyReturns);
  const maxDrawdown = calculateMaxDrawdown(snapshots);
  const tradeStats = calculateTradeStats(trades);
  const perSymbol = calculatePerSymbolAttribution(trades);

  return {
    backtestId,
    totalReturn,
    benchmarkReturn,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown,
    winRate: tradeStats.winRate,
    avgWin: tradeStats.avgWin,
    avgLoss: tradeStats.avgLoss,
    totalTrades: trades.length,
    perSymbol,
  };
}

function calculateDailyReturns(snapshots: BacktestSnapshotRow[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prevValue = snapshots[i - 1].totalValueCents;
    const currValue = snapshots[i].totalValueCents;
    if (prevValue > 0) {
      returns.push((currValue - prevValue) / prevValue);
    }
  }
  return returns;
}

function calculateSharpeRatio(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 2) return null;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return null;

  const annualizedReturn = mean * TRADING_DAYS_PER_YEAR;
  const annualizedStdDev = stdDev * Math.sqrt(TRADING_DAYS_PER_YEAR);

  return (annualizedReturn - RISK_FREE_RATE) / annualizedStdDev;
}

function calculateSortinoRatio(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 2) return null;

  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const negativeReturns = dailyReturns.filter(r => r < 0);
  if (negativeReturns.length === 0) return null;

  const downsideVariance = negativeReturns.reduce((sum, r) => sum + r ** 2, 0) / dailyReturns.length;
  const downsideDeviation = Math.sqrt(downsideVariance);

  if (downsideDeviation === 0) return null;

  const annualizedReturn = mean * TRADING_DAYS_PER_YEAR;
  const annualizedDownside = downsideDeviation * Math.sqrt(TRADING_DAYS_PER_YEAR);

  return (annualizedReturn - RISK_FREE_RATE) / annualizedDownside;
}

function calculateMaxDrawdown(snapshots: BacktestSnapshotRow[]): number {
  let peak = snapshots[0].totalValueCents;
  let maxDrawdown = 0;

  for (const snapshot of snapshots) {
    if (snapshot.totalValueCents > peak) {
      peak = snapshot.totalValueCents;
    }
    const drawdown = (peak - snapshot.totalValueCents) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}

function calculateTradeStats(trades: BacktestTradeRow[]): {
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
} {
  const symbolTrades = new Map<string, BacktestTradeRow[]>();
  for (const trade of trades) {
    const existing = symbolTrades.get(trade.symbol) ?? [];
    existing.push(trade);
    symbolTrades.set(trade.symbol, existing);
  }

  const roundTripPnls: number[] = [];

  for (const [, symbolTradeList] of symbolTrades) {
    let position = 0;
    let costBasis = 0;

    for (const trade of symbolTradeList.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))) {
      if (trade.side === 'buy') {
        costBasis += trade.qty * trade.priceCents;
        position += trade.qty;
      } else {
        const avgCost = position > 0 ? costBasis / position : 0;
        const pnl = trade.qty * (trade.priceCents - avgCost);
        roundTripPnls.push(pnl);
        position -= trade.qty;
        costBasis = position > 0 ? avgCost * position : 0;
      }
    }
  }

  if (roundTripPnls.length === 0) {
    return { winRate: null, avgWin: null, avgLoss: null };
  }

  const wins = roundTripPnls.filter(p => p > 0);
  const losses = roundTripPnls.filter(p => p < 0);

  return {
    winRate: wins.length / roundTripPnls.length,
    avgWin: wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length / 100 : null,
    avgLoss: losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length / 100 : null,
  };
}

function calculatePerSymbolAttribution(
  trades: BacktestTradeRow[]
): Record<string, { return: number; trades: number }> | null {
  const symbolTrades = new Map<string, BacktestTradeRow[]>();
  for (const trade of trades) {
    const existing = symbolTrades.get(trade.symbol) ?? [];
    existing.push(trade);
    symbolTrades.set(trade.symbol, existing);
  }

  if (symbolTrades.size === 0) return null;

  const result: Record<string, { return: number; trades: number }> = {};

  for (const [symbol, symbolTradeList] of symbolTrades) {
    let totalPnlCents = 0;
    let totalCostCents = 0;
    let position = 0;
    let costBasis = 0;

    for (const trade of symbolTradeList.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))) {
      if (trade.side === 'buy') {
        costBasis += trade.qty * trade.priceCents;
        totalCostCents += trade.qty * trade.priceCents;
        position += trade.qty;
      } else {
        const avgCost = position > 0 ? costBasis / position : 0;
        totalPnlCents += trade.qty * (trade.priceCents - avgCost);
        position -= trade.qty;
        costBasis = position > 0 ? avgCost * position : 0;
      }
    }

    result[symbol] = {
      return: totalCostCents > 0 ? totalPnlCents / totalCostCents : 0,
      trades: symbolTradeList.length,
    };
  }

  return result;
}
