/**
 * Run items with bounded concurrency.
 * Distributes work evenly across a limited number of workers.
 */
export declare function runWithConcurrency<T>(items: string[], limit: number, fn: (item: string) => Promise<T>): Promise<T[]>;
//# sourceMappingURL=concurrency.d.ts.map