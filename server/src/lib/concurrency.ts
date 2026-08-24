/**
 * Run items with bounded concurrency.
 * Distributes work evenly across a limited number of workers.
 */
export async function runWithConcurrency<T>(
  items: string[],
  limit: number,
  fn: (item: string) => Promise<T>
): Promise<T[]> {
  const results: T[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
