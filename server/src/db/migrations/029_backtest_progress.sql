-- Add progress tracking to backtest_runs
ALTER TABLE backtest_runs ADD COLUMN progress TEXT DEFAULT 'starting';
