/**
 * Volatility computation utilities.
 */
export interface Bar {
    barDate: number;
    close: number;
}
/**
 * Compute annualized volatility from daily close prices.
 * Returns null if insufficient data.
 * Assumes bars sorted by barDate ascending.
 */
export declare function computeAnnualizedVolatility(bars: Bar[], tradingDaysPerYear?: number): number | null;
/**
 * Compute trailing return percent over the entire bar period.
 * Returns null if insufficient data or invalid closes.
 * Assumes bars sorted by barDate ascending.
 */
export declare function computeTrailingReturnPercent(bars: Bar[]): number | null;
//# sourceMappingURL=volatility.d.ts.map