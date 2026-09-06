/**
 * Yahoo Finance price quotes. Requires no API key, so `isConfigured()` is
 * always true; the trade-off is aggressive upstream throttling, which is why
 * every call goes through the shared token bucket + retry envelope.
 */
import { BaseDataSource, type DataSourceKind } from '../types.js';
import { HttpClient } from '../http.js';
export declare const YAHOO_PRICES_SOURCE = "yahoo-prices";
export declare const HEALTH_CHECK_SYMBOL = "AAPL";
export interface PriceQuote {
    symbol: string;
    name: string;
    price: number;
    currency: string;
    /** Epoch milliseconds of the quote as reported by the provider. */
    timestamp: number;
    exchange: string | null;
    marketState: string | null;
}
/** Subset of the yahoo-finance2 quote payload this source depends on. */
export interface YahooQuoteRaw {
    symbol?: string;
    shortName?: string;
    longName?: string;
    displayName?: string;
    regularMarketPrice?: number;
    currency?: string;
    regularMarketTime?: Date | number | string;
    fullExchangeName?: string;
    exchange?: string;
    marketState?: string;
}
export type YahooQuoteFn = (symbol: string) => Promise<YahooQuoteRaw | null | undefined>;
export interface YahooPricesOptions {
    /** Override the primary provider call (tests). */
    quoteFn?: YahooQuoteFn;
    /** Override the fallback provider call (tests). */
    chartFn?: YahooQuoteFn;
    /** Override the rate-limit / retry envelope. */
    http?: HttpClient;
    /** Disable the unauthenticated chart fallback. Default enabled. */
    chartFallback?: boolean;
}
export declare const YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/";
export declare function normalizeSymbol(symbol: string): string;
export declare class YahooPricesDataSource extends BaseDataSource<{
    symbol: string;
}, PriceQuote> {
    readonly name = "yahoo-prices";
    readonly kind: DataSourceKind;
    readonly provider = "yahoo";
    private readonly quoteFn;
    private readonly chartFn;
    private readonly http;
    private readonly log;
    constructor(options?: YahooPricesOptions);
    /** Basic quotes are free and unauthenticated. */
    isConfigured(): boolean;
    fetch(request: {
        symbol: string;
    }): Promise<PriceQuote>;
    quote(symbol: string): Promise<PriceQuote>;
    /** Fetch a quote from Yahoo's unauthenticated chart endpoint. */
    private chartQuote;
    /** Runs one provider and normalizes both its payload and its failures. */
    private tryProvider;
    protected probe(): Promise<void>;
}
export declare const yahooPrices: YahooPricesDataSource;
//# sourceMappingURL=yahooPrices.d.ts.map