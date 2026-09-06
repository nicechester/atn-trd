import type Database from 'better-sqlite3';
export interface CalibrationRow {
    id: number;
    runId: string;
    symbol: string;
    predictedDirection: 'long' | 'short' | 'hold';
    confidence: number;
    actualReturn5d: number | null;
    actualReturn20d: number | null;
    correctDirection: number | null;
    createdAt: number;
}
export interface CalibrationBandResult {
    band: string;
    count: number;
    correctCount: number;
    avgReturn5d: number | null;
    avgReturn20d: number | null;
}
export declare class CalibrationRepo {
    private readonly db;
    constructor(db: Database.Database);
    create(row: Omit<CalibrationRow, 'id' | 'actualReturn5d' | 'actualReturn20d' | 'correctDirection' | 'createdAt'>): number;
    updateActuals(id: number, actualReturn5d: number | null, actualReturn20d: number | null, correctDirection: number | null): void;
    listPendingActuals(): CalibrationRow[];
    countPending(): number;
    getCalibrationReport(): CalibrationBandResult[];
}
//# sourceMappingURL=calibrationRepo.d.ts.map