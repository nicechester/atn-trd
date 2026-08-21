import { BaseDataSource, type DataSourceKind } from '../types.js';
import { HttpClient } from '../http.js';
import { logger } from '../../lib/logger.js';

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

interface YahooHistoricalQuote {
  date: number;
  close: number;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: (number | null)[] }>;
      };
    }>;
  };
}

export class YahooSectorPerformance extends BaseDataSource<void, SectorPerformance[]> {
  readonly name = 'Sector Performance';
  readonly kind: DataSourceKind = 'prices';
  readonly provider = 'yahoo';

  private http: HttpClient;

  constructor(http?: HttpClient) {
    super();
    this.http = http || new HttpClient();
  }

  protected async probe(): Promise<string | void> {
    await this.fetchHistoricalData(HEALTH_CHECK_SYMBOL, 90);
    return 'ok';
  }

  async fetch(): Promise<SectorPerformance[]> {
    const results: SectorPerformance[] = [];

    for (const [sector, etfSymbol] of Object.entries(SECTOR_ETF_MAP)) {
      try {
        const priceData = await this.fetchHistoricalData(etfSymbol, 90);

        if (priceData.length === 0) {
          log.warn('no price data for sector etf', { etfSymbol, sector });
          continue;
        }

        const return1d = this.calculateReturn(priceData, 1);
        const return1w = this.calculateReturn(priceData, 7);
        const return1m = this.calculateReturn(priceData, 30);
        const return3m = this.calculateReturn(priceData, 90);

        results.push({
          sector,
          etfSymbol,
          return1d,
          return1w,
          return1m,
          return3m,
          avgPE: null,
          avgVolatility: null,
        });
      } catch (err) {
        log.warn('failed to fetch sector performance', {
          etfSymbol,
          sector,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.info('sector performance fetched', { sectorCount: results.length });
    return results;
  }

  private async fetchHistoricalData(symbol: string, days: number): Promise<YahooHistoricalQuote[]> {
    const endTime = Math.floor(Date.now() / 1000);
    const startTime = endTime - (days * 86400);

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${symbol}/historical?interval=1d&period1=${startTime}&period2=${endTime}`;

    try {
      const response = await this.http.get<YahooChartResponse>(url, {
        headers: {
          'User-Agent': 'atn-trd/0.1.0',
        },
      });

      const timestamps = response.chart?.result?.[0]?.timestamp ?? [];
      const quotes = response.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];

      const results: YahooHistoricalQuote[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        if (quotes[i] !== null && quotes[i] !== undefined) {
          results.push({
            date: timestamps[i] * 1000,
            close: quotes[i],
          });
        }
      }

      return results.sort((a, b) => a.date - b.date);
    } catch (err) {
      log.debug('historical data fetch failed', {
        symbol,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private calculateReturn(priceData: YahooHistoricalQuote[], days: number): number {
    if (priceData.length < 2) return 0;

    const now = Date.now();
    const cutoffTime = now - (days * 86400 * 1000);

    let startPrice: number | null = null;
    for (let i = 0; i < priceData.length; i++) {
      if (priceData[i].date <= cutoffTime) {
        startPrice = priceData[i].close;
      }
    }

    if (startPrice === null) {
      startPrice = priceData[0].close;
    }

    const endPrice = priceData[priceData.length - 1].close;
    const ret = ((endPrice - startPrice) / startPrice) * 100;
    return Math.round(ret * 100) / 100;
  }
}
