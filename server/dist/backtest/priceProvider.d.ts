/**
 * Historical price provider for backtesting.
 * Wraps the PricesRepo to provide historical prices for the MockBroker.
 */
import type { PricesRepo } from '../repos/pricesRepo.js';
import type { HistoricalPriceProvider } from '../brokers/mockBroker.js';
export declare function createHistoricalPriceProvider(pricesRepo: PricesRepo): HistoricalPriceProvider;
/**
 * Get SPY benchmark price for a given date.
 */
export declare function createBenchmarkPriceProvider(pricesRepo: PricesRepo): (date: string) => Promise<number | null>;
//# sourceMappingURL=priceProvider.d.ts.map