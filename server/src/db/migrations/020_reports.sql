-- Reports table for LLM-generated analysis reports
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
