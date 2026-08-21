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
  private inflight = new Map<string, Promise<any>>();

  /**
   * Get a value from cache or fetch it if missing/expired.
   * Deduplicates concurrent requests for the same key.
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

    // Deduplicate concurrent requests for the same key
    const existing = this.inflight.get(key);
    if (existing) {
      return existing as Promise<T>;
    }

    // Fetch fresh value
    const promise = fetch().then((value) => {
      this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
      this.inflight.delete(key);
      return value;
    }).catch((err) => {
      this.inflight.delete(key);
      throw err;
    });

    this.inflight.set(key, promise);
    return promise;
  }
}
