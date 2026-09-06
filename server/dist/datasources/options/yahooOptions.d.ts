/**
 * Yahoo options connector.
 *
 * `options(symbol)` returns the full chain for the nearest expiry plus every
 * listed expiration date; needs no API key. Everything downstream of the raw
 * chain (put/call ratios, max pain, IV skew, OpEx calendar) is derived locally
 * by `optionsCalendar.ts` — no extra API calls.
 */
import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { HttpClient } from '../http.js';
import { type MaybeDate, type MaybeNumber } from '../coerce.js';
import { type ExpiryCalendar, type OptionContract, type OptionsMetrics } from './optionsCalendar.js';
export declare const YAHOO_OPTIONS_SOURCE = "yahoo-options";
export declare const OPTIONS_HEALTH_CHECK_SYMBOL = "AAPL";
export interface OptionsQuery {
    symbol: string;
    /** Specific expiration (epoch ms). Defaults to the nearest listed expiry. */
    expiration?: number;
}
export interface OptionsPayload {
    symbol: string;
    underlyingPrice: number | null;
    /** Expiration this chain belongs to, epoch ms. */
    expiration: number | null;
    /** Every expiry the provider lists for the symbol, epoch ms. */
    expirationDates: number[];
    calls: OptionContract[];
    puts: OptionContract[];
    metrics: OptionsMetrics;
    calendar: ExpiryCalendar;
    /** Which upstream actually served the chain. */
    servedBy: OptionsServedBy;
}
export type OptionsServedBy = 'yahoo' | 'cboe';
export interface YahooOptionContractRaw {
    contractSymbol?: string;
    strike?: MaybeNumber;
    lastPrice?: MaybeNumber;
    bid?: MaybeNumber;
    ask?: MaybeNumber;
    volume?: MaybeNumber;
    openInterest?: MaybeNumber;
    impliedVolatility?: MaybeNumber;
    inTheMoney?: boolean;
    expiration?: MaybeDate;
}
export interface YahooOptionsRaw {
    underlyingSymbol?: string;
    expirationDates?: MaybeDate[];
    strikes?: number[];
    quote?: {
        regularMarketPrice?: MaybeNumber;
    };
    options?: Array<{
        expirationDate?: MaybeDate;
        calls?: YahooOptionContractRaw[];
        puts?: YahooOptionContractRaw[];
    }>;
}
/** Intermediate chain shape both the Yahoo and CBOE paths normalize into. */
export type RawOptionChain = YahooOptionsRaw;
export type YahooOptionsFn = (symbol: string, query: {
    date?: Date;
}) => Promise<YahooOptionsRaw | null | undefined>;
export type CboeOptionsFn = (symbol: string, query: {
    expiration?: number;
    signal?: AbortSignal;
}) => Promise<RawOptionChain>;
export interface YahooOptionsOptions {
    /** Override the provider call (tests). */
    optionsFn?: YahooOptionsFn;
    /** Override the CBOE fallback call (tests). */
    cboeFn?: CboeOptionsFn;
    /** Disable the key-less CBOE fallback. Default enabled. */
    cboeFallback?: boolean;
    http?: HttpClient;
    timeoutMs?: number;
    now?: () => number;
}
export declare class YahooOptionsDataSource extends BaseDataSource<OptionsQuery, DataSourceResult<OptionsPayload>> {
    readonly name = "yahoo-options";
    readonly kind: DataSourceKind;
    readonly provider = "yahoo";
    private readonly optionsFn;
    private readonly cboeFn;
    private readonly http;
    private readonly timeoutMs;
    private readonly now;
    private cboeHttp;
    private readonly log;
    constructor(options?: YahooOptionsOptions);
    /** Public Yahoo data: no credentials required. */
    isConfigured(): boolean;
    fetch(query: OptionsQuery, ctx?: FetchContext): Promise<DataSourceResult<OptionsPayload>>;
    /** Lazily built so the CBOE client only exists once the fallback is used. */
    private cboeChain;
    private normalize;
    private normalizeExpiration;
    private load;
    private toPayload;
    private toContracts;
    protected probe(): Promise<string>;
    /** Public method to normalize a raw chain (used by index fallback). */
    normalizeChain(raw: RawOptionChain, symbol: string, fetchedAt: number): DataSourceResult<OptionsPayload>;
}
//# sourceMappingURL=yahooOptions.d.ts.map