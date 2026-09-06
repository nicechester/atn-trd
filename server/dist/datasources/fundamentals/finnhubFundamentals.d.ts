/**
 * Finnhub fundamentals connector (`/stock/metric`).
 * Used as fallback when Yahoo is rate-limited.
 */
import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { HttpClient } from '../http.js';
import { type ApiKeyResolver } from '../apiKeys.js';
import type { FundamentalsPayload, FundamentalsQuery } from './yahooFundamentals.js';
export declare const FINNHUB_FUNDAMENTALS_SOURCE = "finnhub-fundamentals";
export declare const FINNHUB_API_KEY_SECRET = "FINNHUB_API_KEY";
export declare const FINNHUB_BASE_URL = "https://finnhub.io/api/v1/";
export interface FinnhubFundamentalsOptions {
    http?: HttpClient;
    resolveKey?: ApiKeyResolver;
    now?: () => number;
}
export declare class FinnhubFundamentalsDataSource extends BaseDataSource<FundamentalsQuery, DataSourceResult<FundamentalsPayload>> {
    readonly name = "finnhub-fundamentals";
    readonly kind: DataSourceKind;
    readonly provider = "finnhub";
    private readonly http;
    private readonly resolveKey;
    private readonly now;
    private readonly log;
    constructor(options?: FinnhubFundamentalsOptions);
    isConfigured(): boolean;
    protected notConfiguredDetail(): string;
    fetch(query: FundamentalsQuery, ctx?: FetchContext): Promise<DataSourceResult<FundamentalsPayload>>;
    private requireKey;
    private loadMetrics;
    private loadQuote;
    private toPayload;
    protected probe(): Promise<string>;
}
//# sourceMappingURL=finnhubFundamentals.d.ts.map