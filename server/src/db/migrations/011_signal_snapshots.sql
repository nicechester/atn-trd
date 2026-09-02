-- Signal snapshots for strategic plan-based trading
-- Collects daily signals without making trading decisions

CREATE TABLE signal_snapshots (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,  -- YYYY-MM-DD

  -- Raw signals
  price_cents INTEGER,
  sentiment_score REAL,         -- FinBERT: -1 to 1
  sentiment_confidence REAL,

  -- Computed metrics
  sentiment_trend REAL,         -- 14-day slope
  price_vs_sma50 REAL,          -- % above/below
  composite_score REAL,         -- Weighted combination
  composite_ewma REAL,          -- EWMA-smoothed composite

  created_at INTEGER NOT NULL,

  UNIQUE(symbol, snapshot_date)
);

CREATE INDEX idx_signal_snapshots_symbol_date ON signal_snapshots(symbol, snapshot_date);
CREATE INDEX idx_signal_snapshots_date ON signal_snapshots(snapshot_date);
