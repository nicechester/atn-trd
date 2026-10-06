-- Cash flows table for tracking deposits and withdrawals
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
