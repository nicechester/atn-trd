/**
 * Shared outbound HTTP plumbing for data sources: a token-bucket rate limiter,
 * exponential-backoff retries, and a thin fetch wrapper that combines both.
 *
 * `HttpClient.run()` exposes the same rate-limit + retry envelope to sources
 * that talk to a provider through a third-party SDK rather than raw fetch.
 */
import { AppError, UpstreamError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
export function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, Math.max(0, ms));
    });
}
/**
 * Classic token bucket. `take()` resolves as soon as enough tokens exist,
 * otherwise it waits for them to refill. Waiters are served FIFO so a burst of
 * concurrent callers cannot starve each other.
 */
export class TokenBucket {
    capacity;
    refillPerSecond;
    tokens;
    lastRefillAt;
    tail = Promise.resolve();
    nowFn;
    sleepFn;
    constructor(options) {
        if (options.capacity <= 0) {
            throw new Error('TokenBucket capacity must be > 0');
        }
        if (options.refillPerSecond <= 0) {
            throw new Error('TokenBucket refillPerSecond must be > 0');
        }
        this.capacity = options.capacity;
        this.refillPerSecond = options.refillPerSecond;
        this.nowFn = options.now ?? Date.now;
        this.sleepFn = options.sleep ?? sleep;
        this.tokens = options.initialTokens ?? options.capacity;
        this.lastRefillAt = this.nowFn();
    }
    /** Tokens currently available (after accounting for elapsed refill time). */
    get available() {
        this.refill();
        return this.tokens;
    }
    async take(count = 1) {
        if (count > this.capacity) {
            throw new Error(`Requested ${count} tokens but bucket capacity is ${this.capacity}`);
        }
        const run = this.tail.then(() => this.acquire(count));
        // Keep the chain alive even if a waiter rejects.
        this.tail = run.catch(() => undefined);
        return run;
    }
    async acquire(count) {
        for (;;) {
            this.refill();
            if (this.tokens >= count) {
                this.tokens -= count;
                return;
            }
            const deficit = count - this.tokens;
            const waitMs = Math.ceil((deficit / this.refillPerSecond) * 1000);
            await this.sleepFn(waitMs);
        }
    }
    refill() {
        const now = this.nowFn();
        const elapsedMs = now - this.lastRefillAt;
        if (elapsedMs <= 0)
            return;
        this.lastRefillAt = now;
        this.tokens = Math.min(this.capacity, this.tokens + (elapsedMs / 1000) * this.refillPerSecond);
    }
}
/* -------------------------------------------------------------------------- */
/* Timeout                                                                    */
/* -------------------------------------------------------------------------- */
/**
 * Bound an arbitrary async call in wall-clock time. `HttpClient` already times
 * out its own fetches; this is for SDK-backed sources (yahoo-finance2) whose
 * internal I/O we cannot abort directly — hence the race rather than a plain
 * `AbortSignal`.
 */
export async function withTimeout(fn, timeoutMs, label, externalSignal) {
    const controller = new AbortController();
    const abortExternal = () => controller.abort();
    externalSignal?.addEventListener('abort', abortExternal, { once: true });
    let timer;
    const expiry = new Promise((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            const err = new Error(`${label} timed out after ${timeoutMs}ms`);
            err.name = 'TimeoutError';
            reject(err);
        }, timeoutMs);
    });
    try {
        return await Promise.race([fn(controller.signal), expiry]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
        externalSignal?.removeEventListener('abort', abortExternal);
    }
}
/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */
export class HttpError extends UpstreamError {
    status;
    url;
    body;
    constructor(status, url, source, body) {
        super(`HTTP ${status} from ${url}`, source);
        this.status = status;
        this.url = url;
        this.body = body;
    }
}
const RETRYABLE_MESSAGE = /(too many requests|rate limit|timeout|timed out|socket|network|econn|eai_again|enotfound|fetch failed)/i;
/**
 * Default retry policy: transport-level failures and 408/425/429/5xx are worth
 * another attempt; deterministic 4xx responses and application errors are not.
 */
