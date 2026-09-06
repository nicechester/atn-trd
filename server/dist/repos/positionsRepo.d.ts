import type Database from 'better-sqlite3';
export interface PositionRow {
    symbol: string;
    qty: number;
    avgCostCents: number;
    realizedPnlCents: number;
    openedAt: number;
    updatedAt: number;
}
export declare class PositionsRepo {
    private readonly db;
    constructor(db: Database.Database);
    upsert(position: PositionRow): void;
    get(symbol: string): PositionRow | undefined;
    list(): PositionRow[];
    listAll(): PositionRow[];
    remove(symbol: string): void;
    clear(): void;
    getTotalQtyCost(): {
        totalQty: number;
        totalCostCents: number;
    };
}
//# sourceMappingURL=positionsRepo.d.ts.map