/**
 * Finnhub fundamentals connector (`/stock/metric`).
 * Used as fallback when Yahoo is rate-limited.
 */

import {
  BaseDataSource,
  type DataSourceKind,
  type DataSourceResult,
  type FetchContext,
} from '../types.js';
import { HttpClient } from '../http.js';
import { apiKeyResolver, type ApiKeyResolver } from '../apiKeys.js';
import { DataSourceNotConfiguredError, SymbolNotFoundError, UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { FundamentalsPayload, FundamentalsQuery, FundamentalsEarnings } from './yahooFundamentals.js';

export const FINNHUB_FUNDAMENTALS_SOURCE = 'finnhub-fundamentals';
export const FINNHUB_API_KEY_SECRET = 'FINNHUB_API_KEY';
export const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1/';

export interface FinnhubFundamentalsOptions {
  http?: HttpClient;
  resolveKey?: ApiKeyResolver;
  now?: () => number;
}

interface FinnhubMetricRaw {
  metric?: Record<string, number | null>;
  metricType?: string;
  symbol?: string;
}

export class FinnhubFundamentalsDataSource extends BaseDataSource<
  FundamentalsQuery,
  DataSourceResult<FundamentalsPayload>
> {
  readonly name = FINNHUB_FUNDAMENTALS_SOURCE;
  readonly kind: DataSourceKind = 'fundamentals';
  readonly provider = 'finnhub';

  private readonly http: HttpClient;
  private readonly resolveKey: ApiKeyResolver;
  private readonly now: () => number;
  private readonly log = logger.child({ component: 'datasource', source: FINNHUB_FUNDAMENTALS_SOURCE });

  constructor(options: FinnhubFundamentalsOptions = {}) {
    super();
    this.resolveKey = options.resolveKey ?? apiKeyResolver(FINNHUB_API_KEY_SECRET);
    this.now = options.now ?? Date.now;
    this.http =
      options.http ??
      new HttpClient({
        name: FINNHUB_FUNDAMENTALS_SOURCE,
        baseUrl: FINNHUB_BASE_URL,
        defaultHeaders: { accept: 'application/json' },
        rateLimit: { capacity: 5, refillPerSecond: 1 },
        retry: { retries: 1, baseDelayMs: 300, maxDelayMs: 2000 },
      });
  }

  isConfigured(): boolean {
    return this.resolveKey() !== undefined;
  }

  protected notConfiguredDetail(): string {
    return `Missing ${FINNHUB_API_KEY_SECRET}`;
  }

  async fetch(
    query: FundamentalsQuery,
    ctx?: FetchContext
  ): Promise<DataSourceResult<FundamentalsPayload>> {
    const key = this.requireKey();
    const symbol = query.symbol.trim().toUpperCase();

    const raw = await this.loadMetrics(key, symbol, ctx);

    return {
      data: this.toPayload(symbol, raw),
      provider: this.provider,
      fetchedAt: this.now(),
      citations: [
        {
          title: `Finnhub — ${symbol} metrics`,
          url: `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`,
        },
      ],
      raw,
    };
  }

  private requireKey(): string {
    const key = this.resolveKey();
    if (!key) throw new DataSourceNotConfiguredError('Finnhub fundamentals', FINNHUB_API_KEY_SECRET);
    return key;
  }

  private async loadMetrics(
    key: string,
    symbol: string,
    ctx?: FetchContext
  ): Promise<FinnhubMetricRaw> {
    try {
      const raw = await this.http.json<FinnhubMetricRaw>(
        `stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`,
        {
          headers: { 'X-Finnhub-Token': key },
          ...(ctx?.signal ? { signal: ctx.signal } : {}),
        }
      );

      if (!raw?.metric || Object.keys(raw.metric).length === 0) {
        throw new SymbolNotFoundError(symbol);
      }

      return raw;
    } catch (err) {
      if (err instanceof SymbolNotFoundError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn('finnhub fundamentals request failed', { symbol, error: message });
      throw new UpstreamError(
        `Could not fetch Finnhub fundamentals for "${symbol}": ${message}`,
        FINNHUB_FUNDAMENTALS_SOURCE
      );
    }
  }

  private toPayload(symbol: string, raw: FinnhubMetricRaw): FundamentalsPayload {
    const m = raw.metric ?? {};

    const emptyEarnings: FundamentalsEarnings = {
      nextEarningsDate: null,
      earningsDates: [],
      estimateAverage: null,
      estimateLow: null,
      estimateHigh: null,
      exDividendDate: null,
      dividendDate: null,
      recentQuarters: [],
    };

    return {
      symbol,
      name: null, // Finnhub metric endpoint doesn't include name
      currency: null,
      price: null, // Use price from prices datasource
      marketCap: m['marketCapitalization'] ? m['marketCapitalization'] * 1e6 : null,
      enterpriseValue: m['enterpriseValue'] ? m['enterpriseValue'] * 1e6 : null,
      trailingPE: m['peBasicExclExtraTTM'] ?? m['peTTM'] ?? null,
      forwardPE: m['peExclExtraAnnual'] ?? null,
      pegRatio: m['pegRatioTTM'] ?? null,
      priceToBook: m['pbAnnual'] ?? m['pbQuarterly'] ?? null,
      trailingEps: m['epsBasicExclExtraItemsTTM'] ?? m['epsTTM'] ?? null,
      forwardEps: m['epsEstimateNextYear'] ?? null,
      beta: m['beta'] ?? null,
      dividendYield: m['dividendYieldIndicatedAnnual'] ?? null,
      profitMargins: m['netProfitMarginTTM'] ? m['netProfitMarginTTM'] / 100 : null,
      grossMargins: m['grossMarginTTM'] ? m['grossMarginTTM'] / 100 : null,
      operatingMargins: m['operatingMarginTTM'] ? m['operatingMarginTTM'] / 100 : null,
      revenueGrowth: m['revenueGrowthTTMYoy'] ? m['revenueGrowthTTMYoy'] / 100 : null,
      earningsGrowth: m['epsGrowthTTMYoy'] ? m['epsGrowthTTMYoy'] / 100 : null,
      returnOnEquity: m['roeTTM'] ? m['roeTTM'] / 100 : null,
      returnOnAssets: m['roaTTM'] ? m['roaTTM'] / 100 : null,
      debtToEquity: m['totalDebt/totalEquityAnnual'] ?? m['totalDebt/totalEquityQuarterly'] ?? null,
      currentRatio: m['currentRatioAnnual'] ?? m['currentRatioQuarterly'] ?? null,
      quickRatio: m['quickRatioAnnual'] ?? m['quickRatioQuarterly'] ?? null,
      totalRevenue: m['revenuePerShareTTM'] ? null : null, // Not directly available
      totalCash: m['cashPerSharePerShareAnnual'] ? null : null,
      totalDebt: null,
      freeCashflow: m['freeCashFlowTTM'] ? m['freeCashFlowTTM'] * 1e6 : null,
      targetMeanPrice: m['targetMeanPrice'] ?? null,
      recommendationKey: null,
      earnings: emptyEarnings,
    };
  }

  protected async probe(): Promise<string> {
    const result = await this.fetch({ symbol: 'AAPL' });
    const { symbol, trailingPE, marketCap } = result.data;
    const pe = trailingPE === null ? 'n/a' : trailingPE.toFixed(2);
    const cap = marketCap === null ? 'n/a' : `${(marketCap / 1e9).toFixed(1)}B`;
    return `Fetched ${symbol} fundamentals (trailing P/E ${pe}, market cap ${cap})`;
  }
}
