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

export const DEFAULT_NEWS_LIMIT = 20;
export const NEWS_HEALTH_CHECK_SYMBOL = 'AAPL';

/** Yahoo has no "general news" endpoint; this stands in for the market feed. */
export const GENERAL_NEWS_QUERY = 'stock market';

export function normalizeNewsSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/** YYYY-MM-DD in UTC, which is what both providers expect. */
export function toIsoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function clampLimit(limit: number | undefined, fallback = DEFAULT_NEWS_LIMIT): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(100, Math.floor(limit));
}
