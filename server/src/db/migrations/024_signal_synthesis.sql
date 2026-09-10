-- Add sentiment_synthesis column to store LLM-generated sentiment summary
ALTER TABLE signal_snapshots ADD COLUMN sentiment_synthesis TEXT;
