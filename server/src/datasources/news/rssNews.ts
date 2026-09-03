/**
 * RSS feed news connector — free, unlimited news ingestion.
 *
 * Aggregates news from multiple RSS feeds:
 * - Ticker feeds: Google News, Yahoo Finance RSS, Seeking Alpha
 * - Macro feeds: Federal Reserve, CNBC
 * - Filing feeds: SEC 8-K, SEC 10-Q
 *
 * No authentication required; no rate limits. Articles are deduplicated by URL hash.
 */

import Parser from 'rss-parser';
import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { UpstreamError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  clampLimit,
  normalizeNewsSymbol,
  NEWS_HEALTH_CHECK_SYMBOL,
  type NewsArticle,
  type NewsPayload,
  type NewsQuery,
} from './types.js';

export const RSS_NEWS_SOURCE = 'rss-news';

interface RssFeed {
  id: string;
  type: 'ticker' | 'macro' | 'filings';
  urlTemplate: string;
}

/** RSS feed configuration */
const RSS_FEEDS: RssFeed[] = [
  // Ticker feeds — query with {symbol}
  { id: 'google-news', type: 'ticker', urlTemplate: 'https://news.google.com/rss/search?q={symbol}+stock&hl=en-US&gl=US&ceid=US:en' },
  { id: 'yahoo-rss', type: 'ticker', urlTemplate: 'https://finance.yahoo.com/rss/headline?s={symbol}' },
  { id: 'seeking-alpha', type: 'ticker', urlTemplate: 'https://seekingalpha.com/api/sa/combined/{symbol}.xml' },

  // Macro feeds — no symbol substitution
  { id: 'federal-reserve', type: 'macro', urlTemplate: 'https://www.federalreserve.gov/feeds/press_all.xml' },
  { id: 'cnbc', type: 'macro', urlTemplate: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664' },

  // Filing feeds — no symbol substitution
  { id: 'sec-8k', type: 'filings', urlTemplate: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&output=atom' },
  { id: 'sec-10q', type: 'filings', urlTemplate: 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-Q&output=atom' },
];

export interface RssNewsOptions {
  parser?: Parser;
  now?: () => number;
}

const USER_AGENT = 'atn-trd/1.0 (Chester Kim almightyespanol@gmail.com)';

const defaultParser = new Parser({
  customFields: {
    item: [
      ['content:encoded', 'content'],
      ['description', 'summary'],
      ['media:content', 'media'],
    ],
  },
  headers: {
    'User-Agent': USER_AGENT,
  },
});

function buildFeedUrl(feed: RssFeed, symbol?: string): string {
  if (feed.type === 'ticker' && symbol) {
    return feed.urlTemplate.replace('{symbol}', encodeURIComponent(symbol));
  }
  return feed.urlTemplate;
}

/**
 * Hash a URL to create a simple deduplication key.
 */
function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return String(Math.abs(hash));
}

/**
 * Normalize an RSS item to the NewsArticle interface.
 */
function normalizeRssArticle(item: Parser.Item, feedId: string, symbol?: string): NewsArticle {
  const url = item.link ?? '';
  const publishedAt = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();

  // Extract symbols from the item or use the query symbol
  const symbols: string[] = [];
  if (symbol) {
    symbols.push(symbol);
  }
  // If item has categories or other ticker references, they could be parsed here.

  // Get summary from available fields; custom fields are typed as Record<string, any>
  const customFields = item as Record<string, any>;
  const summary = customFields.summary || customFields.content || '';

  return {
    id: hashUrl(url),
    headline: item.title ?? '(untitled)',
    summary,
    url,
    source: feedId,
    publishedAt,
    symbols,
    imageUrl: null, // RSS feeds may have media, but the NewsArticle interface accepts null
  };
}

/**
 * Fetch and parse an RSS feed.
 */
async function fetchRssFeed(feedUrl: string, parser: Parser): Promise<Parser.Item[]> {
  try {
    const feed = await parser.parseURL(feedUrl);
    return feed.items ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UpstreamError(
      `Failed to parse RSS feed from ${feedUrl}: ${message}`,
      RSS_NEWS_SOURCE
    );
  }
}

/**
 * Deduplicate articles by URL hash.
 */
function deduplicateArticles(articles: NewsArticle[]): NewsArticle[] {
  const seen = new Set<string>();
  const deduped: NewsArticle[] = [];

  for (const article of articles) {
    if (!seen.has(article.id)) {
      seen.add(article.id);
      deduped.push(article);
    }
  }

  return deduped;
}

export class RssNewsDataSource extends BaseDataSource<NewsQuery, DataSourceResult<NewsPayload>> {
  readonly name = RSS_NEWS_SOURCE;
  readonly kind: DataSourceKind = 'news';
  readonly provider = 'rss';

  private readonly parser: Parser;
  private readonly now: () => number;
  private readonly log = logger.child({ component: 'datasource', source: RSS_NEWS_SOURCE });

  constructor(options: RssNewsOptions = {}) {
    super();
    this.parser = options.parser ?? defaultParser;
    this.now = options.now ?? Date.now;
  }

  async fetch(query: NewsQuery = {}, _ctx?: FetchContext): Promise<DataSourceResult<NewsPayload>> {
    const symbol = query.symbol ? normalizeNewsSymbol(query.symbol) : null;
    const limit = clampLimit(query.limit);

    try {
      const articles = await this.getRssNews(symbol);
      const deduplicated = deduplicateArticles(articles);
      const sliced = deduplicated.slice(0, limit);

      return {
        data: {
          symbol,
          articles: sliced,
          sentiment: null,
          warnings: ['RSS feeds do not expose sentiment scores'],
        },
        provider: this.provider,
        fetchedAt: this.now(),
        citations: sliced.map((a) => ({ title: a.headline, url: a.url })),
        raw: sliced,
      };
    } catch (err) {
      throw this.toUpstreamError(err);
    }
  }

  /**
   * Fetch news from all relevant RSS feeds.
   */
  private async getRssNews(symbol: string | null): Promise<NewsArticle[]> {
    const articles: NewsArticle[] = [];
    const errors: string[] = [];

    // Collect promises for all feed fetches
    const feedPromises: Array<{
      feed: RssFeed;
      promise: Promise<Parser.Item[]>;
    }> = [];

    // For ticker symbols, fetch ticker-specific feeds
    if (symbol) {
      for (const feed of RSS_FEEDS.filter((f) => f.type === 'ticker')) {
        const url = buildFeedUrl(feed, symbol);
        feedPromises.push({
          feed,
          promise: this.safelyFetchFeed(url),
        });
      }
    }

    // Always fetch macro and filing feeds (relevant to all symbols)
    for (const feed of RSS_FEEDS.filter((f) => f.type !== 'ticker')) {
      feedPromises.push({
        feed,
        promise: this.safelyFetchFeed(feed.urlTemplate),
      });
    }

    // Wait for all feeds to resolve
    const results = await Promise.allSettled(
      feedPromises.map(({ feed, promise }) =>
        promise
          .then((items) => ({ feed, items }))
          .catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`${feed.id}: ${message}`);
            return { feed, items: [] };
          })
      )
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { feed, items } = result.value;
        for (const item of items) {
          try {
            const article = normalizeRssArticle(item, feed.id, symbol ?? undefined);
            articles.push(article);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.log.debug('failed to normalize RSS item', { feed: feed.id, error: message });
          }
        }
      }
    }

    if (errors.length > 0) {
      this.log.warn('RSS feed fetch errors', { errors });
    }

    return articles;
  }

  /**
   * Fetch a feed, returning empty array on error (graceful degradation).
   */
  private async safelyFetchFeed(url: string): Promise<Parser.Item[]> {
    try {
      return await fetchRssFeed(url, this.parser);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.debug('RSS feed fetch failed', { url, error: message });
      return [];
    }
  }

  private toUpstreamError(err: unknown): Error {
    if (err instanceof UpstreamError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new UpstreamError(`RSS news fetch failed: ${message}`, RSS_NEWS_SOURCE);
  }

  protected async probe(): Promise<string> {
    const result = await this.fetch({ symbol: NEWS_HEALTH_CHECK_SYMBOL, limit: 5 });
    const count = result.data.articles.length;
    return count === 0
      ? 'Reachable; no recent headlines found'
      : `Fetched ${count} headline(s) from RSS feeds`;
  }
}
