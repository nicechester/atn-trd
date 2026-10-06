/** Normalized news shapes shared by every news provider. */
export const DEFAULT_NEWS_LIMIT = 20;
export const NEWS_HEALTH_CHECK_SYMBOL = 'AAPL';
/** Yahoo has no "general news" endpoint; this stands in for the market feed. */
export const GENERAL_NEWS_QUERY = 'stock market';
export function normalizeNewsSymbol(symbol) {
    return symbol.trim().toUpperCase();
}
/** YYYY-MM-DD in UTC, which is what both providers expect. */
export function toIsoDate(epochMs) {
    return new Date(epochMs).toISOString().slice(0, 10);
}
export function clampLimit(limit, fallback = DEFAULT_NEWS_LIMIT) {
    if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0)
        return fallback;
    return Math.min(100, Math.floor(limit));
}
//# sourceMappingURL=types.js.map