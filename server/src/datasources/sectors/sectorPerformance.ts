/**
 * Sector performance data source.
 * 
 * Uses cached price bars from the database (populated by Finnhub backfill).
 * No external API calls - requires price bars to be pre-populated.
 */

import { BaseDataSource, type DataSourceKind } from '../types.js';
import { logger } from '../../lib/logger.js';
import type { PricesRepo, PriceBarRow } from '../../repos/pricesRepo.js';

const log = logger.child({ component: 'sector-performance' });

export const SECTORS_SOURCE = 'sectors';
export const HEALTH_CHECK_SYMBOL = 'XLK';

export interface SectorPerformance {
  sector: string;
  etfSymbol: string;
  return1d: number;
  return1w: number;
  return1m: number;
  return3m: number;
  avgPE: number | null;
  avgVolatility: number | null;
}

const SECTOR_ETF_MAP: Record<string, string> = {
  'Technology': 'XLK',
  'Financials': 'XLF',
  'Energy': 'XLE',
  'Healthcare': 'XLV',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples': 'XLP',
  'Industrials': 'XLI',
  'Materials': 'XLB',
  'Real Estate': 'XLRE',
  'Utilities': 'XLU',
  'Communication Services': 'XLC',
};

export const SECTOR_ETFS = Object.values(SECTOR_ETF_MAP);

interface HistoricalQuote {
  date: number;
  close: number;
}

export interface SectorPerformanceOptions {
  pricesRepo: PricesRepo;
}

export class SectorPerformanceDataSource extends BaseDataSource<void, SectorPerformance[]> {
  readonly name = 'Sector Performance';
  readonly kind: DataSourceKind = 'prices';
  readonly provider = 'finnhub';

  private readonly pricesRepo: PricesRepo;

  constructor(options: SectorPerformanceOptions) {
    super();
    this.pricesRepo = options.pricesRepo;
  }

  protected async probe(): Promise<string | void> {
    const bars = this.pricesRepo.listBySymbol(HEALTH_CHECK_SYMBOL, 7);
    if (bars.length === 0) {
      throw new Error(`No cached price bars for ${HEALTH_CHECK_SYMBOL}. Run price backfill first.`);
    }
    return `Found ${bars.length} cached bars for ${HEALTH_CHECK_SYMBOL}`;
  }

  async fetch(): Promise<SectorPerformance[]> {
    const results: SectorPerformance[] = [];

    for (const [sector, etfSymbol] of Object.entries(SECTOR_ETF_MAP)) {
      const bars = this.pricesRepo.listBySymbol(etfSymbol, 90);

      if (bars.length === 0) {
        log.warn('no cached price data for sector etf', { etfSymbol, sector });
        continue;
      }

      const priceData = bars.map((b: PriceBarRow) => ({
        date: new Date(b.barDate).getTime(),
        close: b.closeCents / 100,
      }));

      results.push({
        sector,
        etfSymbol,
        return1d: this.calculateReturn(priceData, 1),
        return1w: this.calculateReturn(priceData, 7),
        return1m: this.calculateReturn(priceData, 30),
        return3m: this.calculateReturn(priceData, 90),
        avgPE: null,
        avgVolatility: null,
      });
    }

    log.info('sector performance fetched', { sectorCount: results.length });
    return results;
  }

  private calculateReturn(priceData: HistoricalQuote[], days: number): number {
    if (priceData.length < 2) return 0;

    const cutoffTime = Date.now() - days * 86400 * 1000;

    // Find the price closest to (but before) the cutoff
    let startPrice = priceData[0].close;
    for (const p of priceData) {
      if (p.date <= cutoffTime) {
        startPrice = p.close;
      }
    }

    const endPrice = priceData[priceData.length - 1].close;
    const ret = ((endPrice - startPrice) / startPrice) * 100;
    return Math.round(ret * 100) / 100;
  }
}

// Backwards compatibility alias
export { SectorPerformanceDataSource as YahooSectorPerformance };
