/** Options connector with CBOE primary and Yahoo fallback. */

import type { DataSource, DataSourceResult, FetchContext } from '../types.js';
import { YahooOptionsDataSource, type OptionsPayload, type OptionsQuery } from './yahooOptions.js';
import { createCboeHttpClient, fetchCboeChain } from './cboeOptions.js';
import { logger } from '../../lib/logger.js';

export * from './optionsCalendar.js';
export * from './yahooOptions.js';
export {
  CBOE_OPTIONS_SOURCE,
  CBOE_BASE_URL,
  parseOsiSymbol,
  type CboeOptionsResponse,
} from './cboeOptions.js';

export type OptionsProvider = 'yahoo' | 'cboe';

export type OptionsDataSource = DataSource<OptionsQuery, DataSourceResult<OptionsPayload>>;

const log = logger.child({ component: 'options-datasource' });

/**
 * Creates an options datasource.
 * Uses CBOE as primary (no auth, reliable), falls back to Yahoo if CBOE fails.
 */
export function createOptionsDataSource(_provider: OptionsProvider = 'cboe'): OptionsDataSource {
  const yahoo = new YahooOptionsDataSource();
  const cboeHttp = createCboeHttpClient();

  return {
    name: 'options-fallback',
    kind: 'options',
    provider: 'cboe+yahoo',
    isConfigured: () => true,
    healthCheck: () => yahoo.healthCheck(),

    async fetch(
      query: OptionsQuery,
      ctx?: FetchContext
    ): Promise<DataSourceResult<OptionsPayload>> {
      const symbol = query.symbol.trim().toUpperCase();
      const now = Date.now();

      // Try CBOE first (no auth required, more reliable)
      try {
        const chain = await fetchCboeChain(cboeHttp, symbol, {
          expiration: query.expiration,
          now,
          signal: ctx?.signal,
        });
        // Use Yahoo's normalization logic
        return yahoo.normalizeChain(chain, symbol, now);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.debug('cboe options failed, falling back to yahoo', {
          symbol,
          error: message,
        });
      }

      // Fallback to Yahoo
      return await yahoo.fetch(query, ctx);
    },
  };
}
