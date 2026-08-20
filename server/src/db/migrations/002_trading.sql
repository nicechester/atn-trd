-- Phase 2: Autonomous trading cycle tables

-- Agent run records (orchestrator and audit trail)
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK(trigger IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'skipped')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  model TEXT,
  settings_snapshot TEXT NOT NULL,
  error TEXT,
  token_usage_json TEXT,
  skip_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);

-- Research artifacts (evidence trail from data source fetches)
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

-- Agent messages (LLM conversation transcript)
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

-- Per-symbol assessments from analyst stage
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
  FOREIGN KEY(run_id) REFERENCES agent_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_assessments_run_id ON assessments(run_id);
CREATE INDEX IF NOT EXISTS idx_assessments_symbol ON assessments(symbol);

-- Portfolio manager decisions
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

-- Orders placed by risk engine
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

-- Fill execution records (separate from orders for partial fills)
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

-- Position state (materialized from fills)
CREATE TABLE IF NOT EXISTS positions (
  symbol TEXT PRIMARY KEY,
  qty REAL NOT NULL,
  avg_cost_cents INTEGER NOT NULL,
  realized_pnl_cents INTEGER NOT NULL DEFAULT 0,
  opened_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_positions_updated_at ON positions(updated_at);

-- Price bar cache (for fills, NAV, benchmark)
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

-- Portfolio snapshots (daily NAV tracking)
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,
  as_of_date TEXT NOT NULL UNIQUE,
  cash_cents INTEGER NOT NULL,
  positions_value_cents INTEGER NOT NULL,
  total_value_cents INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_as_of_date ON portfolio_snapshots(as_of_date);

-- Benchmark snapshots (SPY tracking for comparison)
CREATE TABLE IF NOT EXISTS benchmark_snapshots (
  symbol TEXT NOT NULL,
  as_of_date TEXT NOT NULL,
  close_cents INTEGER NOT NULL,
  adj_close_cents INTEGER NOT NULL,
  PRIMARY KEY(symbol, as_of_date)
);

CREATE INDEX IF NOT EXISTS idx_benchmark_snapshots_as_of_date ON benchmark_snapshots(as_of_date);

-- Risk engine rejections (orders that were not placed due to risk constraints)
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
