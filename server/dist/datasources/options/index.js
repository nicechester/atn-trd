/** Options connector with CBOE primary and Yahoo fallback. */
import { YahooOptionsDataSource } from './yahooOptions.js';
import { createCboeHttpClient, fetchCboeChain } from './cboeOptions.js';
import { logger } from '../../lib/logger.js';
export * from './optionsCalendar.js';
export * from './yahooOptions.js';
export { CBOE_OPTIONS_SOURCE, CBOE_BASE_URL, parseOsiSymbol, } from './cboeOptions.js';
const log = logger.child({ component: 'options-datasource' });
/**
 * Creates an options datasource.
 * Uses CBOE as primary (no auth, reliable), falls back to Yahoo if CBOE fails.
 */
export function createOptionsDataSource(_provider = 'cboe') {
    const yahoo = new YahooOptionsDataSource();
    const cboeHttp = createCboeHttpClient();
    return {
        name: 'options-fallback',
        kind: 'options',
        provider: 'cboe+yahoo',
        isConfigured: () => true,
        healthCheck: () => yahoo.healthCheck(),
        async fetch(query, ctx) {
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
            }
            catch (err) {
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
//# sourceMappingURL=index.js.map