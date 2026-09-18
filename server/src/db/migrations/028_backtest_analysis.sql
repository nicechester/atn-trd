-- Add analysis column to store LLM analysis results
ALTER TABLE backtest_runs ADD COLUMN analysis TEXT;
