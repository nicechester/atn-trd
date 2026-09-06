import type Database from 'better-sqlite3';
export interface FillRow {
    id: string;
    orderId: string;
    qty: number;
    priceCents: number;
    feeCents: number;
    filledAt: number;
    barDate: string;
}
export interface FillWithOrderRow extends FillRow {
    symbol: string;
    side: 'buy' | 'sell';
    mode: 'paper' | 'live';
}
export declare class FillsRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(fill: Omit<FillRow, 'id'>): string;
    get(id: string): FillRow | undefined;
    listByOrder(orderId: string): FillRow[];
    listByDate(barDate: string): FillRow[];
    listAll(limit?: number, offset?: number): FillRow[];
    listAllWithOrder(limit?: number, offset?: number): FillWithOrderRow[];
    countByOrder(orderId: string): number;
}
//# sourceMappingURL=fillsRepo.d.ts.map