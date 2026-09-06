/**
 * Volatility calculation service.
 *
 * Computes historical volatility (20-day and 60-day annualized) from price history,
 * fetches beta from fundamentals, and implied volatility from options chain.
 * Combines all metrics into a single VolatilityMetrics object.
 */
/**
 * Volatility metrics for a symbol.
 */
export interface VolatilityMetrics {
    symbol: string;
    /** 20-day annualized historical volatility */
    historicalVol20d: number | null;
    /** 60-day annualized historical volatility */
    historicalVol60d: number | null;
    /** Beta from fundamentals (null if unavailable) */
    beta: number | null;
    /** Implied volatility from ATM option (null if unavailable) */
    impliedVol: number | null;
}
/**
 * Calculate historical volatility from price array.
 * Uses simple returns: (price_t - price_t-1) / price_t-1
 * Annualizes by multiplying by √252 (trading days per year)
 *
 * @param prices Array of closing prices in chronological order
 * @param _days Number of days worth of data (for documentation)
 * @returns Annualized volatility as decimal (e.g., 0.25 = 25%), or null if insufficient data
 */
export declare function calculateHistoricalVolatility(prices: number[], _days: number): number | null;
/**
 * Get volatility metrics for a symbol.
 * Fetches price history, beta, and implied volatility.
 * Returns a Promise that resolves to VolatilityMetrics.
 *
 * @param symbol Stock ticker symbol
 * @returns Promise<VolatilityMetrics>
 */
export declare function getVolatilityMetrics(symbol: string): Promise<VolatilityMetrics>;
//# sourceMappingURL=volatilityService.d.ts.map