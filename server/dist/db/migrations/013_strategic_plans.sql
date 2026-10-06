-- Strategic plans for multi-week accumulation/trim campaigns
CREATE TABLE IF NOT EXISTS strategic_plans (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,           -- ACCUMULATE | TRIM | HEDGE

  -- Targets
  target_shares REAL NOT NULL,
  executed_shares REAL DEFAULT 0,
  target_weight REAL,                -- Target portfolio weight

  -- Tranching
  tranche_count INTEGER DEFAULT 4,
  tranches_executed INTEGER DEFAULT 0,
  min_days_between INTEGER DEFAULT 5,

  -- Triggers
  entry_composite_score REAL,        -- Score when plan created
  conviction_at_creation REAL,

  -- Status
  status TEXT DEFAULT 'ACTIVE',      -- ACTIVE | PAUSED | COMPLETED | CANCELLED
  pause_reason TEXT,

  -- Timestamps
  created_at INTEGER NOT NULL,
  last_tranche_at INTEGER,
  completed_at INTEGER,

  UNIQUE(symbol, status)             -- Only one active plan per symbol (via partial index below)
);

-- Partial unique index: only one ACTIVE plan per symbol
CREATE UNIQUE INDEX IF NOT EXISTS idx_strategic_plans_active_symbol
  ON strategic_plans(symbol) WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_strategic_plans_status ON strategic_plans(status);

-- Tranche execution history
CREATE TABLE IF NOT EXISTS plan_tranches (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES strategic_plans(id),
  tranche_number INTEGER NOT NULL,

  -- Execution
  shares REAL NOT NULL,
  price_cents INTEGER NOT NULL,
  order_id TEXT REFERENCES orders(id),

  -- Context at execution
  composite_score REAL,
  regime TEXT,

  executed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plan_tranches_plan ON plan_tranches(plan_id);
