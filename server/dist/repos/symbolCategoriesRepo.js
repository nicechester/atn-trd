export class SymbolCategoriesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    upsert(row) {
        this.db
            .prepare(`INSERT INTO symbol_categories (symbol, category, sector, yield_percent, dividend_growth_percent, est_cagr_percent, last_screened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
           category = excluded.category,
           sector = excluded.sector,
           yield_percent = excluded.yield_percent,
           dividend_growth_percent = excluded.dividend_growth_percent,
           est_cagr_percent = excluded.est_cagr_percent,
           last_screened_at = excluded.last_screened_at,
           updated_at = excluded.updated_at`)
            .run(row.symbol, row.category, row.sector, row.yieldPercent, row.dividendGrowthPercent, row.estCagrPercent, row.lastScreenedAt, Date.now());
    }
    get(symbol) {
        return this.db
            .prepare(`SELECT symbol, category, sector, yield_percent as yieldPercent, dividend_growth_percent as dividendGrowthPercent,
           est_cagr_percent as estCagrPercent, last_screened_at as lastScreenedAt, updated_at as updatedAt
         FROM symbol_categories WHERE symbol = ?`)
            .get(symbol);
    }
    listAll() {
        return this.db
            .prepare(`SELECT symbol, category, sector, yield_percent as yieldPercent, dividend_growth_percent as dividendGrowthPercent,
           est_cagr_percent as estCagrPercent, last_screened_at as lastScreenedAt, updated_at as updatedAt
         FROM symbol_categories ORDER BY symbol`)
            .all();
    }
    getBySymbols(symbols) {
        if (symbols.length === 0)
            return [];
        const placeholders = symbols.map(() => '?').join(',');
        return this.db
            .prepare(`SELECT symbol, category, sector, yield_percent as yieldPercent, dividend_growth_percent as dividendGrowthPercent,
           est_cagr_percent as estCagrPercent, last_screened_at as lastScreenedAt, updated_at as updatedAt
         FROM symbol_categories WHERE symbol IN (${placeholders}) ORDER BY symbol`)
            .all(...symbols);
    }
    getSector(symbol) {
        const row = this.db
            .prepare('SELECT sector FROM symbol_categories WHERE symbol = ?')
            .get(symbol);
        return row?.sector ?? null;
    }
}
//# sourceMappingURL=symbolCategoriesRepo.js.map