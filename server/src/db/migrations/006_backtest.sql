-- Phase 3: Backtesting infrastructure

-- Backtest run records
CREATE TABLE IF NOT EXISTS backtest_runs (
  id TEXT PRIMARY KEY,
  name TEXT,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  symbols_json TEXT NOT NULL,
  settings_snapshot TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_backtest_runs_started_at ON backtest_runs(started_at);

-- Backtest daily snapshots (portfolio state per simulated day)
CREATE TABLE IF NOT EXISTS backtest_snapshots (
  id TEXT PRIMARY KEY,
  backtest_id TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  cash_cents INTEGER NOT NULL,
  positions_json TEXT NOT NULL,
  total_value_cents INTEGER NOT NULL,
  benchmark_value_cents INTEGER,
  FOREIGN KEY(backtest_id) REFERENCES backtest_runs(id),
  UNIQUE(backtest_id, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_backtest_snapshots_backtest_id ON backtest_snapshots(backtest_id);

-- Backtest trades (fills during backtest)
CREATE TABLE IF NOT EXISTS backtest_trades (
  id TEXT PRIMARY KEY,
  backtest_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
  qty REAL NOT NULL,
  price_cents INTEGER NOT NULL,
  rationale TEXT,
  FOREIGN KEY(backtest_id) REFERENCES backtest_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_backtest_trades_backtest_id ON backtest_trades(backtest_id);

-- Backtest metrics (computed after run)
CREATE TABLE IF NOT EXISTS backtest_metrics (
  backtest_id TEXT PRIMARY KEY,
  total_return REAL NOT NULL,
  benchmark_return REAL NOT NULL,
  sharpe_ratio REAL,
  sortino_ratio REAL,
  max_drawdown REAL NOT NULL,
  win_rate REAL,
  avg_win REAL,
  avg_loss REAL,
  total_trades INTEGER NOT NULL,
  per_symbol_json TEXT,
  FOREIGN KEY(backtest_id) REFERENCES backtest_runs(id)
);
