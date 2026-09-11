-- Symbol categories and dividend data from screener
CREATE TABLE IF NOT EXISTS symbol_categories (
  symbol TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK(category IN ('GROWTH_CORE', 'DIVIDEND_GROWTH', 'INCOME_BOOSTER', 'HEDGE')),
  yield_percent REAL,
  dividend_growth_percent REAL,
  est_cagr_percent REAL,
  last_screened_at INTEGER,
  updated_at INTEGER NOT NULL
);
