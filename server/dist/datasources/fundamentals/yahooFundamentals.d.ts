/**
 * Yahoo fundamentals connector.
 *
 * `quoteSummary(symbol, { modules: [...] })` in one call gives valuation,
 * margins, growth, balance-sheet ratios and — importantly for the risk
 * engine's earnings-blackout rule — `calendarEvents.earnings.earningsDate`.
 *
 * Needs no API key. The SDK does its own I/O, so calls are wrapped in the
 * shared token bucket + retry envelope and an explicit wall-clock timeout.
 */
import { BaseDataSource, type DataSourceKind, type DataSourceResult, type FetchContext } from '../types.js';
import { HttpClient } from '../http.js';
import { type MaybeDate, type MaybeNumber } from '../coerce.js';
export declare const YAHOO_FUNDAMENTALS_SOURCE = "yahoo-fundamentals";
export declare const FUNDAMENTALS_HEALTH_CHECK_SYMBOL = "AAPL";
export declare const QUOTE_SUMMARY_MODULES: readonly ["price", "summaryDetail", "defaultKeyStatistics", "financialData", "earnings", "calendarEvents", "assetProfile"];
export interface EarningsQuarter {
    /** Yahoo's period label, e.g. "2Q2026". */
    period: string;
    actual: number | null;
    estimate: number | null;
}
export interface FundamentalsEarnings {
    /** Next scheduled report, epoch ms. Null when Yahoo has no date yet. */
    nextEarningsDate: number | null;
    /** Every date Yahoo lists (a range when unconfirmed), epoch ms. */
    earningsDates: number[];
    estimateAverage: number | null;
    estimateLow: number | null;
    estimateHigh: number | null;
    exDividendDate: number | null;
    dividendDate: number | null;
    recentQuarters: EarningsQuarter[];
}
export interface FundamentalsPayload {
    symbol: string;
    name: string | null;
    currency: string | null;
    price: number | null;
    marketCap: number | null;
    enterpriseValue: number | null;
    trailingPE: number | null;
    forwardPE: number | null;
    pegRatio: number | null;
    priceToBook: number | null;
    trailingEps: number | null;
    forwardEps: number | null;
    beta: number | null;
    dividendYield: number | null;
    profitMargins: number | null;
    grossMargins: number | null;
    operatingMargins: number | null;
    revenueGrowth: number | null;
    earningsGrowth: number | null;
    returnOnEquity: number | null;
    returnOnAssets: number | null;
    debtToEquity: number | null;
    currentRatio: number | null;
    quickRatio: number | null;
    totalRevenue: number | null;
    totalCash: number | null;
    totalDebt: number | null;
    freeCashflow: number | null;
    targetMeanPrice: number | null;
    recommendationKey: string | null;
    sector: string | null;
    industry: string | null;
    averageVolume: number | null;
    earnings: FundamentalsEarnings;
}
export interface FundamentalsQuery {
    symbol: string;
}
export interface QuoteSummaryRaw {
    price?: {
        longName?: string;
        shortName?: string;
        currency?: string;
        regularMarketPrice?: MaybeNumber;
    };
    summaryDetail?: {
        trailingPE?: MaybeNumber;
        forwardPE?: MaybeNumber;
        marketCap?: MaybeNumber;
        beta?: MaybeNumber;
        dividendYield?: MaybeNumber;
        averageVolume?: MaybeNumber;
    };
    assetProfile?: {
        sector?: string;
        industry?: string;
    };
    defaultKeyStatistics?: {
        enterpriseValue?: MaybeNumber;
        pegRatio?: MaybeNumber;
        priceToBook?: MaybeNumber;
        trailingEps?: MaybeNumber;
        forwardEps?: MaybeNumber;
        profitMargins?: MaybeNumber;
        beta?: MaybeNumber;
    };
    financialData?: {
        currentPrice?: MaybeNumber;
        targetMeanPrice?: MaybeNumber;
        recommendationKey?: string;
        returnOnEquity?: MaybeNumber;
        returnOnAssets?: MaybeNumber;
        debtToEquity?: MaybeNumber;
        revenueGrowth?: MaybeNumber;
        earningsGrowth?: MaybeNumber;
        grossMargins?: MaybeNumber;
        operatingMargins?: MaybeNumber;
        profitMargins?: MaybeNumber;
        currentRatio?: MaybeNumber;
        quickRatio?: MaybeNumber;
        totalRevenue?: MaybeNumber;
        totalCash?: MaybeNumber;
        totalDebt?: MaybeNumber;
        freeCashflow?: MaybeNumber;
        financialCurrency?: string;
    };
    earnings?: {
        earningsChart?: {
            quarterly?: Array<{
                date?: string | number;
                actual?: MaybeNumber;
                estimate?: MaybeNumber;
            }>;
        };
    };
    calendarEvents?: {
        earnings?: {
            earningsDate?: MaybeDate[];
            earningsAverage?: MaybeNumber;
            earningsLow?: MaybeNumber;
            earningsHigh?: MaybeNumber;
        };
        exDividendDate?: MaybeDate;
        dividendDate?: MaybeDate;
    };
}
export type QuoteSummaryFn = (symbol: string, modules: readonly string[]) => Promise<QuoteSummaryRaw | null | undefined>;
export interface YahooFundamentalsOptions {
    /** Override the provider call (tests). */
    quoteSummaryFn?: QuoteSummaryFn;
    /** Override the rate-limit / retry envelope. */
    http?: HttpClient;
    timeoutMs?: number;
    now?: () => number;
}
export declare class YahooFundamentalsDataSource extends BaseDataSource<FundamentalsQuery, DataSourceResult<FundamentalsPayload>> {
    readonly name = "yahoo-fundamentals";
    readonly kind: DataSourceKind;
    readonly provider = "yahoo";
    private readonly quoteSummaryFn;
    private readonly http;
    private readonly timeoutMs;
    private readonly now;
    private readonly log;
    constructor(options?: YahooFundamentalsOptions);
    /** Public Yahoo data: no credentials required. */
    isConfigured(): boolean;
    fetch(query: FundamentalsQuery, ctx?: FetchContext): Promise<DataSourceResult<FundamentalsPayload>>;
    private normalize;
    private load;
    private toPayload;
    private toEarnings;
    protected probe(): Promise<string>;
}
//# sourceMappingURL=yahooFundamentals.d.ts.map