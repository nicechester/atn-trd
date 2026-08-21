/**
 * Historical price provider for backtesting.
 * Wraps the PricesRepo to provide historical prices for the MockBroker.
 */

import type { PricesRepo } from '../repos/pricesRepo.js';
import type { HistoricalPriceProvider } from '../brokers/mockBroker.js';

export function createHistoricalPriceProvider(pricesRepo: PricesRepo): HistoricalPriceProvider {
  return {
    async getPrice(symbol: string, date: string) {
      const bar = pricesRepo.get(symbol, date);
      if (!bar) return null;

      return {
        openCents: bar.openCents,
        closeCents: bar.closeCents,
      };
    },
  };
}

/**
 * Get SPY benchmark price for a given date.
 */
export function createBenchmarkPriceProvider(pricesRepo: PricesRepo) {
  return async (date: string): Promise<number | null> => {
    const bar = pricesRepo.get('SPY', date);
    return bar?.closeCents ?? null;
  };
}
