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
import { type NewsPayload, type NewsQuery } from './types.js';
export declare const RSS_NEWS_SOURCE = "rss-news";
export interface RssNewsOptions {
    parser?: Parser;
    now?: () => number;
}
export declare class RssNewsDataSource extends BaseDataSource<NewsQuery, DataSourceResult<NewsPayload>> {
    readonly name = "rss-news";
    readonly kind: DataSourceKind;
    readonly provider = "rss";
    private readonly parser;
    private readonly now;
    private readonly log;
    constructor(options?: RssNewsOptions);
    fetch(query?: NewsQuery, _ctx?: FetchContext): Promise<DataSourceResult<NewsPayload>>;
    /**
     * Fetch news from all relevant RSS feeds.
     */
    private getRssNews;
    /**
     * Fetch a feed, returning empty array on error (graceful degradation).
     */
    private safelyFetchFeed;
    private toUpstreamError;
    protected probe(): Promise<string>;
}
//# sourceMappingURL=rssNews.d.ts.map