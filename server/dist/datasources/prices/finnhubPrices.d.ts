/**
 * Finnhub price quotes via GET /quote.
 * Free tier: 60 req/min. Requires FINNHUB_API_KEY (shared with finnhubNews).
 */
import { BaseDataSource, type DataSourceKind } from '../types.js';
import { HttpClient } from '../http.js';
import { type ApiKeyResolver } from '../apiKeys.js';
import type { PriceQuote } from './yahooPrices.js';
export { type PriceQuote } from './yahooPrices.js';
export declare const FINNHUB_PRICES_SOURCE = "finnhub-prices";
export declare const FINNHUB_API_KEY_SECRET = "FINNHUB_API_KEY";
export declare const FINNHUB_BASE_URL = "https://finnhub.io/api/v1/";
export interface FinnhubPricesOptions {
    http?: HttpClient;
    resolveKey?: ApiKeyResolver;
}
export declare class FinnhubPricesDataSource extends BaseDataSource<{
    symbol: string;
}, PriceQuote> {
    readonly name = "finnhub-prices";
    readonly kind: DataSourceKind;
    readonly provider = "finnhub";
    private readonly http;
    private readonly resolveKey;
    private readonly log;
    constructor(options?: FinnhubPricesOptions);
    isConfigured(): boolean;
    notConfiguredReason(): string;
    fetch(request: {
        symbol: string;
    }): Promise<PriceQuote>;
    protected probe(): Promise<void>;
}
//# sourceMappingURL=finnhubPrices.d.ts.map