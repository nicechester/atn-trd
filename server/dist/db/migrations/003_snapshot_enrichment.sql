-- Phase 3: Portfolio snapshot enrichment

-- Add unrealized P&L and position weights tracking
ALTER TABLE portfolio_snapshots ADD COLUMN unrealized_pnl_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE portfolio_snapshots ADD COLUMN weights_json TEXT;
