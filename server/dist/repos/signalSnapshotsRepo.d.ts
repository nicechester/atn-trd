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
    /**
     * Insert snapshot if not exists. Skips if already recorded for this symbol+date.
     * This ensures snapshots are immutable for IC measurement against forward returns.
     */
    insert(row: SignalSnapshotRow): boolean;
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
    /**
     * Get all snapshots for IC measurement.
     * Returns snapshots with both sentiment and price for forward return calculation.
     */
    listForIcMeasurement(fromDate: string, toDate: string): Array<{
        symbol: string;
        snapshotDate: string;
        priceCents: number;
        sentimentScore: number;
        priceVsSma50: number | null;
        compositeScore: number | null;
    }>;
}
//# sourceMappingURL=signalSnapshotsRepo.d.ts.map