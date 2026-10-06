/**
 * Finnhub price quotes via GET /quote.
 * Free tier: 60 req/min. Requires FINNHUB_API_KEY (shared with finnhubNews).
 */
import { BaseDataSource } from '../types.js';
import { HttpClient } from '../http.js';
import { apiKeyResolver } from '../apiKeys.js';
import { DataSourceNotConfiguredError, SymbolNotFoundError, UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
export const FINNHUB_PRICES_SOURCE = 'finnhub-prices';
export const FINNHUB_API_KEY_SECRET = 'FINNHUB_API_KEY';
export const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1/';
export class FinnhubPricesDataSource extends BaseDataSource {
    name = FINNHUB_PRICES_SOURCE;
    kind = 'prices';
    provider = 'finnhub';
    http;
    resolveKey;
    log = logger.child({ component: 'datasource', source: FINNHUB_PRICES_SOURCE });
    constructor(options = {}) {
        super();
        this.resolveKey = options.resolveKey ?? apiKeyResolver(FINNHUB_API_KEY_SECRET);
        this.http =
            options.http ??
                new HttpClient({
                    name: FINNHUB_PRICES_SOURCE,
                    baseUrl: FINNHUB_BASE_URL,
                    defaultHeaders: { accept: 'application/json' },
                    // Finnhub free tier: 60 req/min → 1/s sustained; allow small burst.
                    rateLimit: { capacity: 10, refillPerSecond: 1 },
                    retry: { retries: 2, baseDelayMs: 300, maxDelayMs: 3000 },
                });
    }
    isConfigured() {
        return !!this.resolveKey();
    }
    notConfiguredReason() {
        return `Missing ${FINNHUB_API_KEY_SECRET}`;
    }
    async fetch(request) {
        const key = this.resolveKey();
        if (!key)
            throw new DataSourceNotConfiguredError(this.name, this.notConfiguredReason());
        const symbol = request.symbol.trim().toUpperCase();
        const path = `quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
        let raw;
        try {
            raw = await this.http.json(path);
        }
        catch (err) {
            this.log.warn('quote request failed', {
                symbol,
                error: err instanceof Error ? err.message : String(err),
            });
            throw new UpstreamError(`Could not reach Finnhub to price "${symbol}"`, FINNHUB_PRICES_SOURCE);
        }
        // Finnhub returns c=0 and pc=0 for unknown symbols.
        if (typeof raw.c !== 'number' || raw.c === 0) {
            throw new SymbolNotFoundError(symbol);
        }
        return {
            symbol,
            name: symbol,
            price: raw.c,
            currency: 'USD',
            timestamp: typeof raw.t === 'number' ? raw.t * 1000 : Date.now(),
            exchange: null,
            marketState: null,
        };
    }
    async probe() {
        await this.fetch({ symbol: 'AAPL' });
    }
}
//# sourceMappingURL=finnhubPrices.js.map