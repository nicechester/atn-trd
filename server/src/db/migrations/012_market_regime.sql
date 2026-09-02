-- Market regime detection for strategic trading
-- Tracks risk-on/risk-off state based on macro indicators

CREATE TABLE market_regime (
  id TEXT PRIMARY KEY,
  as_of_date TEXT NOT NULL UNIQUE,  -- YYYY-MM-DD
  regime TEXT NOT NULL CHECK(regime IN ('RISK_ON', 'RISK_OFF', 'NEUTRAL')),

  -- Raw indicators
  vix_level REAL,
  yield_curve_spread REAL,           -- 10Y - 2Y
  breadth_pct REAL,                  -- % stocks above 200 SMA

  -- Scoring
  risk_score REAL,                   -- 0-1, higher = more risk-off
  indicators_json TEXT,              -- Full indicator breakdown

  created_at INTEGER NOT NULL
);

CREATE INDEX idx_market_regime_date ON market_regime(as_of_date);
