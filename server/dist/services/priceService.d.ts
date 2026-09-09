import { PricesRepo } from '../repos/pricesRepo.js';
/**
 * Interface for brokers to query current prices.
 * Used by order execution and portfolio valuation.
 */
export interface PriceFeed {
    /**
     * Get the current price for a symbol.
     * Falls back to latest cached price if unavailable.
     */
    getPrice(symbol: string): Promise<number | null>;
    /**
     * Get historical prices for analysis.
     * Returns prices in ascending date order.
     */
    getPrices(symbols: string[], fromDate: string, toDate: string): Promise<Map<string, HistoricalPrice[]>>;
    /**
     * Get the latest bar for a symbol.
     */
    getLatestBar(symbol: string): Promise<HistoricalPrice | null>;
    /**
     * Get a specific bar by symbol and date.
     */
    getBar(symbol: string, date: string): Promise<HistoricalPrice | null>;
}
export interface HistoricalPrice {
    barDate: string;
    openCents: number;
    highCents: number;
    lowCents: number;
    closeCents: number;
    adjCloseCents: number;
    volume: number | null;
}
/**
 * Price service with read-through cache over Finnhub.
 * Coordinates batch fetching, caching, and persistence to price_bars table.
 */
export declare class PriceService implements PriceFeed {
    private readonly pricesRepo;
    private readonly finnhub;
    private readonly cache;
    private readonly cacheMaxAgeMs;
    constructor(pricesRepo: PricesRepo);
    /**
     * Get current price for a symbol.
     * Checks cache first, then fetches from Finnhub if cache miss or stale.
     */
    getPrice(symbol: string): Promise<number | null>;
    /**
     * Batch fetch prices for multiple symbols and date range.
     * Returns historical prices from price_bars cache.
     */
    getPrices(symbols: string[], fromDate: string, toDate: string): Promise<Map<string, HistoricalPrice[]>>;
    /**
     * Persist current price to price_bars table for historical tracking.
     * Called after each successful quote fetch to build historical record.
     */
    recordPrice(symbol: string, price: number, date: string): Promise<void>;
    /**
     * Get the latest price from the price_bars cache when live fetch fails.
     */
    private getLatestCachedPrice;
    /**
     * Clear stale cache entries (older than max age).
     * Called periodically to prevent unbounded cache growth.
     */
    clearStaleCache(): void;
    /**
     * Warm cache by fetching current quotes for symbols.
     * Used at startup or before trading cycles.
     */
    warmCache(symbols: string[]): Promise<void>;
    /**
     * Get the latest bar for a symbol (used by PaperBroker for fills).
     */
    getLatestBar(symbol: string): Promise<HistoricalPrice | null>;
    /**
     * Get a specific bar by symbol and date (used by PaperBroker for fills).
     */
    getBar(symbol: string, date: string): Promise<HistoricalPrice | null>;
}
//# sourceMappingURL=priceService.d.ts.map