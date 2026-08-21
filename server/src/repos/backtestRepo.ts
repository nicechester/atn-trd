import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface BacktestRunRow {
  id: string;
  name: string | null;
  startDate: string;
  endDate: string;
  symbols: string[];
  settingsSnapshot: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface BacktestSnapshotRow {
  id: string;
  backtestId: string;
  asOfDate: string;
  cashCents: number;
  positions: Array<{ symbol: string; qty: number; avgCostCents: number }>;
  totalValueCents: number;
  benchmarkValueCents: number | null;
}

export interface BacktestTradeRow {
  id: string;
  backtestId: string;
  tradeDate: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  priceCents: number;
  rationale: string | null;
}

export interface BacktestMetricsRow {
  backtestId: string;
  totalReturn: number;
  benchmarkReturn: number;
  sharpeRatio: number | null;
  sortinoRatio: number | null;
  maxDrawdown: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  totalTrades: number;
  perSymbol: Record<string, { return: number | null; trades: number }> | null;
}

export class BacktestRepo {
  constructor(private readonly db: Database.Database) {}

  createRun(input: {
    name?: string;
    startDate: string;
    endDate: string;
    symbols: string[];
    settingsSnapshot: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO backtest_runs (id, name, start_date, end_date, symbols_json, settings_snapshot, status, started_at, finished_at, error)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL)
    `).run(id, input.name ?? null, input.startDate, input.endDate, JSON.stringify(input.symbols), input.settingsSnapshot, now);

    return id;
  }

  updateRunStatus(id: string, status: 'succeeded' | 'failed', error?: string): void {
    this.db.prepare(`
      UPDATE backtest_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?
    `).run(status, Date.now(), error ?? null, id);
  }

  getRun(id: string): BacktestRunRow | null {
    const row = this.db.prepare(`
      SELECT id, name, start_date, end_date, symbols_json, settings_snapshot, status, started_at, finished_at, error
      FROM backtest_runs WHERE id = ?
    `).get(id) as {
      id: string;
      name: string | null;
      start_date: string;
      end_date: string;
      symbols_json: string;
      settings_snapshot: string;
      status: 'running' | 'succeeded' | 'failed';
      started_at: number;
      finished_at: number | null;
      error: string | null;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      symbols: JSON.parse(row.symbols_json),
      settingsSnapshot: row.settings_snapshot,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
    };
  }

  listRuns(limit = 20): BacktestRunRow[] {
    const rows = this.db.prepare(`
      SELECT id, name, start_date, end_date, symbols_json, settings_snapshot, status, started_at, finished_at, error
      FROM backtest_runs ORDER BY started_at DESC LIMIT ?
    `).all(limit) as Array<{
      id: string;
      name: string | null;
      start_date: string;
      end_date: string;
      symbols_json: string;
      settings_snapshot: string;
      status: 'running' | 'succeeded' | 'failed';
      started_at: number;
      finished_at: number | null;
      error: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      symbols: JSON.parse(row.symbols_json),
      settingsSnapshot: row.settings_snapshot,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
    }));
  }

  createSnapshot(input: {
    backtestId: string;
    asOfDate: string;
    cashCents: number;
    positions: Array<{ symbol: string; qty: number; avgCostCents: number }>;
    totalValueCents: number;
    benchmarkValueCents?: number;
  }): string {
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO backtest_snapshots (id, backtest_id, as_of_date, cash_cents, positions_json, total_value_cents, benchmark_value_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.backtestId, input.asOfDate, input.cashCents, JSON.stringify(input.positions), input.totalValueCents, input.benchmarkValueCents ?? null);

    return id;
  }

  getSnapshots(backtestId: string): BacktestSnapshotRow[] {
    const rows = this.db.prepare(`
      SELECT id, backtest_id, as_of_date, cash_cents, positions_json, total_value_cents, benchmark_value_cents
      FROM backtest_snapshots WHERE backtest_id = ? ORDER BY as_of_date
    `).all(backtestId) as Array<{
      id: string;
      backtest_id: string;
      as_of_date: string;
      cash_cents: number;
      positions_json: string;
      total_value_cents: number;
      benchmark_value_cents: number | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      backtestId: row.backtest_id,
      asOfDate: row.as_of_date,
      cashCents: row.cash_cents,
      positions: JSON.parse(row.positions_json),
      totalValueCents: row.total_value_cents,
      benchmarkValueCents: row.benchmark_value_cents,
    }));
  }

  createTrade(input: {
    backtestId: string;
    tradeDate: string;
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    priceCents: number;
    rationale?: string;
  }): string {
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO backtest_trades (id, backtest_id, trade_date, symbol, side, qty, price_cents, rationale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.backtestId, input.tradeDate, input.symbol, input.side, input.qty, input.priceCents, input.rationale ?? null);

    return id;
  }

  getTrades(backtestId: string): BacktestTradeRow[] {
    const rows = this.db.prepare(`
      SELECT id, backtest_id, trade_date, symbol, side, qty, price_cents, rationale
      FROM backtest_trades WHERE backtest_id = ? ORDER BY trade_date
    `).all(backtestId) as Array<{
      id: string;
      backtest_id: string;
      trade_date: string;
      symbol: string;
      side: 'buy' | 'sell';
      qty: number;
      price_cents: number;
      rationale: string | null;
    }>;

    return rows.map(row => ({
      id: row.id,
      backtestId: row.backtest_id,
      tradeDate: row.trade_date,
      symbol: row.symbol,
      side: row.side,
      qty: row.qty,
      priceCents: row.price_cents,
      rationale: row.rationale,
    }));
  }

  saveMetrics(metrics: BacktestMetricsRow): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO backtest_metrics (backtest_id, total_return, benchmark_return, sharpe_ratio, sortino_ratio, max_drawdown, win_rate, avg_win, avg_loss, total_trades, per_symbol_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      metrics.backtestId,
      metrics.totalReturn,
      metrics.benchmarkReturn,
      metrics.sharpeRatio,
      metrics.sortinoRatio,
      metrics.maxDrawdown,
      metrics.winRate,
      metrics.avgWin,
      metrics.avgLoss,
      metrics.totalTrades,
      metrics.perSymbol ? JSON.stringify(metrics.perSymbol) : null
    );
  }

  getMetrics(backtestId: string): BacktestMetricsRow | null {
    const row = this.db.prepare(`
      SELECT backtest_id, total_return, benchmark_return, sharpe_ratio, sortino_ratio, max_drawdown, win_rate, avg_win, avg_loss, total_trades, per_symbol_json
      FROM backtest_metrics WHERE backtest_id = ?
    `).get(backtestId) as {
      backtest_id: string;
      total_return: number;
      benchmark_return: number;
      sharpe_ratio: number | null;
      sortino_ratio: number | null;
      max_drawdown: number;
      win_rate: number | null;
      avg_win: number | null;
      avg_loss: number | null;
      total_trades: number;
      per_symbol_json: string | null;
    } | undefined;

    if (!row) return null;

    return {
      backtestId: row.backtest_id,
      totalReturn: row.total_return,
      benchmarkReturn: row.benchmark_return,
      sharpeRatio: row.sharpe_ratio,
      sortinoRatio: row.sortino_ratio,
      maxDrawdown: row.max_drawdown,
      winRate: row.win_rate,
      avgWin: row.avg_win,
      avgLoss: row.avg_loss,
      totalTrades: row.total_trades,
      perSymbol: row.per_symbol_json ? JSON.parse(row.per_symbol_json) : null,
    };
  }
}
