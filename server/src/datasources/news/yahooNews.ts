/**
 * Yahoo news connector — the zero-key fallback behind the same interface as
 * Finnhub, so the Data Sources page has a real provider toggle.
 *
 * Uses the public `v1/finance/search` endpoint (the same feed `yahoo-finance2`
 * `search()` wraps) directly, which keeps it trivially testable and avoids the
 * SDK's cookie/crumb dance for a read that does not need it.
 */

import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { HttpClient, HttpError } from '../http.js';
import { UpstreamError } from '../../lib/errors.js';
import {
  clampLimit,
  normalizeNewsSymbol,
  GENERAL_NEWS_QUERY,
  NEWS_HEALTH_CHECK_SYMBOL,
  type NewsArticle,
  type NewsPayload,
  type NewsQuery,
} from './types.js';

export const YAHOO_NEWS_SOURCE = 'yahoo-news';
export const YAHOO_SEARCH_BASE_URL = 'https://query1.finance.yahoo.com/';

/** Yahoo 429s browser-impersonating user agents; identify honestly. */
const USER_AGENT = 'atn-trd/0.1.0';

export interface YahooNewsItemRaw {
  uuid?: string;
  title?: string;
  publisher?: string;
  link?: string;
  providerPublishTime?: number;
  type?: string;
  relatedTickers?: string[];
  thumbnail?: { resolutions?: Array<{ url?: string; width?: number; height?: number }> };
}

interface YahooSearchResponse {
  news?: YahooNewsItemRaw[];
  error?: { code?: string; description?: string } | string | null;
}

export interface YahooNewsOptions {
  http?: HttpClient;
  now?: () => number;
}

function toEpochMs(seconds: number | undefined): number {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return Date.now();
  return seconds > 1e12 ? seconds : seconds * 1000;
}

function pickThumbnail(item: YahooNewsItemRaw): string | null {
  const resolutions = item.thumbnail?.resolutions;
  if (!Array.isArray(resolutions) || resolutions.length === 0) return null;
  return resolutions[0]?.url ?? null;
}

export class YahooNewsDataSource extends BaseDataSource<NewsQuery, DataSourceResult<NewsPayload>> {
  readonly name = YAHOO_NEWS_SOURCE;
  readonly kind: DataSourceKind = 'news';
  readonly provider = 'yahoo';

  private readonly http: HttpClient;
  private readonly now: () => number;

  constructor(options: YahooNewsOptions = {}) {
    super();
    this.now = options.now ?? Date.now;
    this.http =
      options.http ??
      new HttpClient({
        name: YAHOO_NEWS_SOURCE,
        baseUrl: YAHOO_SEARCH_BASE_URL,
        defaultHeaders: { 'user-agent': USER_AGENT, accept: 'application/json' },
        rateLimit: { capacity: 5, refillPerSecond: 2 },
        retry: { retries: 2, baseDelayMs: 400, maxDelayMs: 4000 },
      });
  }

  /** Public search feed: no credentials required. */
  isConfigured(): boolean {
    return true;
  }

  async fetch(query: NewsQuery = {}, ctx?: FetchContext): Promise<DataSourceResult<NewsPayload>> {
    const symbol = query.symbol ? normalizeNewsSymbol(query.symbol) : null;
    const limit = clampLimit(query.limit);
    const raw = await this.search(symbol ?? GENERAL_NEWS_QUERY, limit, ctx);

    const warnings = ['Yahoo news does not expose sentiment scores'];
    if (query.from || query.to) {
      // The search feed always returns the most recent items.
      warnings.push('Yahoo news ignores from/to date filters');
    }

    const articles = raw.slice(0, limit).map((item) => this.toArticle(item, symbol));

    return {
      data: { symbol, articles, sentiment: null, warnings },
      provider: this.provider,
      fetchedAt: this.now(),
      citations: articles.map((a) => ({ title: a.headline, url: a.url })),
      raw,
    };
  }

  private async search(
    term: string,
    limit: number,
    ctx?: FetchContext
  ): Promise<YahooNewsItemRaw[]> {
    const path =
      `v1/finance/search?q=${encodeURIComponent(term)}` +
      `&newsCount=${limit}&quotesCount=0&enableFuzzyQuery=false&enableNavLinks=false`;
    let body: YahooSearchResponse;
    try {
      body = await this.http.json<YahooSearchResponse>(path, {
        ...(ctx?.signal ? { signal: ctx.signal } : {}),
      });
    } catch (err) {
      if (err instanceof HttpError) {
        throw new UpstreamError(
          `Yahoo news request failed (HTTP ${err.status})`,
          YAHOO_NEWS_SOURCE
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new UpstreamError(`Could not reach Yahoo news: ${message}`, YAHOO_NEWS_SOURCE);
    }

    if (body.error) {
      const description =
        typeof body.error === 'string' ? body.error : body.error.description ?? 'unknown error';
      throw new UpstreamError(`Yahoo news returned an error: ${description}`, YAHOO_NEWS_SOURCE);
    }
    return Array.isArray(body.news) ? body.news : [];
  }

  private toArticle(item: YahooNewsItemRaw, symbol: string | null): NewsArticle {
    const url = item.link ?? '';
    const related = Array.isArray(item.relatedTickers)
      ? item.relatedTickers.map((t) => String(t).toUpperCase())
      : [];
    return {
      id: item.uuid ?? url,
      headline: item.title ?? '(untitled)',
      // The search feed carries headlines only; summaries need the article page.
      summary: '',
      url,
      source: item.publisher ?? 'Yahoo Finance',
      publishedAt: toEpochMs(item.providerPublishTime),
      symbols: related.length > 0 ? related : symbol ? [symbol] : [],
      imageUrl: pickThumbnail(item),
    };
  }

  protected async probe(): Promise<string> {
    const result = await this.fetch({ symbol: NEWS_HEALTH_CHECK_SYMBOL, limit: 5 });
    const count = result.data.articles.length;
    const latest = result.data.articles[0];
    return count === 0
      ? `Reachable; no ${NEWS_HEALTH_CHECK_SYMBOL} headlines returned`
      : `Fetched ${count} ${NEWS_HEALTH_CHECK_SYMBOL} headline(s); latest: ${latest?.headline.slice(0, 80)}`;
  }
}
