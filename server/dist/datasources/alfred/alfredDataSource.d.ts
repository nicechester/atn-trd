/**
 * ALFRED Data Source for Backtesting
 *
 * Provides point-in-time macro data (VIX, yield curve) from prefetched alfred.db.
 * Used by ReplayRunner for regime detection without look-ahead bias.
 */
export interface AlfredObservation {
    seriesId: string;
    vintageDate: string;
    observationDate: string;
    value: number;
}
export interface AlfredDataSourceOptions {
    dbPath: string;
}
export declare class AlfredDataSource {
    private readonly db;
    private readonly stmtGetVintage;
    private readonly stmtGetLatestBefore;
    constructor(options: AlfredDataSourceOptions);
    /**
     * Get macro value as it was known on a specific date.
     * Falls back to most recent available if exact date not found.
     */
    getVintage(seriesId: string, asOfDate: string): AlfredObservation | null;
    /**
     * Get VIX value as of date.
     */
    getVix(asOfDate: string): number | null;
    /**
     * Get 10Y-2Y yield curve spread as of date.
     * Computed from DGS10 - DGS2 (T10Y2Y doesn't support ALFRED vintage queries).
     */
    getYieldCurve(asOfDate: string): number | null;
    /**
     * Get date range available in the database (from metadata table).
     */
    getDateRange(): {
        minDate: string;
        maxDate: string;
    } | null;
    /**
     * Get count of observations per series.
     */
    getStats(): Array<{
        seriesId: string;
        count: number;
        minDate: string;
        maxDate: string;
    }>;
    close(): void;
}
//# sourceMappingURL=alfredDataSource.d.ts.map