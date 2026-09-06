/**
 * Per-run cache for agent tool results.
 * Avoids re-fetching identical data when multiple tools or symbols request the same information.
 */
export declare class RunCache {
    private store;
    private inflight;
    /**
     * Get a value from cache or fetch it if missing/expired.
     * Deduplicates concurrent requests for the same key.
     *
     * @param key Cache key
     * @param ttlMs Time to live in milliseconds
     * @param fetch Function that returns the value if not cached
     * @returns The cached or freshly fetched value
     */
    getOrFetch<T>(key: string, ttlMs: number, fetch: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=cache.d.ts.map