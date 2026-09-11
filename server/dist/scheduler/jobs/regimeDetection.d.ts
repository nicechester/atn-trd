/**
 * Regime Detection Job
 * Detects market regime from macro indicators (VIX, yield curve, credit spreads, sentiment).
 */
import type Database from 'better-sqlite3';
import { type RunTrigger } from '../../repos/runsRepo.js';
export interface RegimeDetectionSummary {
    regime: string;
    riskScore: number;
    indicators: {
        vix: number | null;
        yieldCurve: number | null;
        breadth: number | null;
        creditSpread: number | null;
        consumerSentiment: number | null;
    };
    confirmedStreak: number;
}
export declare function runRegimeDetectionJob(db: Database.Database, trigger?: RunTrigger): Promise<RegimeDetectionSummary>;
//# sourceMappingURL=regimeDetection.d.ts.map