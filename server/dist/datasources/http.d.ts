/**
 * Shared outbound HTTP plumbing for data sources: a token-bucket rate limiter,
 * exponential-backoff retries, and a thin fetch wrapper that combines both.
 *
 * `HttpClient.run()` exposes the same rate-limit + retry envelope to sources
 * that talk to a provider through a third-party SDK rather than raw fetch.
 */
import { UpstreamError } from '../lib/errors.js';
export declare function sleep(ms: number): Promise<void>;
export interface TokenBucketOptions {
    /** Maximum burst size. */
    capacity: number;
    /** Sustained rate at which tokens are replenished. */
    refillPerSecond: number;
    /** Initial token count; defaults to a full bucket. */
    initialTokens?: number;
    /** Injectable clock (tests). */
    now?: () => number;
    /** Injectable sleep (tests). */
    sleep?: (ms: number) => Promise<void>;
}
/**
 * Classic token bucket. `take()` resolves as soon as enough tokens exist,
 * otherwise it waits for them to refill. Waiters are served FIFO so a burst of
 * concurrent callers cannot starve each other.
 */
export declare class TokenBucket {
    readonly capacity: number;
    readonly refillPerSecond: number;
    private tokens;
    private lastRefillAt;
    private tail;
    private readonly nowFn;
    private readonly sleepFn;
    constructor(options: TokenBucketOptions);
    /** Tokens currently available (after accounting for elapsed refill time). */
    get available(): number;
    take(count?: number): Promise<void>;
    private acquire;
    private refill;
}
/**
 * Bound an arbitrary async call in wall-clock time. `HttpClient` already times
 * out its own fetches; this is for SDK-backed sources (yahoo-finance2) whose
 * internal I/O we cannot abort directly — hence the race rather than a plain
 * `AbortSignal`.
 */
export declare function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, label: string, externalSignal?: AbortSignal): Promise<T>;
export declare class HttpError extends UpstreamError {
    readonly status: number;
    readonly url: string;
    readonly body?: string;
    constructor(status: number, url: string, source?: string, body?: string);
}
/**
 * Default retry policy: transport-level failures and 408/425/429/5xx are worth
 * another attempt; deterministic 4xx responses and application errors are not.
 */
export declare function isRetryableError(err: unknown): boolean;
export interface RetryOptions {
    /** Number of retries after the initial attempt. Default 2. */
    retries?: number;
    /** Delay before the first retry. Default 250ms. */
    baseDelayMs?: number;
    /** Upper bound on any single backoff delay. Default 4000ms. */
    maxDelayMs?: number;
    /** Backoff multiplier. Default 2. */
    factor?: number;
    /** Apply full jitter to each delay. Default true. */
    jitter?: boolean;
    isRetryable?: (err: unknown) => boolean;
    onRetry?: (info: {
        attempt: number;
        delayMs: number;
        error: unknown;
    }) => void;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
}
export declare function computeBackoffDelay(attempt: number, options?: Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'factor' | 'jitter' | 'random'>): number;
export declare function withRetry<T>(fn: (attempt: number) => Promise<T>, options?: RetryOptions): Promise<T>;
export interface HttpClientOptions {
    /** Identifier used in logs and upstream errors. */
    name: string;
    baseUrl?: string;
    /** Per-attempt timeout. Default 10s. */
    timeoutMs?: number;
    defaultHeaders?: Record<string, string>;
    rateLimit?: TokenBucket | TokenBucketOptions;
    retry?: RetryOptions;
    fetchImpl?: typeof fetch;
}
export declare class HttpClient {
    readonly name: string;
    readonly bucket: TokenBucket;
    private readonly baseUrl?;
    private readonly timeoutMs;
    private readonly defaultHeaders;
    private readonly retryOptions;
    private readonly fetchImpl;
    private readonly log;
    constructor(options: HttpClientOptions);
    /**
     * Run an arbitrary async operation under this client's rate limit and retry
     * policy. Used by SDK-backed data sources (e.g. yahoo-finance2) so they share
     * the same throttling budget as raw fetch calls.
     */
    run<T>(fn: (attempt: number) => Promise<T>, overrides?: RetryOptions): Promise<T>;
    request(path: string, init?: RequestInit, retryOverrides?: RetryOptions): Promise<Response>;
    json<T>(path: string, init?: RequestInit, retryOverrides?: RetryOptions): Promise<T>;
    private resolveUrl;
}
//# sourceMappingURL=http.d.ts.map