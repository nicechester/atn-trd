/** Fundamentals connector with Finnhub primary and Yahoo fallback. */
import { YahooFundamentalsDataSource, } from './yahooFundamentals.js';
import { FinnhubFundamentalsDataSource } from './finnhubFundamentals.js';
import { logger } from '../../lib/logger.js';
export * from './yahooFundamentals.js';
export * from './finnhubFundamentals.js';
const log = logger.child({ component: 'fundamentals-datasource' });
/**
 * Creates a fundamentals datasource.
 * Uses Finnhub as primary (reliable API), falls back to Yahoo if Finnhub fails.
 */
export function createFundamentalsDataSource(_provider = 'finnhub') {
    const finnhub = new FinnhubFundamentalsDataSource();
    const yahoo = new YahooFundamentalsDataSource();
    return {
        name: 'fundamentals-fallback',
        kind: 'fundamentals',
        provider: 'finnhub+yahoo',
        isConfigured: () => finnhub.isConfigured() || yahoo.isConfigured(),
        healthCheck: () => finnhub.isConfigured() ? finnhub.healthCheck() : yahoo.healthCheck(),
        async fetch(query, ctx) {
            // Use Finnhub as primary if configured
            if (finnhub.isConfigured()) {
                try {
                    return await finnhub.fetch(query, ctx);
                }
                catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    log.debug('finnhub fundamentals failed, falling back to yahoo', {
                        symbol: query.symbol,
                        error: message,
                    });
                }
            }
            // Fallback to Yahoo
            return await yahoo.fetch(query, ctx);
        },
    };
}
//# sourceMappingURL=index.js.map