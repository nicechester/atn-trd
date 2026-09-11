-- ATN-TRD Complete Schema (v25)
-- Generated from migrations 001-025
-- Use this for fresh database installs

-- ============================================================================
-- CONFIGURATION & INFRASTRUCTURE
-- ============================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  doc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  value_enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  note TEXT,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  cash_cents INTEGER NOT NULL,
  starting_cash_cents INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  reset_at INTEGER,
  base_currency TEXT DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

-- ============================================================================
-- AGENT RUNS & RESEARCH
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK(trigger IN ('scheduled', 'manual', 'signal_collection', 'plan_review', 'tranche_execution', 'watchlist_curation')),
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'skipped')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  model TEXT,
  settings_snapshot TEXT NOT NULL,
  error TEXT,
  token_usage_json TEXT,
  skip_reason TEXT,
  summary_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_trigger ON agent_runs(trigger);

CREATE TABLE IF NOT EXISTS research_artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT,
  source TEXT NOT NULL CHECK(source IN ('news', 'fundamentals', 'macro', 'options', 'prices')),
  provider TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  summary TEXT,
  citations_json TEXT,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_research_artifacts_run_id ON research_artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_research_artifacts_symbol ON research_artifacts(symbol);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('system', 'human', 'ai', 'tool')),
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_args_json TEXT,
  tool_result_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_run_id ON agent_messages(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_messages_symbol ON agent_messages(symbol);
CREATE INDEX IF NOT EXISTS idx_agent_messages_seq ON agent_messages(run_id, seq);

-- ============================================================================
-- ASSESSMENTS & DECISIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  score REAL NOT NULL,
  confidence REAL NOT NULL,
  thesis TEXT NOT NULL,
  risks TEXT,
  catalysts TEXT,
  evidence_ids_json TEXT,
  created_at INTEGER NOT NULL,
  sentiment_summary TEXT,
  finbert_score REAL,
  finbert_label TEXT CHECK(finbert_label IN ('positive', 'negative', 'neutral')),
  finbert_confidence REAL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_assessments_run_id ON assessments(run_id);
CREATE INDEX IF NOT EXISTS idx_assessments_symbol ON assessments(symbol);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'hold', 'trim', 'add')),
  target_weight REAL,
  confidence REAL NOT NULL,
  rationale TEXT NOT NULL,
  assessment_id TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id),
  FOREIGN KEY(assessment_id) REFERENCES assessments(id)
);

CREATE INDEX IF NOT EXISTS idx_decisions_run_id ON decisions(run_id);
CREATE INDEX IF NOT EXISTS idx_decisions_symbol ON decisions(symbol);

CREATE TABLE IF NOT EXISTS rejections (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  decision_id TEXT,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'hold', 'trim', 'add')),
  confidence REAL NOT NULL,
  target_weight REAL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id),
  FOREIGN KEY(decision_id) REFERENCES decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_rejections_run_id ON rejections(run_id);
CREATE INDEX IF NOT EXISTS idx_rejections_symbol ON rejections(symbol);

-- ============================================================================
-- ORDERS & FILLS
-- ============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  client_order_id TEXT NOT NULL UNIQUE,
  decision_id TEXT,
  run_id TEXT,
  broker TEXT NOT NULL,
  broker_order_id TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('paper', 'live')),
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK(side IN ('buy', 'sell')),
  qty REAL NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('market', 'limit')),
  limit_price_cents INTEGER,
  tif TEXT NOT NULL CHECK(tif IN ('day', 'gtc')),
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'partially_filled', 'filled', 'canceled', 'rejected', 'expired')),
  reject_reason TEXT,
  submitted_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(decision_id) REFERENCES decisions(id),
  FOREIGN KEY(run_id) REFERENCES agent_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_orders_client_order_id ON orders(client_order_id);
CREATE INDEX IF NOT EXISTS idx_orders_run_id ON orders(run_id);
CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_submitted_at ON orders(submitted_at);

CREATE TABLE IF NOT EXISTS fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  qty REAL NOT NULL,
  price_cents INTEGER NOT NULL,
  fee_cents INTEGER DEFAULT 0,
  filled_at INTEGER NOT NULL,
  bar_date TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id)
);

CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills(order_id);
CREATE INDEX IF NOT EXISTS idx_fills_bar_date ON fills(bar_date);

-- ============================================================================
-- POSITIONS & PORTFOLIO
-- ============================================================================

CREATE TABLE IF NOT EXISTS positions (
  symbol TEXT PRIMARY KEY,
  qty REAL NOT NULL,
  avg_cost_cents INTEGER NOT NULL,
  realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_positions_updated_at ON positions(updated_at);

CREATE TABLE IF NOT EXISTS price_bars (
  symbol TEXT NOT NULL,
  bar_date TEXT NOT NULL,
  open_cents INTEGER NOT NULL,
  high_cents INTEGER NOT NULL,
  low_cents INTEGER NOT NULL,
  close_cents INTEGER NOT NULL,
  adj_close_cents INTEGER NOT NULL,
  volume INTEGER,
  provider TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY(symbol, bar_date)
);

CREATE INDEX IF NOT EXISTS idx_price_bars_symbol ON price_bars(symbol);
CREATE INDEX IF NOT EXISTS idx_price_bars_bar_date ON price_bars(bar_date);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,
  as_of_date TEXT NOT NULL UNIQUE,
  cash_cents INTEGER NOT NULL,
  positions_value_cents INTEGER NOT NULL,
  total_value_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  unrealized_pnl_cents INTEGER NOT NULL DEFAULT 0,
  weights_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_as_of_date ON portfolio_snapshots(as_of_date);

CREATE TABLE IF NOT EXISTS benchmark_snapshots (
  symbol TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  close_cents INTEGER NOT NULL,
  adj_close_cents INTEGER NOT NULL,
  PRIMARY KEY(symbol, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_snapshots_as_of_date ON benchmark_snapshots(as_of_date);

-- ============================================================================
-- CALIBRATION & EMBEDDINGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS confidence_calibration (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  predicted_direction TEXT NOT NULL CHECK(predicted_direction IN ('long', 'short', 'hold')),
  confidence REAL NOT NULL,
  actual_return_5d REAL,
  actual_return_20d REAL,
  correct_direction INTEGER CHECK(correct_direction IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calibration_run_id ON confidence_calibration(run_id);
CREATE INDEX IF NOT EXISTS idx_calibration_symbol ON confidence_calibration(symbol);
CREATE INDEX IF NOT EXISTS idx_calibration_created_at ON confidence_calibration(created_at);
CREATE INDEX IF NOT EXISTS idx_calibration_pending ON confidence_calibration(actual_return_5d) WHERE actual_return_5d IS NULL;

CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL CHECK(source_type IN ('assessment', 'artifact', 'trade_outcome')),
  source_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  symbol TEXT,
  text_content TEXT NOT NULL,
  embedding_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_embeddings_source ON embeddings(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_symbol ON embeddings(symbol);
CREATE INDEX IF NOT EXISTS idx_embeddings_run_id ON embeddings(run_id);

-- ============================================================================
-- SCREENER & SYMBOL CATEGORIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS screener_selections (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rationale TEXT NOT NULL,
  conviction REAL NOT NULL,
  selected_json TEXT,
  rejected_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_screener_selections_run_id ON screener_selections(run_id);
CREATE INDEX IF NOT EXISTS idx_screener_selections_symbol ON screener_selections(symbol);

CREATE TABLE IF NOT EXISTS symbol_categories (
  symbol TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('GROWTH_CORE', 'DIVIDEND_GROWTH', 'INCOME_BOOSTER', 'HEDGE')),
  sector TEXT,
  yield_percent REAL,
  dividend_growth_percent REAL,
  est_cagr_percent REAL,
  last_screened_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- ============================================================================
-- SIGNALS & MARKET REGIME
-- ============================================================================

CREATE TABLE IF NOT EXISTS signal_snapshots (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  price_cents INTEGER,
  sentiment_score REAL,
  sentiment_confidence REAL,
  sentiment_trend REAL,
  price_vs_sma50 REAL,
  composite_score REAL,
  composite_ewma REAL,
  created_at INTEGER NOT NULL,
  sentiment_synthesis TEXT,
  UNIQUE(symbol, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_signal_snapshots_symbol_date ON signal_snapshots(symbol, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_signal_snapshots_date ON signal_snapshots(snapshot_date);

CREATE TABLE IF NOT EXISTS market_regime (
  id TEXT PRIMARY KEY,
  as_of_date TEXT NOT NULL UNIQUE,
  regime TEXT NOT NULL CHECK(regime IN ('RISK_ON', 'RISK_OFF', 'NEUTRAL')),
  vix_level REAL,
  yield_curve_spread REAL,
  breadth_pct REAL,
  risk_score REAL,
  indicators_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_regime_date ON market_regime(as_of_date);

-- ============================================================================
-- STRATEGIC PLANS
-- ============================================================================

CREATE TABLE IF NOT EXISTS strategic_plans (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  target_shares REAL NOT NULL,
  executed_shares REAL DEFAULT 0,
  target_weight REAL,
  target_budget_cents INTEGER,
  tranche_count INTEGER DEFAULT 4,
  tranches_executed INTEGER DEFAULT 0,
  min_days_between INTEGER DEFAULT 5,
  entry_composite_score REAL,
  conviction_at_creation REAL,
  status TEXT DEFAULT 'ACTIVE',
  pause_reason TEXT,
  created_at INTEGER NOT NULL,
  last_tranche_at INTEGER,
  completed_at INTEGER,
  creation_notes TEXT,
  UNIQUE(symbol, status)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategic_plans_active_symbol
  ON strategic_plans(symbol) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_strategic_plans_status ON strategic_plans(status);

CREATE TABLE IF NOT EXISTS plan_tranches (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES strategic_plans(id),
  tranche_number INTEGER NOT NULL,
  shares REAL NOT NULL,
  price_cents INTEGER NOT NULL,
  order_id TEXT REFERENCES orders(id),
  composite_score REAL,
  regime TEXT,
  executed_at INTEGER NOT NULL,
  order_status TEXT DEFAULT 'PENDING',
  total_cost_cents INTEGER,
  filled_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_plan_tranches_plan ON plan_tranches(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_tranches_pending
  ON plan_tranches(order_status) WHERE order_status = 'PENDING';

-- ============================================================================
-- BACKTESTING
-- ============================================================================

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

-- ============================================================================
-- REPORTS & CASH FLOWS
-- ============================================================================

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tokens_used INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);

CREATE TABLE IF NOT EXISTS cash_flows (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
  amount_cents INTEGER NOT NULL,
  occurred_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_cash_flows_occurred_at ON cash_flows(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_cash_flows_type ON cash_flows(type);

-- ============================================================================
-- WATCHLIST REMOVALS
-- ============================================================================

CREATE TABLE IF NOT EXISTS watchlist_removals (
  symbol TEXT PRIMARY KEY,
  removed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watchlist_removals_removed_at ON watchlist_removals(removed_at);

-- ============================================================================
-- SCHEMA VERSION TRACKING
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- Mark all migrations as applied
INSERT INTO schema_migrations (version, applied_at) VALUES
  (1, strftime('%s', 'now') * 1000),
  (2, strftime('%s', 'now') * 1000),
  (3, strftime('%s', 'now') * 1000),
  (4, strftime('%s', 'now') * 1000),
  (5, strftime('%s', 'now') * 1000),
  (6, strftime('%s', 'now') * 1000),
  (7, strftime('%s', 'now') * 1000),
  (8, strftime('%s', 'now') * 1000),
  (9, strftime('%s', 'now') * 1000),
  (10, strftime('%s', 'now') * 1000),
  (11, strftime('%s', 'now') * 1000),
  (12, strftime('%s', 'now') * 1000),
  (13, strftime('%s', 'now') * 1000),
  (14, strftime('%s', 'now') * 1000),
  (15, strftime('%s', 'now') * 1000),
  (16, strftime('%s', 'now') * 1000),
  (17, strftime('%s', 'now') * 1000),
  (18, strftime('%s', 'now') * 1000),
  (19, strftime('%s', 'now') * 1000),
  (20, strftime('%s', 'now') * 1000),
  (21, strftime('%s', 'now') * 1000),
  (22, strftime('%s', 'now') * 1000),
  (23, strftime('%s', 'now') * 1000),
  (24, strftime('%s', 'now') * 1000),
  (25, strftime('%s', 'now') * 1000);
