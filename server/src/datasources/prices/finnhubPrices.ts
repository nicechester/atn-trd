/**
 * Finnhub price quotes via GET /quote.
 * Free tier: 60 req/min. Requires FINNHUB_API_KEY (shared with finnhubNews).
 */

import { BaseDataSource, type DataSourceKind } from '../types.js';
import { HttpClient } from '../http.js';
import { apiKeyResolver, type ApiKeyResolver } from '../apiKeys.js';
import { DataSourceNotConfiguredError, SymbolNotFoundError, UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { PriceQuote } from './yahooPrices.js';

export { type PriceQuote } from './yahooPrices.js';

export const FINNHUB_PRICES_SOURCE = 'finnhub-prices';
export const FINNHUB_API_KEY_SECRET = 'FINNHUB_API_KEY';
export const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1/';

interface FinnhubQuoteRaw {
  c?: number;  // current price
  h?: number;  // high of day
  l?: number;  // low of day
  o?: number;  // open
  pc?: number; // previous close
  t?: number;  // timestamp (unix seconds)
}

export interface FinnhubPricesOptions {
  http?: HttpClient;
  resolveKey?: ApiKeyResolver;
}

export class FinnhubPricesDataSource extends BaseDataSource<{ symbol: string }, PriceQuote> {
  readonly name = FINNHUB_PRICES_SOURCE;
  readonly kind: DataSourceKind = 'prices';
  readonly provider = 'finnhub';

  private readonly http: HttpClient;
  private readonly resolveKey: ApiKeyResolver;
  private readonly log = logger.child({ component: 'datasource', source: FINNHUB_PRICES_SOURCE });

  constructor(options: FinnhubPricesOptions = {}) {
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

  isConfigured(): boolean {
    return !!this.resolveKey();
  }

  notConfiguredReason(): string {
    return `Missing ${FINNHUB_API_KEY_SECRET}`;
  }

  async fetch(request: { symbol: string }): Promise<PriceQuote> {
    const key = this.resolveKey();
    if (!key) throw new DataSourceNotConfiguredError(this.name, this.notConfiguredReason());

    const symbol = request.symbol.trim().toUpperCase();
    const path = `quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;

    let raw: FinnhubQuoteRaw;
    try {
      raw = await this.http.json<FinnhubQuoteRaw>(path);
    } catch (err) {
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

  protected async probe(): Promise<void> {
    await this.fetch({ symbol: 'AAPL' });
  }
}
