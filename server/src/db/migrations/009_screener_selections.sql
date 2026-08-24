-- Phase 4: Screener agent selections and results

-- Per-symbol selections from screener stage
CREATE TABLE IF NOT EXISTS screener_selections (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  rationale TEXT NOT NULL,
  conviction REAL NOT NULL,
  selected_json TEXT,
  rejected_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_screener_selections_run_id ON screener_selections(run_id);
CREATE INDEX IF NOT EXISTS idx_screener_selections_symbol ON screener_selections(symbol);
