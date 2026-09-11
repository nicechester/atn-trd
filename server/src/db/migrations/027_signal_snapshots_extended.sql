-- Add options and fundamentals signals to signal_snapshots

ALTER TABLE signal_snapshots ADD COLUMN iv_percentile REAL;          -- 0-1, current IV vs 52-week range
ALTER TABLE signal_snapshots ADD COLUMN put_call_ratio REAL;         -- put/call open interest ratio
ALTER TABLE signal_snapshots ADD COLUMN valuation_score REAL;        -- -1 to 1, based on PE/PEG vs sector
ALTER TABLE signal_snapshots ADD COLUMN growth_score REAL;           -- -1 to 1, based on revenue/earnings growth
