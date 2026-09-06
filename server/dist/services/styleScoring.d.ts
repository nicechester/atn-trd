/**
 * Style-based scoring service for investment decisions.
 * Scores symbols on a scale of -1 (bearish) to +1 (bullish) based on
 * fundamental metrics, volatility, and investor style weights.
 */
import { type StyleWeights } from '@atn-trd/shared';
import { type Bar } from '../lib/volatility.js';
export interface Fundamentals {
    marketCap: number | null;
    revenueGrowth: number | null;
    earningsGrowth: number | null;
    peRatio: number | null;
    beta: number | null;
    dividendYield: number | null;
    fcfYield: number | null;
}
export interface VolatilityMetrics {
    annualizedVolatility: number | null;
    trailingReturnPercent: number | null;
}
/**
 * Build volatility metrics from price bars.
 */
export declare function buildVolatilityMetrics(bars: Bar[]): VolatilityMetrics;
/**
 * Score a symbol based on fundamentals, volatility, and style weights.
 * Returns a score in [-1, 1] where -1 is very bearish and +1 is very bullish.
 */
export declare function scoreSymbol(fundamentals: Fundamentals, volatility: VolatilityMetrics, weights: StyleWeights): number;
//# sourceMappingURL=styleScoring.d.ts.map