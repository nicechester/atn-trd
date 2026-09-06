/**
 * Yahoo news connector — the zero-key fallback behind the same interface as
 * Finnhub, so the Data Sources page has a real provider toggle.
 *
 * Uses the public `v1/finance/search` endpoint (the same feed `yahoo-finance2`
 * `search()` wraps) directly, which keeps it trivially testable and avoids the
 * SDK's cookie/crumb dance for a read that does not need it.
 */
import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { HttpClient } from '../http.js';
import { type NewsPayload, type NewsQuery } from './types.js';
export declare const YAHOO_NEWS_SOURCE = "yahoo-news";
export declare const YAHOO_SEARCH_BASE_URL = "https://query1.finance.yahoo.com/";
export interface YahooNewsItemRaw {
    uuid?: string;
    title?: string;
    publisher?: string;
    link?: string;
    providerPublishTime?: number;
    type?: string;
    relatedTickers?: string[];
    thumbnail?: {
        resolutions?: Array<{
            url?: string;
            width?: number;
            height?: number;
        }>;
    };
}
export interface YahooNewsOptions {
    http?: HttpClient;
    now?: () => number;
}
export declare class YahooNewsDataSource extends BaseDataSource<NewsQuery, DataSourceResult<NewsPayload>> {
    readonly name = "yahoo-news";
    readonly kind: DataSourceKind;
    readonly provider = "yahoo";
    private readonly http;
    private readonly now;
    constructor(options?: YahooNewsOptions);
    /** Public search feed: no credentials required. */
    isConfigured(): boolean;
    fetch(query?: NewsQuery, ctx?: FetchContext): Promise<DataSourceResult<NewsPayload>>;
    private search;
    private toArticle;
    protected probe(): Promise<string>;
}
//# sourceMappingURL=yahooNews.d.ts.map