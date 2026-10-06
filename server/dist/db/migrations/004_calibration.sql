CREATE TABLE IF NOT EXISTS confidence_calibration (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  predicted_direction TEXT NOT NULL CHECK(predicted_direction IN ('long', 'short', 'hold')),
  confidence REAL NOT NULL,
  actual_return_5d REAL,
  actual_return_20d REAL,
  correct_direction INTEGER CHECK(correct_direction IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_calibration_run_id ON confidence_calibration(run_id);
CREATE INDEX IF NOT EXISTS idx_calibration_symbol ON confidence_calibration(symbol);
CREATE INDEX IF NOT EXISTS idx_calibration_created_at ON confidence_calibration(created_at);
CREATE INDEX IF NOT EXISTS idx_calibration_pending ON confidence_calibration(actual_return_5d) WHERE actual_return_5d IS NULL;
