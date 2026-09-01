/**
 * Yahoo Finance price quotes. Requires no API key, so `isConfigured()` is
 * always true; the trade-off is aggressive upstream throttling, which is why
 * every call goes through the shared token bucket + retry envelope.
 */

import { BaseDataSource, type DataSourceKind } from '../types.js';
import { HttpClient, HttpError } from '../http.js';
import { SymbolNotFoundError, UpstreamError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export const YAHOO_PRICES_SOURCE = 'yahoo-prices';
export const HEALTH_CHECK_SYMBOL = 'AAPL';

export interface PriceQuote {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  /** Epoch milliseconds of the quote as reported by the provider. */
  timestamp: number;
  exchange: string | null;
  marketState: string | null;
}

/** Subset of the yahoo-finance2 quote payload this source depends on. */
export interface YahooQuoteRaw {
  symbol?: string;
  shortName?: string;
  longName?: string;
  displayName?: string;
  regularMarketPrice?: number;
  currency?: string;
  regularMarketTime?: Date | number | string;
  fullExchangeName?: string;
  exchange?: string;
  marketState?: string;
}

export type YahooQuoteFn = (symbol: string) => Promise<YahooQuoteRaw | null | undefined>;

export interface YahooPricesOptions {
  /** Override the primary provider call (tests). */
  quoteFn?: YahooQuoteFn;
  /** Override the fallback provider call (tests). */
  chartFn?: YahooQuoteFn;
  /** Override the rate-limit / retry envelope. */
  http?: HttpClient;
  /** Disable the unauthenticated chart fallback. Default enabled. */
  chartFallback?: boolean;
}

export const YAHOO_CHART_BASE_URL = 'https://query1.finance.yahoo.com/';

/**
 * Yahoo 429s browser-impersonating user agents on the chart endpoint but serves
 * honest client identifiers, so do not "upgrade" this to a Chrome UA string.
 */
const USER_AGENT = 'atn-trd/0.1.0';

interface YahooChartResponse {
  chart?: {
    result?: Array<{ meta?: YahooQuoteRaw & { exchangeName?: string } }> | null;
    error?: { code?: string; description?: string } | null;
  };
}

const NOT_FOUND_MESSAGE = /(not found|no data found|invalid (?:symbol|crumb)|quote not found|symbol may be delisted)/i;

let cachedQuoteFn: YahooQuoteFn | null = null;

/**
 * Loaded lazily so that unit tests (and the `worker` role) never pay the cost
 * of importing yahoo-finance2 unless a quote is actually requested.
 */
const defaultQuoteFn: YahooQuoteFn = async (symbol: string) => {
  if (!cachedQuoteFn) {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
    cachedQuoteFn = async (s: string) => {
      // validateResult:false keeps us resilient to Yahoo schema drift; we
      // validate the handful of fields we actually use below.
      const result = await yf.quote(s, {}, { validateResult: false });
      return Array.isArray(result) ? result[0] : result;
    };
  }
  return cachedQuoteFn(symbol);
};

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function toEpochMs(value: Date | number | string | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') {
    // Yahoo occasionally returns seconds rather than milliseconds.
    return value > 1e12 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

export class YahooPricesDataSource extends BaseDataSource<{ symbol: string }, PriceQuote> {
  readonly name = YAHOO_PRICES_SOURCE;
  readonly kind: DataSourceKind = 'prices';
  readonly provider = 'yahoo';

  private readonly quoteFn: YahooQuoteFn;
  private readonly chartFn: YahooQuoteFn | null;
  private readonly http: HttpClient;
  private readonly log = logger.child({ component: 'datasource', source: YAHOO_PRICES_SOURCE });

  constructor(options: YahooPricesOptions = {}) {
    super();
    this.quoteFn = options.quoteFn ?? defaultQuoteFn;
    this.http =
      options.http ??
      new HttpClient({
        name: YAHOO_PRICES_SOURCE,
        baseUrl: YAHOO_CHART_BASE_URL,
        defaultHeaders: { 'user-agent': USER_AGENT, accept: 'application/json' },
        // Yahoo's public endpoints throttle hard; allow a small burst then
        // settle at ~2 requests/second.
        rateLimit: { capacity: 5, refillPerSecond: 2 },
        retry: { retries: 2, baseDelayMs: 400, maxDelayMs: 4000 },
      });
    this.chartFn =
      options.chartFn ?? (options.chartFallback === false ? null : (s) => this.chartQuote(s));
  }

  /** Basic quotes are free and unauthenticated. */
  isConfigured(): boolean {
    return true;
  }

  async fetch(request: { symbol: string }): Promise<PriceQuote> {
    return this.quote(request.symbol);
  }

  async quote(symbol: string): Promise<PriceQuote> {
    if (typeof symbol !== 'string' || symbol.trim().length === 0) {
      throw new ValidationError('Symbol is required');
    }
    const normalized = normalizeSymbol(symbol);

    try {
      // The SDK does its own I/O, so wrap it in the shared throttle explicitly.
      return await this.tryProvider(
        (s) => this.http.run(() => this.quoteFn(s)),
        normalized,
        'quote'
      );
    } catch (err) {
      // A confirmed "no such instrument" is definitive - don't retry elsewhere.
      if (err instanceof SymbolNotFoundError || !this.chartFn) throw err;
      // Yahoo's authenticated quote API is frequently throttled or geo-blocked;
      // the public chart endpoint needs no crumb and carries the same fields.
      this.log.warn('falling back to chart endpoint', {
        symbol: normalized,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.tryProvider(this.chartFn, normalized, 'chart');
    }
  }

  /** Fetch a quote from Yahoo's unauthenticated chart endpoint. */
  private async chartQuote(symbol: string): Promise<YahooQuoteRaw | undefined> {
    const path = `v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    let body: YahooChartResponse;
    try {
      body = await this.http.json<YahooChartResponse>(path);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        throw new SymbolNotFoundError(symbol);
      }
      throw err;
    }
    if (body.chart?.error) {
      throw new SymbolNotFoundError(symbol);
    }
    return body.chart?.result?.[0]?.meta;
  }

  /** Runs one provider and normalizes both its payload and its failures. */
  private async tryProvider(
    fn: YahooQuoteFn,
    normalized: string,
    label: string
  ): Promise<PriceQuote> {
    let raw: YahooQuoteRaw | null | undefined;
    try {
      raw = await fn(normalized);
    } catch (err) {
      if (err instanceof SymbolNotFoundError || err instanceof ValidationError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (NOT_FOUND_MESSAGE.test(message)) {
        throw new SymbolNotFoundError(normalized);
      }
      this.log.warn('quote request failed', { symbol: normalized, via: label, error: message });
      throw new UpstreamError(
        `Could not reach Yahoo Finance to price "${normalized}"`,
        YAHOO_PRICES_SOURCE
      );
    }

    if (!raw || typeof raw.regularMarketPrice !== 'number' || !Number.isFinite(raw.regularMarketPrice)) {
      throw new SymbolNotFoundError(normalized);
    }

    return {
      symbol: (raw.symbol ?? normalized).toUpperCase(),
      name: raw.shortName ?? raw.longName ?? raw.displayName ?? normalized,
      price: raw.regularMarketPrice,
      currency: (raw.currency ?? 'USD').toUpperCase(),
      timestamp: toEpochMs(raw.regularMarketTime),
      exchange: raw.fullExchangeName ?? raw.exchange ?? null,
      marketState: raw.marketState ?? null,
    };
  }

  protected async probe(): Promise<void> {
    await this.quote(HEALTH_CHECK_SYMBOL);
  }
}

export const yahooPrices = new YahooPricesDataSource();
