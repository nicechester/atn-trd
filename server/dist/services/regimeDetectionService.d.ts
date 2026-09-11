/**
 * Market Regime Detection Service
 *
 * Detects market regime (RISK_ON / RISK_OFF / NEUTRAL) based on macro indicators.
 * Used to determine whether to execute equity accumulation or rotate to defensive assets.
 */
import type { Settings } from '@atn-trd/shared';
import type { MarketRegimeRepo, Regime } from '../repos/marketRegimeRepo.js';
import type { MacroDataSource } from '../datasources/macro/index.js';
export interface RegimeIndicators {
    vix: number | null;
    yieldCurve: number | null;
    breadth: number | null;
    creditSpread: number | null;
    consumerSentiment: number | null;
}
export interface RegimeDetectionDeps {
    marketRegimeRepo: MarketRegimeRepo;
    macroSource: MacroDataSource;
    getSettings: () => Settings;
}
export interface RegimeResult {
    regime: Regime;
    riskScore: number;
    indicators: RegimeIndicators;
    confirmedStreak: number;
}
/**
 * Detect current market regime and persist to database.
 */
export declare function detectRegime(deps: RegimeDetectionDeps): Promise<RegimeResult>;
/**
 * Check if plans should be paused based on regime confirmation.
 */
export declare function shouldPausePlans(deps: RegimeDetectionDeps): boolean;
/**
 * Get current regime (from latest stored value).
 */
export declare function getCurrentRegime(marketRegimeRepo: MarketRegimeRepo): Regime;
//# sourceMappingURL=regimeDetectionService.d.ts.map