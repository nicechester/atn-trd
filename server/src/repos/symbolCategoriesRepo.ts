import type Database from 'better-sqlite3';

export type SymbolCategory = 'GROWTH_CORE' | 'DIVIDEND_GROWTH' | 'INCOME_BOOSTER' | 'HEDGE';

export interface SymbolCategoryRow {
  symbol: string;
  category: SymbolCategory;
  sector: string | null;
  yieldPercent: number | null;
  dividendGrowthPercent: number | null;
  estCagrPercent: number | null;
  lastScreenedAt: number | null;
  updatedAt: number;
}

export class SymbolCategoriesRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(row: Omit<SymbolCategoryRow, 'updatedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO symbol_categories (symbol, category, sector, yield_percent, dividend_growth_percent, est_cagr_percent, last_screened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
           category = excluded.category,
           sector = excluded.sector,
           yield_percent = excluded.yield_percent,
           dividend_growth_percent = excluded.dividend_growth_percent,
           est_cagr_percent = excluded.est_cagr_percent,
           last_screened_at = excluded.last_screened_at,
           updated_at = excluded.updated_at`
      )
      .run(
        row.symbol,
        row.category,
        row.sector,
        row.yieldPercent,
        row.dividendGrowthPercent,
        row.estCagrPercent,
        row.lastScreenedAt,
        Date.now()
      );
  }

  get(symbol: string): SymbolCategoryRow | undefined {
    return this.db
      .prepare(
        `SELECT symbol, category, sector, yield_percent as yieldPercent, dividend_growth_percent as dividendGrowthPercent,
           est_cagr_percent as estCagrPercent, last_screened_at as lastScreenedAt, updated_at as updatedAt
         FROM symbol_categories WHERE symbol = ?`
      )
      .get(symbol) as SymbolCategoryRow | undefined;
  }

  listAll(): SymbolCategoryRow[] {
    return this.db
      .prepare(
        `SELECT symbol, category, sector, yield_percent as yieldPercent, dividend_growth_percent as dividendGrowthPercent,
           est_cagr_percent as estCagrPercent, last_screened_at as lastScreenedAt, updated_at as updatedAt
         FROM symbol_categories ORDER BY symbol`
      )
      .all() as SymbolCategoryRow[];
  }

  getBySymbols(symbols: string[]): SymbolCategoryRow[] {
    if (symbols.length === 0) return [];
    const placeholders = symbols.map(() => '?').join(',');
    return this.db
      .prepare(
        `SELECT symbol, category, sector, yield_percent as yieldPercent, dividend_growth_percent as dividendGrowthPercent,
           est_cagr_percent as estCagrPercent, last_screened_at as lastScreenedAt, updated_at as updatedAt
         FROM symbol_categories WHERE symbol IN (${placeholders}) ORDER BY symbol`
      )
      .all(...symbols) as SymbolCategoryRow[];
  }

  getSector(symbol: string): string | null {
    const row = this.db
      .prepare('SELECT sector FROM symbol_categories WHERE symbol = ?')
      .get(symbol) as { sector: string | null } | undefined;
    return row?.sector ?? null;
  }
}
