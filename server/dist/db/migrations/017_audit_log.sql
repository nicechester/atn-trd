-- Migration 017: Add audit_log table for portfolio reset and manual trading actions
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,  -- 'portfolio_reset', 'manual_order'
  actor TEXT NOT NULL,   -- username
  details TEXT,          -- JSON with action-specific details
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
