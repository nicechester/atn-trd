-- Risk engine rejections (orders that were not placed due to risk constraints)
CREATE TABLE IF NOT EXISTS rejections (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  decision_id TEXT,
  symbol TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('buy', 'sell', 'hold', 'trim', 'add')),
  confidence REAL NOT NULL,
  target_weight REAL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(run_id) REFERENCES agent_runs(id),
  FOREIGN KEY(decision_id) REFERENCES decisions(id)
);

CREATE INDEX IF NOT EXISTS idx_rejections_run_id ON rejections(run_id);
CREATE INDEX IF NOT EXISTS idx_rejections_symbol ON rejections(symbol);
