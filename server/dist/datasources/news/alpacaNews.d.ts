/**
 * Alpaca news connector (Market Data API).
 *
 * Uses existing ALPACA_API_KEY/SECRET from broker config.
 * Rate limit: 200 req/min (vs Finnhub's 60/min).
 */
import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { HttpClient } from '../http.js';
import { type NewsPayload, type NewsQuery } from './types.js';
export declare const ALPACA_NEWS_SOURCE = "alpaca-news";
export declare const ALPACA_DATA_BASE_URL = "https://data.alpaca.markets/v1beta1/";
export interface AlpacaNewsOptions {
    http?: HttpClient;
    apiKey?: string;
    apiSecret?: string;
    now?: () => number;
}
export declare class AlpacaNewsDataSource extends BaseDataSource<NewsQuery, DataSourceResult<NewsPayload>> {
    readonly name = "alpaca-news";
    readonly kind: DataSourceKind;
    readonly provider = "alpaca";
    private readonly http;
    private readonly apiKey;
    private readonly apiSecret;
    private readonly now;
    constructor(options?: AlpacaNewsOptions);
    isConfigured(): boolean;
    protected notConfiguredDetail(): string;
    fetch(query?: NewsQuery, ctx?: FetchContext): Promise<DataSourceResult<NewsPayload>>;
    private toArticle;
    private toUpstreamError;
    protected probe(): Promise<string>;
}
//# sourceMappingURL=alpacaNews.d.ts.map