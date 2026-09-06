/**
 * CBOE delayed-quotes fallback for the options connector (doc 02).
 *
 * Yahoo's option endpoint sits behind the cookie/crumb flow and is frequently
 * throttled; CBOE publishes the same chain as a plain, key-less JSON document.
 * The payload is large (~1.5MB, every expiry at once), so it is only used when
 * Yahoo fails, and it is filtered down to a single expiry immediately.
 */
import { HttpClient } from '../http.js';
import type { RawOptionChain } from './yahooOptions.js';
export declare const CBOE_OPTIONS_SOURCE = "cboe-options";
export declare const CBOE_BASE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/";
export interface CboeContractRaw {
    /** OSI symbol, e.g. "AAPL260821C00225000". */
    option?: string;
    bid?: number;
    ask?: number;
    iv?: number;
    open_interest?: number;
    volume?: number;
    last_trade_price?: number;
}
export interface CboeOptionsResponse {
    timestamp?: string;
    symbol?: string;
    data?: {
        symbol?: string;
        options?: CboeContractRaw[];
        current_price?: number;
        close?: number;
        prev_day_close?: number;
    };
}
export interface ParsedOsiSymbol {
    root: string;
    /** Expiration at UTC midnight, epoch ms. */
    expiration: number;
    type: 'call' | 'put';
    strike: number;
}
export declare function parseOsiSymbol(symbol: string): ParsedOsiSymbol | null;
/**
 * Reshape the CBOE document into the same intermediate chain the Yahoo path
 * produces, keeping a single normalization routine in the connector.
 */
export declare function toChain(body: CboeOptionsResponse, symbol: string, options: {
    expiration?: number;
    now: number;
}): RawOptionChain;
export declare function createCboeHttpClient(): HttpClient;
export declare function fetchCboeChain(http: HttpClient, symbol: string, options: {
    expiration?: number;
    now: number;
    signal?: AbortSignal;
}): Promise<RawOptionChain>;
//# sourceMappingURL=cboeOptions.d.ts.map