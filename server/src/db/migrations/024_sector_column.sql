-- Add sector column to symbol_categories for sector exposure tracking
ALTER TABLE symbol_categories ADD COLUMN sector TEXT;
