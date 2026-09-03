-- Add watchlist_curation to agent_runs trigger constraint
-- SQLite doesn't support ALTER CONSTRAINT, so we recreate the table

CREATE TABLE agent_runs_new (
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

INSERT INTO agent_runs_new SELECT * FROM agent_runs;
DROP TABLE agent_runs;
ALTER TABLE agent_runs_new RENAME TO agent_runs;

CREATE INDEX idx_agent_runs_started_at ON agent_runs(started_at DESC);
CREATE INDEX idx_agent_runs_trigger ON agent_runs(trigger);
