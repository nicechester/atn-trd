-- Expand agent_runs trigger types for plan-driven execution
-- New types: signal_collection, plan_review, tranche_execution

-- Disable FK checks for table recreation
PRAGMA foreign_keys = OFF;

-- SQLite doesn't support ALTER CHECK constraint, so we recreate the table
-- First, drop any leftover temp table from failed migration
DROP TABLE IF EXISTS agent_runs_new;

-- Create new table with expanded trigger types
CREATE TABLE agent_runs_new (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK(trigger IN ('scheduled', 'manual', 'signal_collection', 'plan_review', 'tranche_execution')),
  status TEXT NOT NULL CHECK(status IN ('running', 'succeeded', 'failed', 'skipped')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  model TEXT,
  settings_snapshot TEXT NOT NULL,
  error TEXT,
  token_usage_json TEXT,
  skip_reason TEXT,
  -- New: structured summary for "why no trade" audit trail
  summary_json TEXT
);

-- Copy existing data
INSERT INTO agent_runs_new (id, trigger, status, started_at, finished_at, model, settings_snapshot, error, token_usage_json, skip_reason, summary_json)
SELECT id, trigger, status, started_at, finished_at, model, settings_snapshot, error, token_usage_json, skip_reason, NULL
FROM agent_runs;

-- Drop old table and rename
DROP TABLE agent_runs;
ALTER TABLE agent_runs_new RENAME TO agent_runs;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_agent_runs_started_at ON agent_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_trigger ON agent_runs(trigger);

-- Re-enable FK checks
PRAGMA foreign_keys = ON;
