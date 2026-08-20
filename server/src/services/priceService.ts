import { PricesRepo } from '../repos/pricesRepo.js';
import { YahooPricesDataSource, normalizeSymbol } from '../datasources/prices/yahooPrices.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'price-service' });

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
   * Get the latest bar for a symbol (used by PaperBroker for fills).
   */
  getLatestBar(symbol: string): Promise<HistoricalPrice | null>;

  /**
   * Get a specific bar by symbol and date (used by PaperBroker for fills).
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

interface CacheEntry {
  symbol: string;
  priceCents: number;
  adjCloseCents: number;
  timestamp: number;
}

/**
 * Price service with read-through cache over yahooPrices.
 * Coordinates batch fetching, caching, and persistence to price_bars table.
 */
export class PriceService implements PriceFeed {
  private readonly pricesRepo: PricesRepo;
  private readonly yahoo: YahooPricesDataSource;
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly cacheMaxAgeMs = 1000 * 60 * 60; // 1 hour

  constructor(pricesRepo: PricesRepo, yahoo?: YahooPricesDataSource) {
    this.pricesRepo = pricesRepo;
    this.yahoo = yahoo ?? new YahooPricesDataSource();
  }

  /**
   * Get current price for a symbol.
   * Checks cache first, then fetches from Yahoo if cache miss or stale.
   */
  async getPrice(symbol: string): Promise<number | null> {
    const normalized = normalizeSymbol(symbol);
    const cached = this.cache.get(normalized);

    // Return cached if still fresh (within 1 hour)
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAgeMs) {
      return cached.priceCents / 100;
    }

    // Fetch from Yahoo and cache
    try {
      const quote = await this.yahoo.fetch({ symbol: normalized });
      if (!quote) {
        log.debug('price not found', { symbol: normalized });
        return this.getLatestCachedPrice(normalized);
      }

      const priceCents = Math.round(quote.price * 100);
      this.cache.set(normalized, {
        symbol: normalized,
        priceCents,
        adjCloseCents: priceCents, // TODO: adjust for splits/dividends
        timestamp: Date.now(),
      });

      return priceCents / 100;
    } catch (err) {
      log.debug('price fetch failed', { symbol: normalized, error: err instanceof Error ? err.message : String(err) });
      return this.getLatestCachedPrice(normalized);
    }
  }

  /**
   * Batch fetch prices for multiple symbols and date range.
   * Returns historical prices from price_bars cache.
   */
  async getPrices(
    symbols: string[],
    fromDate: string,
    toDate: string
  ): Promise<Map<string, HistoricalPrice[]>> {
    const result = new Map<string, HistoricalPrice[]>();

    for (const symbol of symbols) {
      const normalized = normalizeSymbol(symbol);
      const bars = this.pricesRepo.listByDateRange(normalized, fromDate, toDate);

      result.set(normalized, bars.map((bar) => ({
        barDate: bar.barDate,
        openCents: bar.openCents,
        highCents: bar.highCents,
        lowCents: bar.lowCents,
        closeCents: bar.closeCents,
        adjCloseCents: bar.adjCloseCents,
        volume: bar.volume,
      })));
    }

    return result;
  }

  /**
   * Persist current price to price_bars table for historical tracking.
   * Called after each successful quote fetch to build historical record.
   */
  async recordPrice(symbol: string, price: number, date: string): Promise<void> {
    const normalized = normalizeSymbol(symbol);
    const priceCents = Math.round(price * 100);

    this.pricesRepo.upsert({
      symbol: normalized,
      barDate: date,
      openCents: priceCents,
      highCents: priceCents,
      lowCents: priceCents,
      closeCents: priceCents,
      adjCloseCents: priceCents, // TODO: adjust for splits/dividends
      volume: null,
      provider: 'yahoo',
      fetchedAt: Date.now(),
    });

    log.debug('price recorded', { symbol: normalized, date, priceCents });
  }

  /**
   * Get the latest price from the price_bars cache when live fetch fails.
   */
  private getLatestCachedPrice(symbol: string): number | null {
    const bar = this.pricesRepo.getLatest(symbol);
    return bar ? bar.adjCloseCents / 100 : null;
  }

  /**
   * Clear stale cache entries (older than max age).
   * Called periodically to prevent unbounded cache growth.
   */
  clearStaleCache(): void {
    const now = Date.now();
    let cleared = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.cacheMaxAgeMs) {
        this.cache.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      log.debug('cleared stale cache entries', { count: cleared });
    }
  }

  /**
   * Warm cache by fetching current quotes for symbols.
   * Used at startup or before trading cycles.
   */
  async warmCache(symbols: string[]): Promise<void> {
    log.debug('warming price cache', { count: symbols.length });

    const normalized = symbols.map(normalizeSymbol);
    const results = await Promise.allSettled(normalized.map((s) => this.getPrice(s)));

    const successful = results.filter((r) => r.status === 'fulfilled').length;
    log.debug('price cache warmed', { count: successful, total: results.length });
  }

  /**
   * Get the latest bar for a symbol (used by PaperBroker for fills).
   */
  async getLatestBar(symbol: string): Promise<HistoricalPrice | null> {
    const normalized = normalizeSymbol(symbol);
    const bar = this.pricesRepo.getLatest(normalized);

    if (!bar) {
      log.debug('latest bar not found', { symbol: normalized });
      return null;
    }

    return {
      barDate: bar.barDate,
      openCents: bar.openCents,
      highCents: bar.highCents,
      lowCents: bar.lowCents,
      closeCents: bar.closeCents,
      adjCloseCents: bar.adjCloseCents,
      volume: bar.volume,
    };
  }

  /**
   * Get a specific bar by symbol and date (used by PaperBroker for fills).
   */
  async getBar(symbol: string, date: string): Promise<HistoricalPrice | null> {
    const normalized = normalizeSymbol(symbol);
    const bar = this.pricesRepo.get(normalized, date);

    if (!bar) {
      log.debug('bar not found', { symbol: normalized, date });
      return null;
    }

    return {
      barDate: bar.barDate,
      openCents: bar.openCents,
      highCents: bar.highCents,
      lowCents: bar.lowCents,
      closeCents: bar.closeCents,
      adjCloseCents: bar.adjCloseCents,
      volume: bar.volume,
    };
  }
}
