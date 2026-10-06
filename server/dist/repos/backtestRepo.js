import { randomUUID } from 'crypto';
export class BacktestRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    createRun(input) {
        const id = randomUUID();
        const now = Date.now();
        this.db.prepare(`
      INSERT INTO backtest_runs (id, name, start_date, end_date, symbols_json, settings_snapshot, status, started_at, finished_at, error)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL)
    `).run(id, input.name ?? null, input.startDate, input.endDate, JSON.stringify(input.symbols), input.settingsSnapshot, now);
        return id;
    }
    updateRunStatus(id, status, error) {
        this.db.prepare(`
      UPDATE backtest_runs SET status = ?, finished_at = ?, error = ?, progress = ? WHERE id = ?
    `).run(status, Date.now(), error ?? null, status === 'succeeded' ? 'completed' : 'failed', id);
    }
    updateProgress(id, progress) {
        this.db.prepare(`
      UPDATE backtest_runs SET progress = ? WHERE id = ?
    `).run(progress, id);
    }
    updateSettingsSnapshot(id, settingsSnapshot) {
        this.db.prepare(`
      UPDATE backtest_runs SET settings_snapshot = ? WHERE id = ?
    `).run(settingsSnapshot, id);
    }
    getRun(id) {
        const row = this.db.prepare(`
      SELECT id, name, start_date, end_date, symbols_json, settings_snapshot, status, progress, started_at, finished_at, error, analysis
      FROM backtest_runs WHERE id = ?
    `).get(id);
        if (!row)
            return null;
        return {
            id: row.id,
            name: row.name,
            startDate: row.start_date,
            endDate: row.end_date,
            symbols: JSON.parse(row.symbols_json),
            settingsSnapshot: row.settings_snapshot,
            status: row.status,
            progress: row.progress,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            error: row.error,
            analysis: row.analysis,
        };
    }
    listRuns(limit = 20) {
        const rows = this.db.prepare(`
      SELECT id, name, start_date, end_date, symbols_json, settings_snapshot, status, progress, started_at, finished_at, error, analysis
      FROM backtest_runs ORDER BY started_at DESC LIMIT ?
    `).all(limit);
        return rows.map(row => ({
            id: row.id,
            name: row.name,
            startDate: row.start_date,
            endDate: row.end_date,
            symbols: JSON.parse(row.symbols_json),
            settingsSnapshot: row.settings_snapshot,
            status: row.status,
            progress: row.progress,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            error: row.error,
            analysis: row.analysis,
        }));
    }
    createSnapshot(input) {
        const id = randomUUID();
        this.db.prepare(`
      INSERT INTO backtest_snapshots (id, backtest_id, as_of_date, cash_cents, positions_json, total_value_cents, benchmark_value_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.backtestId, input.asOfDate, input.cashCents, JSON.stringify(input.positions), input.totalValueCents, input.benchmarkValueCents ?? null);
        return id;
    }
    getSnapshots(backtestId) {
        const rows = this.db.prepare(`
      SELECT id, backtest_id, as_of_date, cash_cents, positions_json, total_value_cents, benchmark_value_cents
      FROM backtest_snapshots WHERE backtest_id = ? ORDER BY as_of_date
    `).all(backtestId);
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
    createTrade(input) {
        const id = randomUUID();
        this.db.prepare(`
      INSERT INTO backtest_trades (id, backtest_id, trade_date, symbol, side, qty, price_cents, rationale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.backtestId, input.tradeDate, input.symbol, input.side, input.qty, input.priceCents, input.rationale ?? null);
        return id;
    }
    getTrades(backtestId) {
        const rows = this.db.prepare(`
      SELECT id, backtest_id, trade_date, symbol, side, qty, price_cents, rationale
      FROM backtest_trades WHERE backtest_id = ? ORDER BY trade_date
    `).all(backtestId);
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
    saveMetrics(metrics) {
        this.db.prepare(`
      INSERT OR REPLACE INTO backtest_metrics (backtest_id, total_return, benchmark_return, sharpe_ratio, sortino_ratio, max_drawdown, win_rate, avg_win, avg_loss, total_trades, per_symbol_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(metrics.backtestId, metrics.totalReturn, metrics.benchmarkReturn, metrics.sharpeRatio, metrics.sortinoRatio, metrics.maxDrawdown, metrics.winRate, metrics.avgWin, metrics.avgLoss, metrics.totalTrades, metrics.perSymbol ? JSON.stringify(metrics.perSymbol) : null);
    }
    getMetrics(backtestId) {
        const row = this.db.prepare(`
      SELECT backtest_id, total_return, benchmark_return, sharpe_ratio, sortino_ratio, max_drawdown, win_rate, avg_win, avg_loss, total_trades, per_symbol_json
      FROM backtest_metrics WHERE backtest_id = ?
    `).get(backtestId);
        if (!row)
            return null;
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
    updateAnalysis(id, analysis) {
        this.db.prepare(`
      UPDATE backtest_runs SET analysis = ? WHERE id = ?
    `).run(analysis, id);
    }
}
//# sourceMappingURL=backtestRepo.js.map