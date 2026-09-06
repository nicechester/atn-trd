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
export declare class SymbolCategoriesRepo {
    private readonly db;
    constructor(db: Database.Database);
    upsert(row: Omit<SymbolCategoryRow, 'updatedAt'>): void;
    get(symbol: string): SymbolCategoryRow | undefined;
    listAll(): SymbolCategoryRow[];
    getBySymbols(symbols: string[]): SymbolCategoryRow[];
    getSector(symbol: string): string | null;
}
//# sourceMappingURL=symbolCategoriesRepo.d.ts.map