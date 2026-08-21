/** News connector selection: Finnhub (key) or Yahoo (zero-key fallback). */

import type { DataSource, DataSourceResult } from '../types.js';
import type { NewsPayload, NewsQuery } from './types.js';
import { FinnhubNewsDataSource } from './finnhubNews.js';
import { YahooNewsDataSource } from './yahooNews.js';
import { logger } from '../../lib/logger.js';

export * from './types.js';
export { FinnhubNewsDataSource, FINNHUB_NEWS_SOURCE, FINNHUB_API_KEY_SECRET } from './finnhubNews.js';
export { YahooNewsDataSource, YAHOO_NEWS_SOURCE } from './yahooNews.js';

export type NewsProvider = 'finnhub' | 'yahoo';

export type NewsDataSource = DataSource<NewsQuery, DataSourceResult<NewsPayload>>;

const log = logger.child({ component: 'news-cache' });

interface NewsCacheEntry {
  data: DataSourceResult<NewsPayload>;
  expiresAt: number;
  days: number; // how many days of data we fetched
}

/** Global TTL cache for news - persists across runs to reduce API calls. */
const newsCache = new Map<string, NewsCacheEntry>();
const newsInflight = new Map<string, Promise<DataSourceResult<NewsPayload>>>();
const NEWS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Wraps a news datasource with a global in-memory cache. */
class CachedNewsDataSource implements NewsDataSource {
  constructor(private readonly inner: NewsDataSource) {}

  get name() { return this.inner.name; }
  get kind() { return this.inner.kind; }
  get provider() { return this.inner.provider; }

  isConfigured() { return this.inner.isConfigured(); }
  healthCheck() { return this.inner.healthCheck(); }

  async fetch(query?: NewsQuery, ctx?: any): Promise<DataSourceResult<NewsPayload>> {
    const symbol = query?.symbol?.toUpperCase() ?? 'general';
    const cacheKey = `news:${symbol}`;
    const now = Date.now();

    // Calculate requested days from query dates
    const requestedDays = this.getDaysFromQuery(query);

    const cached = newsCache.get(cacheKey);
    // Cache hit if: not expired AND cached data covers requested range
    if (cached && cached.expiresAt > now && cached.days >= requestedDays) {
      log.debug('news cache hit', { symbol, requestedDays, cachedDays: cached.days });
      return cached.data;
    }

    // Deduplicate concurrent requests
    const inflight = newsInflight.get(cacheKey);
    if (inflight) {
      log.debug('news cache inflight hit', { symbol });
      return inflight;
    }

    // Fetch with max range (90 days) to maximize cache reuse
    const maxDays = 90;
    const fromDate = new Date(now - maxDays * 86_400_000).toISOString().slice(0, 10);
    const toDate = new Date(now).toISOString().slice(0, 10);

    const promise = this.inner.fetch({ ...query, from: fromDate, to: toDate }, ctx)
      .then((result) => {
        newsCache.set(cacheKey, { data: result, expiresAt: Date.now() + NEWS_CACHE_TTL_MS, days: maxDays });
        newsInflight.delete(cacheKey);
        log.debug('news cache miss - fetched max range', { symbol, days: maxDays });
        return result;
      })
      .catch((err) => {
        newsInflight.delete(cacheKey);
        throw err;
      });

    newsInflight.set(cacheKey, promise);
    return promise;
  }

  private getDaysFromQuery(query?: NewsQuery): number {
    if (!query?.from) return 7; // default
    const from = new Date(query.from).getTime();
    const to = query.to ? new Date(query.to).getTime() : Date.now();
    return Math.ceil((to - from) / 86_400_000);
  }
}

export interface NewsDataSourceOptions {
  /** Skip Finnhub /news-sentiment call (paid tier). LLM judges sentiment instead. */
  sentiment?: boolean;
}

export function createNewsDataSource(provider: NewsProvider, options: NewsDataSourceOptions = {}): NewsDataSource {
  const inner = provider === 'yahoo'
    ? new YahooNewsDataSource()
    : new FinnhubNewsDataSource({ sentiment: options.sentiment ?? false });
  return new CachedNewsDataSource(inner);
}
