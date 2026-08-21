/** Fundamentals connector with Yahoo primary and Finnhub fallback. */

import type { DataSource, DataSourceResult, FetchContext } from '../types.js';
import {
  YahooFundamentalsDataSource,
  type FundamentalsPayload,
  type FundamentalsQuery,
} from './yahooFundamentals.js';
import { FinnhubFundamentalsDataSource } from './finnhubFundamentals.js';
import { logger } from '../../lib/logger.js';

export * from './yahooFundamentals.js';
export * from './finnhubFundamentals.js';

export type FundamentalsProvider = 'yahoo' | 'finnhub';

export type FundamentalsDataSource = DataSource<
  FundamentalsQuery,
  DataSourceResult<FundamentalsPayload>
>;

const log = logger.child({ component: 'fundamentals-datasource' });

/**
 * Creates a fundamentals datasource with automatic fallback.
 * Tries Yahoo first (richer data), falls back to Finnhub on rate limit.
 */
export function createFundamentalsDataSource(
  _provider: FundamentalsProvider = 'yahoo'
): FundamentalsDataSource {
  const yahoo = new YahooFundamentalsDataSource();
  const finnhub = new FinnhubFundamentalsDataSource();

  return {
    name: 'fundamentals-fallback',
    kind: 'fundamentals',
    provider: 'yahoo+finnhub',
    isConfigured: () => yahoo.isConfigured() || finnhub.isConfigured(),
    healthCheck: () => yahoo.healthCheck(),

    async fetch(
      query: FundamentalsQuery,
      ctx?: FetchContext
    ): Promise<DataSourceResult<FundamentalsPayload>> {
      try {
        return await yahoo.fetch(query, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Fallback on rate limit or upstream errors
        if (
          message.includes('Too Many Requests') ||
          message.includes('throttling') ||
          message.includes('Could not reach')
        ) {
          log.debug('yahoo fundamentals failed, falling back to finnhub', {
            symbol: query.symbol,
            error: message,
          });
          if (finnhub.isConfigured()) {
            return await finnhub.fetch(query, ctx);
          }
        }
        throw err;
      }
    },
  };
}
