/**
 * Yahoo options connector.
 *
 * `options(symbol)` returns the full chain for the nearest expiry plus every
 * listed expiration date; needs no API key. Everything downstream of the raw
 * chain (put/call ratios, max pain, IV skew, OpEx calendar) is derived locally
 * by `optionsCalendar.ts` — no extra API calls.
 */

import {
  BaseDataSource,
  type DataSourceKind,
  type DataSourceResult,
  type FetchContext,
} from '../types.js';
import { HttpClient, withTimeout } from '../http.js';
import { count, epochMs, num, type MaybeDate, type MaybeNumber } from '../coerce.js';
import { SymbolNotFoundError, UpstreamError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  buildExpiryCalendar,
  computeOptionsMetrics,
  withVolumeFlags,
  type ExpiryCalendar,
  type OptionContract,
  type OptionsMetrics,
} from './optionsCalendar.js';

export const YAHOO_OPTIONS_SOURCE = 'yahoo-options';
export const OPTIONS_HEALTH_CHECK_SYMBOL = 'AAPL';

const DEFAULT_TIMEOUT_MS = 15_000;

const NOT_FOUND_MESSAGE =
  /(not found|no data found|invalid (?:symbol|crumb)|quote not found|symbol may be delisted|no options)/i;

export interface OptionsQuery {
  symbol: string;
  /** Specific expiration (epoch ms). Defaults to the nearest listed expiry. */
  expiration?: number;
}

export interface OptionsPayload {
  symbol: string;
  underlyingPrice: number | null;
  /** Expiration this chain belongs to, epoch ms. */
  expiration: number | null;
  /** Every expiry the provider lists for the symbol, epoch ms. */
  expirationDates: number[];
  calls: OptionContract[];
  puts: OptionContract[];
  metrics: OptionsMetrics;
  calendar: ExpiryCalendar;
  /** Which upstream actually served the chain. */
  servedBy: OptionsServedBy;
}

export type OptionsServedBy = 'yahoo' | 'cboe';

export interface YahooOptionContractRaw {
  contractSymbol?: string;
  strike?: MaybeNumber;
  lastPrice?: MaybeNumber;
  bid?: MaybeNumber;
  ask?: MaybeNumber;
  volume?: MaybeNumber;
  openInterest?: MaybeNumber;
  impliedVolatility?: MaybeNumber;
  inTheMoney?: boolean;
  expiration?: MaybeDate;
}

export interface YahooOptionsRaw {
  underlyingSymbol?: string;
  expirationDates?: MaybeDate[];
  strikes?: number[];
  quote?: { regularMarketPrice?: MaybeNumber };
  options?: Array<{
    expirationDate?: MaybeDate;
    calls?: YahooOptionContractRaw[];
    puts?: YahooOptionContractRaw[];
  }>;
}

/** Intermediate chain shape both the Yahoo and CBOE paths normalize into. */
export type RawOptionChain = YahooOptionsRaw;

export type YahooOptionsFn = (
  symbol: string,
  query: { date?: Date }
) => Promise<YahooOptionsRaw | null | undefined>;

export type CboeOptionsFn = (
  symbol: string,
  query: { expiration?: number; signal?: AbortSignal }
) => Promise<RawOptionChain>;

export interface YahooOptionsOptions {
  /** Override the provider call (tests). */
  optionsFn?: YahooOptionsFn;
  /** Override the CBOE fallback call (tests). */
  cboeFn?: CboeOptionsFn;
  /** Disable the key-less CBOE fallback. Default enabled. */
  cboeFallback?: boolean;
  http?: HttpClient;
  timeoutMs?: number;
  now?: () => number;
}

let cachedFn: YahooOptionsFn | null = null;

/** Loaded lazily so unit tests never import yahoo-finance2. */
const defaultOptionsFn: YahooOptionsFn = async (symbol, query) => {
  if (!cachedFn) {
    const { default: YahooFinance } = await import('yahoo-finance2');
    const yf = new YahooFinance({ suppressNotices: ['yahooSurvey', 'ripHistorical'] });
    cachedFn = async (s, q) =>
      // validateResult:false keeps us resilient to Yahoo schema drift.
      (await yf.options(
        s,
        q.date ? { date: q.date } : {},
        { validateResult: false }
      )) as YahooOptionsRaw;
  }
  return cachedFn(symbol, query);
};

