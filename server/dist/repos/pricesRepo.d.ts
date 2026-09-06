import type Database from 'better-sqlite3';
export interface PriceBarRow {
    symbol: string;
    barDate: string;
    openCents: number;
    highCents: number;
    lowCents: number;
    closeCents: number;
    adjCloseCents: number;
    volume: number | null;
    provider: string;
    fetchedAt: number;
}
export declare class PricesRepo {
    private readonly db;
    constructor(db: Database.Database);
    upsert(bar: PriceBarRow): void;
    get(symbol: string, barDate: string): PriceBarRow | undefined;
    listBySymbol(symbol: string, limit?: number): PriceBarRow[];
    listByDateRange(symbol: string, fromDate: string, toDate: string): PriceBarRow[];
    getLatest(symbol: string): PriceBarRow | undefined;
    deleteOlderThan(barDate: string): number;
}
//# sourceMappingURL=pricesRepo.d.ts.map