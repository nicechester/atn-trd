/**
 * Finnhub news connector (`/company-news`, `/news?category=general`).
 *
 * Needs a free API key (60 req/min). Sentiment comes from `/news-sentiment`,
 * which is paid-tier on current plans, so it is fetched best-effort and
 * degrades to `null` with a warning rather than failing the whole fetch.
 */
import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { HttpClient } from '../http.js';
import { type ApiKeyResolver } from '../apiKeys.js';
import { type NewsPayload, type NewsQuery } from './types.js';
export declare const FINNHUB_NEWS_SOURCE = "finnhub-news";
export declare const FINNHUB_API_KEY_SECRET = "FINNHUB_API_KEY";
export declare const FINNHUB_BASE_URL = "https://finnhub.io/api/v1/";
/** Default company-news window when the caller supplies no dates. */
export declare const DEFAULT_LOOKBACK_DAYS = 7;
export interface FinnhubArticleRaw {
    id?: number | string;
    category?: string;
    datetime?: number;
    headline?: string;
    image?: string;
    related?: string;
    source?: string;
    summary?: string;
    url?: string;
}
export interface FinnhubSentimentRaw {
    buzz?: {
        articlesInLastWeek?: number;
        buzz?: number;
        weeklyAverage?: number;
    };
    companyNewsScore?: number;
    sectorAverageBullishPercent?: number;
    sectorAverageNewsScore?: number;
    sentiment?: {
        bearishPercent?: number;
        bullishPercent?: number;
    };
    symbol?: string;
}
export interface FinnhubNewsOptions {
    http?: HttpClient;
    /** Overrides the secret-store lookup (tests). */
    resolveKey?: ApiKeyResolver;
    /** Skip the best-effort `/news-sentiment` call. Default enabled. */
    sentiment?: boolean;
    now?: () => number;
}
export declare class FinnhubNewsDataSource extends BaseDataSource<NewsQuery, DataSourceResult<NewsPayload>> {
    readonly name = "finnhub-news";
    readonly kind: DataSourceKind;
    readonly provider = "finnhub";
    private readonly http;
    private readonly resolveKey;
    private readonly wantSentiment;
    private readonly now;
    private readonly log;
    constructor(options?: FinnhubNewsOptions);
    isConfigured(): boolean;
    protected notConfiguredDetail(): string;
    fetch(query?: NewsQuery, ctx?: FetchContext): Promise<DataSourceResult<NewsPayload>>;
    private requireKey;
    private companyNews;
    private generalNews;
    private newsSentiment;
    private getArray;
    private get;
    private toUpstreamError;
    private toArticle;
    protected probe(): Promise<string>;
    private fetchWithoutSentiment;
}
//# sourceMappingURL=finnhubNews.d.ts.map