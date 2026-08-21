/**
 * Yahoo fundamentals connector.
 *
 * `quoteSummary(symbol, { modules: [...] })` in one call gives valuation,
 * margins, growth, balance-sheet ratios and — importantly for the risk
 * engine's earnings-blackout rule — `calendarEvents.earnings.earningsDate`.
 *
 * Needs no API key. The SDK does its own I/O, so calls are wrapped in the
 * shared token bucket + retry envelope and an explicit wall-clock timeout.
 */

import {
  BaseDataSource,
  type DataSourceKind,
  type DataSourceResult,
  type FetchContext,
} from '../types.js';
import { HttpClient, withTimeout } from '../http.js';
import { epochMs, num, type MaybeDate, type MaybeNumber } from '../coerce.js';
import { SymbolNotFoundError, UpstreamError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export const YAHOO_FUNDAMENTALS_SOURCE = 'yahoo-fundamentals';
export const FUNDAMENTALS_HEALTH_CHECK_SYMBOL = 'AAPL';

export const QUOTE_SUMMARY_MODULES = [
  'price',
  'summaryDetail',
  'defaultKeyStatistics',
  'financialData',
  'earnings',
  'calendarEvents',
] as const;

const DEFAULT_TIMEOUT_MS = 15_000;

const NOT_FOUND_MESSAGE =
  /(not found|no fundamentals data|no data found|invalid (?:symbol|crumb)|quote not found|symbol may be delisted)/i;

/**
 * Yahoo answers the cookie/crumb bootstrap with a plain-text "Too Many
 * Requests" body, which surfaces from the SDK as a JSON parse error. Recognise
 * it so the Settings page shows a cause rather than a parser message.
 */
const THROTTLED_MESSAGE = /(too many requests|rate limit|status code 429)/i;

/* -------------------------------------------------------------------------- */
/* Normalized payload                                                          */
/* -------------------------------------------------------------------------- */

export interface EarningsQuarter {
  /** Yahoo's period label, e.g. "2Q2026". */
  period: string;
  actual: number | null;
  estimate: number | null;
}

export interface FundamentalsEarnings {
  /** Next scheduled report, epoch ms. Null when Yahoo has no date yet. */
  nextEarningsDate: number | null;
  /** Every date Yahoo lists (a range when unconfirmed), epoch ms. */
  earningsDates: number[];
  estimateAverage: number | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  exDividendDate: number | null;
  dividendDate: number | null;
  recentQuarters: EarningsQuarter[];
}

export interface FundamentalsPayload {
  symbol: string;
  name: string | null;
  currency: string | null;
  price: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  beta: number | null;
  dividendYield: number | null;
  profitMargins: number | null;
  grossMargins: number | null;
  operatingMargins: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  totalRevenue: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  freeCashflow: number | null;
  targetMeanPrice: number | null;
  recommendationKey: string | null;
  earnings: FundamentalsEarnings;
}

export interface FundamentalsQuery {
  symbol: string;
}

/* -------------------------------------------------------------------------- */
/* Provider payload (subset we depend on)                                      */
/* -------------------------------------------------------------------------- */

export interface QuoteSummaryRaw {
  price?: {
    longName?: string;
    shortName?: string;
    currency?: string;
    regularMarketPrice?: MaybeNumber;
  };
  summaryDetail?: {
    trailingPE?: MaybeNumber;
    forwardPE?: MaybeNumber;
    marketCap?: MaybeNumber;
    beta?: MaybeNumber;
    dividendYield?: MaybeNumber;
  };
  defaultKeyStatistics?: {
    enterpriseValue?: MaybeNumber;
    pegRatio?: MaybeNumber;
    priceToBook?: MaybeNumber;
    trailingEps?: MaybeNumber;
    forwardEps?: MaybeNumber;
    profitMargins?: MaybeNumber;
    beta?: MaybeNumber;
  };
  financialData?: {
    currentPrice?: MaybeNumber;
    targetMeanPrice?: MaybeNumber;
    recommendationKey?: string;
    returnOnEquity?: MaybeNumber;
    returnOnAssets?: MaybeNumber;
    debtToEquity?: MaybeNumber;
    revenueGrowth?: MaybeNumber;
    earningsGrowth?: MaybeNumber;
    grossMargins?: MaybeNumber;
    operatingMargins?: MaybeNumber;
    profitMargins?: MaybeNumber;
    currentRatio?: MaybeNumber;
    quickRatio?: MaybeNumber;
    totalRevenue?: MaybeNumber;
    totalCash?: MaybeNumber;
    totalDebt?: MaybeNumber;
    freeCashflow?: MaybeNumber;
    financialCurrency?: string;
  };
  earnings?: {
    earningsChart?: {
      quarterly?: Array<{ date?: string | number; actual?: MaybeNumber; estimate?: MaybeNumber }>;
    };
  };
  calendarEvents?: {
    earnings?: {
      earningsDate?: MaybeDate[];
      earningsAverage?: MaybeNumber;
      earningsLow?: MaybeNumber;
      earningsHigh?: MaybeNumber;
    };
    exDividendDate?: MaybeDate;
    dividendDate?: MaybeDate;
  };
}

export type QuoteSummaryFn = (
  symbol: string,
  modules: readonly string[]
) => Promise<QuoteSummaryRaw | null | undefined>;

export interface YahooFundamentalsOptions {
  /** Override the provider call (tests). */
  quoteSummaryFn?: QuoteSummaryFn;
  /** Override the rate-limit / retry envelope. */
  http?: HttpClient;
  timeoutMs?: number;
  now?: () => number;
}

interface YahooFinanceModule {
  quoteSummary(
    symbol: string,
    queryOptions?: Record<string, unknown>,
    moduleOptions?: Record<string, unknown>
  ): Promise<unknown>;
  suppressNotices?(notices: string[]): void;
}

let cachedFn: QuoteSummaryFn | null = null;

/** Loaded lazily so unit tests never import yahoo-finance2. */
const defaultQuoteSummaryFn: QuoteSummaryFn = async (symbol, modules) => {
  if (!cachedFn) {
    const mod = (await import('yahoo-finance2')) as unknown as {
      default?: YahooFinanceModule;
    } & YahooFinanceModule;
    const yf = (mod.default ?? mod) as YahooFinanceModule;
    yf.suppressNotices?.(['yahooSurvey', 'ripHistorical']);
    cachedFn = async (s, mods) =>
      // validateResult:false keeps us resilient to Yahoo schema drift; only the
      // handful of fields used below are read, and each is coerced defensively.
      (await yf.quoteSummary(s, { modules: [...mods] }, { validateResult: false })) as QuoteSummaryRaw;
  }
  return cachedFn(symbol, modules);
};

/* -------------------------------------------------------------------------- */
/* Data source                                                                 */
/* -------------------------------------------------------------------------- */

export class YahooFundamentalsDataSource extends BaseDataSource<
  FundamentalsQuery,
  DataSourceResult<FundamentalsPayload>
> {
  readonly name = YAHOO_FUNDAMENTALS_SOURCE;
  readonly kind: DataSourceKind = 'fundamentals';
  readonly provider = 'yahoo';

  private readonly quoteSummaryFn: QuoteSummaryFn;
  private readonly http: HttpClient;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly log = logger.child({ component: 'datasource', source: YAHOO_FUNDAMENTALS_SOURCE });

  constructor(options: YahooFundamentalsOptions = {}) {
    super();
    this.quoteSummaryFn = options.quoteSummaryFn ?? defaultQuoteSummaryFn;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
    this.http =
      options.http ??
      new HttpClient({
        name: YAHOO_FUNDAMENTALS_SOURCE,
        rateLimit: { capacity: 5, refillPerSecond: 2 },
        retry: { retries: 0, baseDelayMs: 400, maxDelayMs: 4000 }, // fail fast, fallback to Finnhub
      });
  }

  /** Public Yahoo data: no credentials required. */
  isConfigured(): boolean {
    return true;
  }

  async fetch(
    query: FundamentalsQuery,
    ctx?: FetchContext
  ): Promise<DataSourceResult<FundamentalsPayload>> {
    const symbol = this.normalize(query?.symbol);
    const raw = await this.load(symbol, ctx);

    return {
      data: this.toPayload(symbol, raw),
      provider: this.provider,
      fetchedAt: this.now(),
      citations: [
        {
          title: `Yahoo Finance — ${symbol} key statistics`,
          url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/key-statistics`,
        },
      ],
      raw,
    };
  }

  private normalize(symbol: unknown): string {
    if (typeof symbol !== 'string' || symbol.trim().length === 0) {
      throw new ValidationError('Symbol is required');
    }
    return symbol.trim().toUpperCase();
  }

  private async load(symbol: string, ctx?: FetchContext): Promise<QuoteSummaryRaw> {
    let raw: QuoteSummaryRaw | null | undefined;
    try {
      raw = await this.http.run(() =>
        withTimeout(
          () => this.quoteSummaryFn(symbol, QUOTE_SUMMARY_MODULES),
          this.timeoutMs,
          `${YAHOO_FUNDAMENTALS_SOURCE} quoteSummary(${symbol})`,
          ctx?.signal
        )
      );
    } catch (err) {
      if (err instanceof SymbolNotFoundError || err instanceof ValidationError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (NOT_FOUND_MESSAGE.test(message)) throw new SymbolNotFoundError(symbol);
      this.log.warn('fundamentals request failed', { symbol, error: message });
      if (THROTTLED_MESSAGE.test(message)) {
        throw new UpstreamError(
          'Yahoo Finance is throttling this host (Too Many Requests) and would not issue a session cookie. Try again in a few minutes.',
          YAHOO_FUNDAMENTALS_SOURCE
        );
      }
      throw new UpstreamError(
        `Could not reach Yahoo Finance for "${symbol}" fundamentals: ${message}`,
        YAHOO_FUNDAMENTALS_SOURCE
      );
    }

    if (!raw || typeof raw !== 'object') throw new SymbolNotFoundError(symbol);
    // Every module can be individually absent (ETFs, indices); an empty
    // response for all of them means Yahoo knows nothing about the symbol.
    const anyModule =
      raw.price || raw.summaryDetail || raw.defaultKeyStatistics || raw.financialData || raw.earnings;
    if (!anyModule) throw new SymbolNotFoundError(symbol);
    return raw;
  }

  private toPayload(symbol: string, raw: QuoteSummaryRaw): FundamentalsPayload {
    const price = raw.price ?? {};
    const detail = raw.summaryDetail ?? {};
    const stats = raw.defaultKeyStatistics ?? {};
    const financial = raw.financialData ?? {};

    return {
      symbol,
      name: price.longName ?? price.shortName ?? null,
      currency: price.currency ?? financial.financialCurrency ?? null,
      price: num(price.regularMarketPrice) ?? num(financial.currentPrice),
      marketCap: num(detail.marketCap),
      enterpriseValue: num(stats.enterpriseValue),
      trailingPE: num(detail.trailingPE),
      forwardPE: num(detail.forwardPE),
      pegRatio: num(stats.pegRatio),
      priceToBook: num(stats.priceToBook),
      trailingEps: num(stats.trailingEps),
      forwardEps: num(stats.forwardEps),
      beta: num(detail.beta) ?? num(stats.beta),
      dividendYield: num(detail.dividendYield),
      profitMargins: num(financial.profitMargins) ?? num(stats.profitMargins),
      grossMargins: num(financial.grossMargins),
      operatingMargins: num(financial.operatingMargins),
      revenueGrowth: num(financial.revenueGrowth),
      earningsGrowth: num(financial.earningsGrowth),
      returnOnEquity: num(financial.returnOnEquity),
      returnOnAssets: num(financial.returnOnAssets),
      debtToEquity: num(financial.debtToEquity),
      currentRatio: num(financial.currentRatio),
      quickRatio: num(financial.quickRatio),
      totalRevenue: num(financial.totalRevenue),
      totalCash: num(financial.totalCash),
      totalDebt: num(financial.totalDebt),
      freeCashflow: num(financial.freeCashflow),
      targetMeanPrice: num(financial.targetMeanPrice),
      recommendationKey: financial.recommendationKey ?? null,
      earnings: this.toEarnings(raw),
    };
  }

  private toEarnings(raw: QuoteSummaryRaw): FundamentalsEarnings {
    const calendar = raw.calendarEvents?.earnings ?? {};
    const dates = (Array.isArray(calendar.earningsDate) ? calendar.earningsDate : [])
      .map((d) => epochMs(d))
      .filter((d): d is number => d !== null)
      .sort((a, b) => a - b);

    const now = this.now();
    // Yahoo lists an estimated range; the blackout rule wants the next
    // upcoming date, falling back to the latest known one.
    const nextEarningsDate = dates.find((d) => d >= now) ?? dates[dates.length - 1] ?? null;

    const quarterly = raw.earnings?.earningsChart?.quarterly ?? [];
    const recentQuarters: EarningsQuarter[] = (Array.isArray(quarterly) ? quarterly : []).map((q) => ({
      period: String(q.date ?? ''),
      actual: num(q.actual),
      estimate: num(q.estimate),
    }));

    return {
      nextEarningsDate,
      earningsDates: dates,
      estimateAverage: num(calendar.earningsAverage),
      estimateLow: num(calendar.earningsLow),
      estimateHigh: num(calendar.earningsHigh),
      exDividendDate: epochMs(raw.calendarEvents?.exDividendDate),
      dividendDate: epochMs(raw.calendarEvents?.dividendDate),
      recentQuarters,
    };
  }

  protected async probe(): Promise<string> {
    const result = await this.fetch({ symbol: FUNDAMENTALS_HEALTH_CHECK_SYMBOL });
    const { symbol, trailingPE, marketCap } = result.data;
    const pe = trailingPE === null ? 'n/a' : trailingPE.toFixed(2);
    const cap = marketCap === null ? 'n/a' : `${(marketCap / 1e9).toFixed(1)}B`;
    return `Fetched ${symbol} fundamentals (trailing P/E ${pe}, market cap ${cap})`;
  }
}
