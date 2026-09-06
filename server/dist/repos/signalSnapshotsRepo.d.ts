import type Database from 'better-sqlite3';
export interface SignalSnapshotRow {
    id: string;
    symbol: string;
    snapshotDate: string;
    priceCents: number | null;
    sentimentScore: number | null;
    sentimentConfidence: number | null;
    sentimentTrend: number | null;
    priceVsSma50: number | null;
    compositeScore: number | null;
    compositeEwma: number | null;
    createdAt: number;
}
export declare class SignalSnapshotsRepo {
    private readonly db;
    constructor(db: Database.Database);
    upsert(row: SignalSnapshotRow): void;
    get(symbol: string, snapshotDate: string): SignalSnapshotRow | undefined;
    getLatest(symbol: string): SignalSnapshotRow | undefined;
    listBySymbol(symbol: string, limit?: number): SignalSnapshotRow[];
    listByDateRange(symbol: string, fromDate: string, toDate: string): SignalSnapshotRow[];
    /** Get recent N snapshots to check consecutive days below threshold */
    getRecentSnapshots(symbol: string, days: number): SignalSnapshotRow[];
    /** Get previous N days of sentiment scores for trend calculation */
    getRecentSentiment(symbol: string, days: number): Array<{
        snapshotDate: string;
        sentimentScore: number;
    }>;
}
//# sourceMappingURL=signalSnapshotsRepo.d.ts.map