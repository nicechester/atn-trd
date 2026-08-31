/**
 * Volatility computation utilities.
 */

export interface Bar {
  barDate: number; // timestamp
  close: number;
}

/**
 * Compute annualized volatility from daily close prices.
 * Returns null if insufficient data.
 * Assumes bars sorted by barDate ascending.
 */
export function computeAnnualizedVolatility(
  bars: Bar[],
  tradingDaysPerYear: number = 252
): number | null {
  // Sort bars by barDate ascending (defensive)
  const sortedBars = [...bars].sort((a, b) => a.barDate - b.barDate);

  if (sortedBars.length < 2) {
    return null;
  }

  // Compute daily returns (log returns)
  const dailyReturns: number[] = [];
  for (let i = 1; i < sortedBars.length; i++) {
    const prevClose = sortedBars[i - 1].close;
    const currClose = sortedBars[i].close;
    if (prevClose > 0 && currClose > 0) {
      const dailyReturn = Math.log(currClose / prevClose);
      dailyReturns.push(dailyReturn);
    }
  }

  if (dailyReturns.length === 0) {
    return null;
  }

  // Compute standard deviation
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance =
    dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / dailyReturns.length;
  const dailyStdDev = Math.sqrt(variance);

  // Annualize
  return dailyStdDev * Math.sqrt(tradingDaysPerYear);
}

/**
 * Compute trailing return percent over the entire bar period.
 * Returns null if insufficient data or invalid closes.
 * Assumes bars sorted by barDate ascending.
 */
export function computeTrailingReturnPercent(bars: Bar[]): number | null {
  // Sort bars by barDate ascending (defensive)
  const sortedBars = [...bars].sort((a, b) => a.barDate - b.barDate);

  if (sortedBars.length < 2) {
    return null;
  }

  const firstClose = sortedBars[0].close;
  const lastClose = sortedBars[sortedBars.length - 1].close;

  if (firstClose <= 0 || lastClose <= 0) {
    return null;
  }

  return ((lastClose - firstClose) / firstClose) * 100;
}
