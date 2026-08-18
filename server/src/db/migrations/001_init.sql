-- Phase 1: Configuration and infrastructure tables

-- Application settings (singleton document pattern)
CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  doc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Encrypted secrets storage
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  value_enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- User's watchlist symbols
CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY,
  enabled INTEGER DEFAULT 1,
  note TEXT,
  added_at INTEGER NOT NULL
);

-- Paper trading account state
CREATE TABLE IF NOT EXISTS portfolio (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  cash_cents INTEGER NOT NULL,
  starting_cash_cents INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  reset_at INTEGER,
  base_currency TEXT DEFAULT 'USD'
);

-- Audit trail of settings changes
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  user_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