export function isRetryableError(err) {
    if (err instanceof HttpError) {
        return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
    }
    if (err instanceof AppError) {
        return err.statusCode >= 500;
    }
    if (err instanceof Error) {
        if (err.name === 'AbortError' || err.name === 'TimeoutError')
            return true;
        const code = err.code;
        if (code && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)$/.test(code)) {
            return true;
        }
        return RETRYABLE_MESSAGE.test(err.message);
    }
    return false;
}
export function computeBackoffDelay(attempt, options = {}) {
    const base = options.baseDelayMs ?? 250;
    const max = options.maxDelayMs ?? 4000;
    const factor = options.factor ?? 2;
    const raw = Math.min(max, base * Math.pow(factor, Math.max(0, attempt - 1)));
    if (options.jitter === false)
        return raw;
    const random = options.random ?? Math.random;
    return Math.round(raw * (0.5 + random() * 0.5));
}
export async function withRetry(fn, options = {}) {
    const retries = options.retries ?? 2;
    const retryable = options.isRetryable ?? isRetryableError;
    const sleepFn = options.sleep ?? sleep;
    let lastError;
    for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
        try {
            return await fn(attempt);
        }
        catch (err) {
            lastError = err;
            if (attempt > retries || !retryable(err))
                break;
            const delayMs = computeBackoffDelay(attempt, options);
            options.onRetry?.({ attempt, delayMs, error: err });
            await sleepFn(delayMs);
        }
    }
    throw lastError;
}
export class HttpClient {
    name;
    bucket;
    baseUrl;
    timeoutMs;
    defaultHeaders;
    retryOptions;
    fetchImpl;
    log = logger.child({ component: 'http' });
    constructor(options) {
        this.name = options.name;
        this.baseUrl = options.baseUrl;
        this.timeoutMs = options.timeoutMs ?? 10_000;
        this.defaultHeaders = options.defaultHeaders ?? {};
        this.retryOptions = options.retry ?? {};
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.bucket =
            options.rateLimit instanceof TokenBucket
                ? options.rateLimit
                : new TokenBucket(options.rateLimit ?? { capacity: 5, refillPerSecond: 2 });
    }
    /**
     * Run an arbitrary async operation under this client's rate limit and retry
     * policy. Used by SDK-backed data sources (e.g. yahoo-finance2) so they share
     * the same throttling budget as raw fetch calls.
     */
    async run(fn, overrides = {}) {
        const retryOptions = {
            ...this.retryOptions,
            ...overrides,
            onRetry: (info) => {
                this.log.warn('retrying upstream call', {
                    source: this.name,
                    attempt: info.attempt,
                    delayMs: info.delayMs,
                    error: info.error instanceof Error ? info.error.message : String(info.error),
                });
                this.retryOptions.onRetry?.(info);
                overrides.onRetry?.(info);
            },
        };
        return withRetry(async (attempt) => {
            await this.bucket.take();
            return fn(attempt);
        }, retryOptions);
    }
    async request(path, init = {}, retryOverrides = {}) {
        const url = this.resolveUrl(path);
        return this.run(async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeoutMs);
            const startedAt = Date.now();
            try {
                const res = await this.fetchImpl(url, {
                    ...init,
                    headers: { ...this.defaultHeaders, ...init.headers },
                    signal: controller.signal,
                });
                if (!res.ok) {
                    const body = await res.text().catch(() => undefined);
                    throw new HttpError(res.status, url, this.name, body?.slice(0, 512));
                }
                this.log.debug('upstream request ok', {
                    source: this.name,
                    url,
                    status: res.status,
                    durationMs: Date.now() - startedAt,
                });
                return res;
            }
            finally {
                clearTimeout(timer);
            }
        }, retryOverrides);
    }
    async json(path, init = {}, retryOverrides = {}) {
        const res = await this.request(path, init, retryOverrides);
        return (await res.json());
    }
    resolveUrl(path) {
        if (!this.baseUrl)
            return path;
        if (/^https?:\/\//i.test(path))
            return path;
        return new URL(path.replace(/^\//, ''), this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`).toString();
    }
}
//# sourceMappingURL=http.js.map