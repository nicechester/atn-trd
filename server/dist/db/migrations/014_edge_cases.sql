-- Edge case handling for strategic plans

-- 1. Chunky Stock Problem: Support budget-based targeting
ALTER TABLE strategic_plans ADD COLUMN target_budget_cents INTEGER;

-- 2. Order status tracking for partial fills
ALTER TABLE plan_tranches ADD COLUMN order_status TEXT DEFAULT 'PENDING';
ALTER TABLE plan_tranches ADD COLUMN total_cost_cents INTEGER;
ALTER TABLE plan_tranches ADD COLUMN filled_at INTEGER;

-- Create index for pending tranches that need status sync
CREATE INDEX IF NOT EXISTS idx_plan_tranches_pending
  ON plan_tranches(order_status) WHERE order_status = 'PENDING';
