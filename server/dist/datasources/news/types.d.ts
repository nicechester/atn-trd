/** Normalized news shapes shared by every news provider. */
export interface NewsQuery {
    /** Company news when set; general market news when omitted. */
    symbol?: string;
    /** Inclusive YYYY-MM-DD lower bound (company news only). */
    from?: string;
    /** Inclusive YYYY-MM-DD upper bound (company news only). */
    to?: string;
    /** Maximum articles to return. Default 20. */
    limit?: number;
}
export interface NewsArticle {
    id: string;
    headline: string;
    summary: string;
    url: string;
    /** Publisher name as reported by the provider. */
    source: string;
    /** Epoch milliseconds. */
    publishedAt: number;
    /** Tickers the provider associated with the article. */
    symbols: string[];
    imageUrl: string | null;
}
export interface NewsSentiment {
    symbol: string;
    /** Provider-computed bullishness of recent coverage, 0..1. */
    companyNewsScore: number | null;
    bullishPercent: number | null;
    bearishPercent: number | null;
    sectorAverageBullishPercent: number | null;
    articlesInLastWeek: number | null;
}
export interface NewsPayload {
    /** Null for general market news. */
    symbol: string | null;
    articles: NewsArticle[];
    /** Null when the provider (or plan tier) exposes no sentiment. */
    sentiment: NewsSentiment | null;
    /** Non-fatal degradations, e.g. sentiment unavailable on the free plan. */
    warnings: string[];
}
export declare const DEFAULT_NEWS_LIMIT = 20;
export declare const NEWS_HEALTH_CHECK_SYMBOL = "AAPL";
/** Yahoo has no "general news" endpoint; this stands in for the market feed. */
export declare const GENERAL_NEWS_QUERY = "stock market";
export declare function normalizeNewsSymbol(symbol: string): string;
/** YYYY-MM-DD in UTC, which is what both providers expect. */
export declare function toIsoDate(epochMs: number): string;
export declare function clampLimit(limit: number | undefined, fallback?: number): number;
//# sourceMappingURL=types.d.ts.map