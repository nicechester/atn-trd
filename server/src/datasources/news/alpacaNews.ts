/**
 * Alpaca news connector (Market Data API).
 * 
 * Uses existing ALPACA_API_KEY/SECRET from broker config.
 * Rate limit: 200 req/min (vs Finnhub's 60/min).
 */

import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { HttpClient, HttpError } from '../http.js';
import { DataSourceNotConfiguredError, UpstreamError } from '../../lib/errors.js';
import {
  clampLimit,
  normalizeNewsSymbol,
  NEWS_HEALTH_CHECK_SYMBOL,
  type NewsArticle,
  type NewsPayload,
  type NewsQuery,
} from './types.js';

export const ALPACA_NEWS_SOURCE = 'alpaca-news';
export const ALPACA_DATA_BASE_URL = 'https://data.alpaca.markets/v1beta1/';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LOOKBACK_DAYS = 7;

interface AlpacaNewsArticle {
  id: number;
  headline: string;
  summary: string;
  author: string;
  created_at: string;
  updated_at: string;
  url: string;
  content: string;
  symbols: string[];
  source: string;
  images?: Array<{ size: string; url: string }>;
}

interface AlpacaNewsResponse {
  news: AlpacaNewsArticle[];
  next_page_token?: string;
}

export interface AlpacaNewsOptions {
  http?: HttpClient;
  apiKey?: string;
  apiSecret?: string;
  now?: () => number;
}

export class AlpacaNewsDataSource extends BaseDataSource<NewsQuery, DataSourceResult<NewsPayload>> {
  readonly name = ALPACA_NEWS_SOURCE;
  readonly kind: DataSourceKind = 'news';
  readonly provider = 'alpaca';

  private readonly http: HttpClient;
  private readonly apiKey: string | undefined;
  private readonly apiSecret: string | undefined;
  private readonly now: () => number;

  constructor(options: AlpacaNewsOptions = {}) {
    super();
    this.apiKey = options.apiKey ?? process.env.ALPACA_API_KEY;
    this.apiSecret = options.apiSecret ?? process.env.ALPACA_API_SECRET;
    this.now = options.now ?? Date.now;
    this.http =
      options.http ??
      new HttpClient({
        name: ALPACA_NEWS_SOURCE,
        baseUrl: ALPACA_DATA_BASE_URL,
        defaultHeaders: { accept: 'application/json' },
        // 200 req/min = ~3.3/sec, use 3/sec to be safe
        rateLimit: { capacity: 10, refillPerSecond: 3 },
        retry: { retries: 2, baseDelayMs: 300, maxDelayMs: 2000 },
      });
  }

  isConfigured(): boolean {
    return !!this.apiKey && !!this.apiSecret;
  }

  protected notConfiguredDetail(): string {
    return 'Missing ALPACA_API_KEY or ALPACA_API_SECRET';
  }

  async fetch(query: NewsQuery = {}, ctx?: FetchContext): Promise<DataSourceResult<NewsPayload>> {
    if (!this.apiKey || !this.apiSecret) {
      throw new DataSourceNotConfiguredError('Alpaca news', 'ALPACA_API_KEY');
    }

    const limit = clampLimit(query.limit);
    const symbol = query.symbol ? normalizeNewsSymbol(query.symbol) : null;

    const params = new URLSearchParams();
    if (symbol) params.set('symbols', symbol);
    params.set('limit', String(Math.min(limit, 50)));
    
    if (query.from) {
      params.set('start', new Date(query.from).toISOString());
    } else {
      params.set('start', new Date(this.now() - DEFAULT_LOOKBACK_DAYS * DAY_MS).toISOString());
    }
    if (query.to) {
      params.set('end', new Date(query.to).toISOString());
    }

    const path = `news?${params.toString()}`;

    try {
      const response = await this.http.json<AlpacaNewsResponse>(path, {
        headers: {
          'APCA-API-KEY-ID': this.apiKey,
          'APCA-API-SECRET-KEY': this.apiSecret,
        },
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      });

      const articles = (response.news || []).slice(0, limit).map((item) => this.toArticle(item));

      return {
        data: { symbol, articles, sentiment: null, warnings: [] },
        provider: this.provider,
        fetchedAt: this.now(),
        citations: articles.map((a) => ({ title: a.headline, url: a.url })),
        raw: response,
      };
    } catch (err) {
      throw this.toUpstreamError(err);
    }
  }

  private toArticle(item: AlpacaNewsArticle): NewsArticle {
    return {
      id: String(item.id),
      headline: item.headline || '(untitled)',
      summary: item.summary || '',
      url: item.url || '',
      source: item.source || 'Alpaca',
      publishedAt: new Date(item.created_at).getTime(),
      symbols: item.symbols || [],
      imageUrl: item.images?.[0]?.url || null,
    };
  }

  private toUpstreamError(err: unknown): Error {
    if (err instanceof HttpError) {
      if (err.status === 401 || err.status === 403) {
        return new UpstreamError(`Alpaca rejected API credentials (HTTP ${err.status})`, ALPACA_NEWS_SOURCE);
      }
      if (err.status === 429) {
        return new UpstreamError('Alpaca rate limit exceeded (HTTP 429)', ALPACA_NEWS_SOURCE);
      }
      return new UpstreamError(`Alpaca request failed (HTTP ${err.status})`, ALPACA_NEWS_SOURCE);
    }
    if (err instanceof UpstreamError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new UpstreamError(`Could not reach Alpaca: ${message}`, ALPACA_NEWS_SOURCE);
  }

  protected async probe(): Promise<string> {
    const result = await this.fetch({ symbol: NEWS_HEALTH_CHECK_SYMBOL, limit: 5 });
    const count = result.data.articles.length;
    const latest = result.data.articles[0];
    return count === 0
      ? `Reachable; no ${NEWS_HEALTH_CHECK_SYMBOL} headlines`
      : `Fetched ${count} headline(s); latest: ${latest?.headline.slice(0, 80)}`;
  }
}
