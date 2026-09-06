import type Database from 'better-sqlite3';
export type Regime = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
export interface MarketRegimeRow {
    id: string;
    asOfDate: string;
    regime: Regime;
    vixLevel: number | null;
    yieldCurveSpread: number | null;
    breadthPct: number | null;
    riskScore: number;
    indicatorsJson: string | null;
    createdAt: number;
}
export declare class MarketRegimeRepo {
    private readonly db;
    constructor(db: Database.Database);
    upsert(row: MarketRegimeRow): void;
    get(asOfDate: string): MarketRegimeRow | undefined;
    getLatest(): MarketRegimeRow | undefined;
    /** Get recent regime history for confirmation logic */
    getRecentRegimes(days: number): MarketRegimeRow[];
    /** Check if regime has been consistent for N days (for confirmation) */
    getRegimeStreak(regime: Regime): number;
}
//# sourceMappingURL=marketRegimeRepo.d.ts.map