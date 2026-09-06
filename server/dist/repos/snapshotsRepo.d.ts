import type Database from 'better-sqlite3';
export interface PortfolioSnapshotRow {
    id: string;
    asOfDate: string;
    cashCents: number;
    positionsValueCents: number;
    totalValueCents: number;
    unrealizedPnlCents: number;
    weightsJson: string | null;
    createdAt: number;
}
export interface BenchmarkSnapshotRow {
    symbol: string;
    asOfDate: string;
    closeCents: number;
    adjCloseCents: number;
}
export declare class SnapshotsRepo {
    private readonly db;
    constructor(db: Database.Database);
    upsertPortfolioSnapshot(snapshot: Omit<PortfolioSnapshotRow, 'id' | 'createdAt'>): string;
    getPortfolioSnapshot(asOfDate: string): PortfolioSnapshotRow | undefined;
    listPortfolioSnapshots(limit?: number): PortfolioSnapshotRow[];
    listPortfolioSnapshotsByDateRange(fromDate: string, toDate: string): PortfolioSnapshotRow[];
    upsertBenchmarkSnapshot(snapshot: BenchmarkSnapshotRow): void;
    getBenchmarkSnapshot(symbol: string, asOfDate: string): BenchmarkSnapshotRow | undefined;
    listBenchmarkSnapshots(symbol: string, limit?: number): BenchmarkSnapshotRow[];
    listBenchmarkSnapshotsByDateRange(symbol: string, fromDate: string, toDate: string): BenchmarkSnapshotRow[];
    deleteOldBenchmarkSnapshots(symbol: string, beforeDate: string): number;
}
//# sourceMappingURL=snapshotsRepo.d.ts.map