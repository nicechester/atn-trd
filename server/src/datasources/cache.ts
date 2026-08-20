/**
 * Per-run cache for agent tool results.
 * Avoids re-fetching identical data when multiple tools or symbols request the same information.
 */

interface CacheEntry {
  value: any;
  expiresAt: number;
}

export class RunCache {
  private store = new Map<string, CacheEntry>();

  /**
   * Get a value from cache or fetch it if missing/expired.
   *
   * @param key Cache key
   * @param ttlMs Time to live in milliseconds
   * @param fetch Function that returns the value if not cached
   * @returns The cached or freshly fetched value
   */
  async getOrFetch<T>(key: string, ttlMs: number, fetch: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const entry = this.store.get(key);

    // Return cached value if it exists and hasn't expired
    if (entry && entry.expiresAt > now) {
      return entry.value as T;
    }

    // Fetch fresh value
    const value = await fetch();

    // Store in cache with TTL
    this.store.set(key, {
      value,
      expiresAt: now + ttlMs,
    });

    return value;
  }
}
