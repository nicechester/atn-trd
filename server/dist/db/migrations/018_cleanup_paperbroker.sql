-- Cleanup: Remove PaperBroker data after Alpaca integration

-- Delete fills associated with paper broker orders
DELETE FROM fills WHERE order_id IN (
  SELECT id FROM orders WHERE broker = 'paper'
);

-- Delete all paper broker orders
DELETE FROM orders WHERE broker = 'paper';

-- Log the cleanup
-- Note: This migration assumes broker='alpaca' records are the only ones going forward
