-- Watchlist removals tracking table
-- Stores symbols explicitly removed by the user to prevent auto-add enrollment
CREATE TABLE IF NOT EXISTS watchlist_removals (
  symbol TEXT PRIMARY KEY,
  removed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watchlist_removals_removed_at ON watchlist_removals(removed_at);

-- Backfill: Auto-enroll all existing positions into watchlist
-- Only adds symbols not already in watchlist (respects manual additions/removals)
INSERT INTO watchlist (symbol, enabled, note, added_at)
SELECT DISTINCT
  p.symbol,
  1 as enabled,
  'Auto-added from existing position' as note,
  CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER) as added_at
FROM positions p
WHERE p.qty > 0
  AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.symbol = p.symbol)
ON CONFLICT(symbol) DO NOTHING;