export class YahooOptionsDataSource extends BaseDataSource<
  OptionsQuery,
  DataSourceResult<OptionsPayload>
> {
  readonly name = YAHOO_OPTIONS_SOURCE;
  readonly kind: DataSourceKind = 'options';
  readonly provider = 'yahoo';

  private readonly optionsFn: YahooOptionsFn;
  private readonly cboeFn: CboeOptionsFn | null;
  private readonly http: HttpClient;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private cboeHttp: HttpClient | null = null;
  private readonly log = logger.child({ component: 'datasource', source: YAHOO_OPTIONS_SOURCE });

  constructor(options: YahooOptionsOptions = {}) {
    super();
    this.optionsFn = options.optionsFn ?? defaultOptionsFn;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.http =
      options.http ??
      new HttpClient({
        name: YAHOO_OPTIONS_SOURCE,
        rateLimit: { capacity: 5, refillPerSecond: 2 },
        retry: { retries: 0, baseDelayMs: 400, maxDelayMs: 4000 }, // fail fast, fallback to CBOE
      });
    this.cboeFn =
      options.cboeFn ??
      (options.cboeFallback === false ? null : (symbol, query) => this.cboeChain(symbol, query));
  }

  /** Public Yahoo data: no credentials required. */
  isConfigured(): boolean {
    return true;
  }

  async fetch(query: OptionsQuery, ctx?: FetchContext): Promise<DataSourceResult<OptionsPayload>> {
    const symbol = this.normalize(query?.symbol);
    const expiration = this.normalizeExpiration(query?.expiration);

    let raw: RawOptionChain;
    let servedBy: OptionsServedBy = 'yahoo';
    try {
      raw = await this.load(symbol, expiration, ctx);
    } catch (err) {
      // A confirmed "no such chain" is definitive - don't retry elsewhere.
      if (err instanceof SymbolNotFoundError || !this.cboeFn) throw err;
      // Yahoo's option endpoint sits behind the cookie/crumb flow and is
      // routinely throttled; CBOE publishes the same chain without a key.
      this.log.warn('falling back to CBOE delayed quotes', {
        symbol,
        error: err instanceof Error ? err.message : String(err),
      });
      raw = await this.cboeFn(symbol, {
        ...(expiration ? { expiration: expiration.getTime() } : {}),
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      });
      servedBy = 'cboe';
    }

    return {
      data: this.toPayload(symbol, raw, servedBy),
      provider: servedBy,
      fetchedAt: this.now(),
      citations: [
        servedBy === 'cboe'
          ? {
              title: `CBOE delayed quotes — ${symbol} option chain`,
              url: `https://www.cboe.com/delayed_quotes/${encodeURIComponent(symbol.toLowerCase())}/quote_table`,
            }
          : {
              title: `Yahoo Finance — ${symbol} option chain`,
              url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/options`,
            },
      ],
      raw,
    };
  }

  /** Lazily built so the CBOE client only exists once the fallback is used. */
  private async cboeChain(
    symbol: string,
    query: { expiration?: number; signal?: AbortSignal }
  ): Promise<RawOptionChain> {
    const { createCboeHttpClient, fetchCboeChain } = await import('./cboeOptions.js');
    if (!this.cboeHttp) this.cboeHttp = createCboeHttpClient();
    return fetchCboeChain(this.cboeHttp, symbol, { ...query, now: this.now() });
  }

  private normalize(symbol: unknown): string {
    if (typeof symbol !== 'string' || symbol.trim().length === 0) {
      throw new ValidationError('Symbol is required');
    }
    return symbol.trim().toUpperCase();
  }

  private normalizeExpiration(expiration: unknown): Date | undefined {
    if (expiration === undefined || expiration === null) return undefined;
    if (typeof expiration !== 'number' || !Number.isFinite(expiration)) {
      throw new ValidationError('Field "expiration" must be an epoch-millisecond number');
    }
    return new Date(expiration);
  }

  private async load(
    symbol: string,
    expiration: Date | undefined,
    ctx?: FetchContext
  ): Promise<YahooOptionsRaw> {
    let raw: YahooOptionsRaw | null | undefined;
    try {
      raw = await this.http.run(() =>
        withTimeout(
          () => this.optionsFn(symbol, expiration ? { date: expiration } : {}),
          this.timeoutMs,
          `${YAHOO_OPTIONS_SOURCE} options(${symbol})`,
          ctx?.signal
        )
      );
    } catch (err) {
      if (err instanceof SymbolNotFoundError || err instanceof ValidationError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (NOT_FOUND_MESSAGE.test(message)) throw new SymbolNotFoundError(symbol);
      this.log.warn('option chain request failed', { symbol, error: message });
      throw new UpstreamError(
        `Could not reach Yahoo Finance for "${symbol}" options: ${message}`,
        YAHOO_OPTIONS_SOURCE
      );
    }

    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.options)) {
      throw new SymbolNotFoundError(symbol);
    }
    return raw;
  }

  private toPayload(
    symbol: string,
    raw: RawOptionChain,
    servedBy: OptionsServedBy
  ): OptionsPayload {
    const chain = raw.options?.[0];
    const expiration = epochMs(chain?.expirationDate);
    const calls = this.toContracts(chain?.calls, expiration);
    const puts = this.toContracts(chain?.puts, expiration);
    const underlyingPrice = num(raw.quote?.regularMarketPrice);

    const expirationDates = (Array.isArray(raw.expirationDates) ? raw.expirationDates : [])
      .map((d) => epochMs(d))
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b);

    return {
      symbol: (raw.underlyingSymbol ?? symbol).toUpperCase(),
      underlyingPrice,
      expiration,
      expirationDates,
      calls,
      puts,
      metrics: computeOptionsMetrics(calls, puts, underlyingPrice),
      calendar: buildExpiryCalendar(this.now(), expirationDates),
      servedBy,
    };
  }

  private toContracts(
    contracts: YahooOptionContractRaw[] | undefined,
    fallbackExpiration: number | null
  ): OptionContract[] {
    if (!Array.isArray(contracts)) return [];
    return contracts
      .filter((c) => num(c.strike) !== null)
      .map((c) =>
        withVolumeFlags({
          contractSymbol: c.contractSymbol ?? '',
          strike: num(c.strike) as number,
          lastPrice: num(c.lastPrice),
          bid: num(c.bid),
          ask: num(c.ask),
          volume: count(c.volume),
          openInterest: count(c.openInterest),
          impliedVolatility: num(c.impliedVolatility),
          inTheMoney: typeof c.inTheMoney === 'boolean' ? c.inTheMoney : null,
          expiration: epochMs(c.expiration) ?? fallbackExpiration,
        })
      );
  }

  protected async probe(): Promise<string> {
    const { data } = await this.fetch({ symbol: OPTIONS_HEALTH_CHECK_SYMBOL });
    const pcr = data.metrics.putCallOpenInterestRatio;
    const days = data.calendar.daysToNextExpiry;
    return (
      `Fetched ${data.symbol} chain via ${data.servedBy}: ` +
      `${data.calls.length} calls / ${data.puts.length} puts, ` +
      `P/C OI ${pcr === null ? 'n/a' : pcr.toFixed(2)}, ` +
      `next expiry ${days === null ? 'unknown' : `in ${days}d`}`
    );
  }

  /** Public method to normalize a raw chain (used by index fallback). */
  normalizeChain(
    raw: RawOptionChain,
    symbol: string,
    fetchedAt: number
  ): DataSourceResult<OptionsPayload> {
    return {
      data: this.toPayload(symbol, raw, 'cboe'),
      provider: 'cboe',
      fetchedAt,
      citations: [
        {
          title: `CBOE delayed quotes — ${symbol} option chain`,
          url: `https://www.cboe.com/delayed_quotes/${encodeURIComponent(symbol.toLowerCase())}/quote_table`,
        },
      ],
      raw,
    };
  }
}
