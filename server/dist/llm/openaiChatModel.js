/**
 * OpenAI chat model wrapper.
 *
 * Wraps LangChain's `ChatOpenAI` behind a narrow, typed interface so the rest
 * of the app never touches provider SDK types. Responsibilities:
 *
 *   - resolve configuration from explicit args -> stored settings -> env vars
 *   - resolve the API key from the encrypted secret store, falling back to env
 *   - retry transient failures (429 / 5xx / network) with exponential backoff,
 *     honouring `Retry-After` when the provider sends one
 *   - translate raw provider errors into `AppError` subclasses carrying
 *     user-facing messages and sensible HTTP status codes
 *
 * Retry note: the underlying `openai` SDK also retries by default. We set its
 * `maxRetries` to 0 so this wrapper is the single, observable retry layer.
 */
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AppError } from '../lib/errors.js';
import { withRetry, sleep } from '../datasources/http.js';
import { logger } from '../lib/logger.js';
import { getSettings, resolveSecret } from '../config/settingsService.js';
/* -------------------------------------------------------------------------- */
/* Errors                                                                     */
/* -------------------------------------------------------------------------- */
/** No API key is available from settings, the secret store, or the environment. */
export class LlmNotConfiguredError extends AppError {
    constructor(message = 'No OpenAI API key is configured. Add one under Settings -> Secrets (OPENAI_API_KEY) or set the OPENAI_API_KEY environment variable.') {
        super(message, 503, 'LLM_NOT_CONFIGURED');
    }
}
/** The provider rejected our credentials (401/403). */
export class LlmAuthError extends AppError {
    constructor(message = 'The OpenAI API key was rejected. Check that the key is correct and still active.') {
        super(message, 401, 'LLM_AUTH_FAILED');
    }
}
/** Rate limited or out of quota, and retries did not clear it. */
export class LlmRateLimitError extends AppError {
    retryAfterMs;
    constructor(message, retryAfterMs) {
        super(message, 429, 'LLM_RATE_LIMITED');
        this.retryAfterMs = retryAfterMs;
    }
}
/** The request exceeded the configured timeout or was aborted. */
export class LlmTimeoutError extends AppError {
    timeoutMs;
    constructor(timeoutMs) {
        super(`The model did not respond within ${timeoutMs}ms. Try a shorter prompt or raise the LLM timeout in Settings.`, 504, 'LLM_TIMEOUT');
        this.timeoutMs = timeoutMs;
    }
}
/** The caller sent something the provider refused (bad model, oversized prompt). */
export class LlmRequestError extends AppError {
    constructor(message) {
        super(message, 400, 'LLM_BAD_REQUEST');
    }
}
/** Anything else: provider 5xx, network failure, malformed response. */
export class LlmUpstreamError extends AppError {
    constructor(message) {
        super(message, 502, 'LLM_UPSTREAM_ERROR');
    }
}
/* -------------------------------------------------------------------------- */
/* Defaults and config resolution                                             */
/* -------------------------------------------------------------------------- */
export const DEFAULT_MODEL = 'gpt-4-turbo';
export const DEFAULT_TEMPERATURE = 0.7;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;
/** Never wait longer than this between attempts, even if Retry-After says so. */
const MAX_RETRY_DELAY_MS = 10_000;
const log = logger.child({ component: 'llm' });
/** Settings live in SQLite; tolerate the DB being unavailable (tests, CLI). */
function readLlmSettings() {
    try {
        return getSettings().llm;
    }
    catch (err) {
        log.debug('settings unavailable, using LLM defaults', {
            error: err instanceof Error ? err.message : String(err),
        });
        return {};
    }
}
/**
 * Key precedence: explicit config → encrypted secret store (DB) → env vars.
 * DB wins over env so a key set in the UI always takes effect.
 */
export function resolveApiKey(explicit) {
    const fromConfig = explicit?.trim();
    if (fromConfig)
        return fromConfig;
    try {
        const fromStore = resolveSecret('LLM_API_KEY')?.trim();
        if (fromStore)
            return fromStore;
    }
    catch (err) {
        log.debug('secret store unavailable for LLM_API_KEY', {
            error: err instanceof Error ? err.message : String(err),
        });
    }
    const fromEnv = process.env.OPENAI_API_KEY?.trim() || process.env.LLM_API_KEY?.trim();
    return fromEnv || undefined;
}
function resolveBaseUrl(explicit, settingsBaseUrl) {
    const candidate = explicit?.trim() || settingsBaseUrl?.trim() || process.env.LLM_API_URL?.trim();
    return candidate || undefined;
}
export function resolveConfig(config = {}) {
    const settings = readLlmSettings();
    return {
        model: config.model ?? settings.model ?? process.env.LLM_MODEL?.trim() ?? DEFAULT_MODEL,
        temperature: config.temperature ?? settings.temperature ?? DEFAULT_TEMPERATURE,
        timeoutMs: config.timeoutMs ?? settings.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
        baseUrl: resolveBaseUrl(config.baseUrl, settings.baseUrl),
        hasApiKey: resolveApiKey(config.apiKey) !== undefined,
    };
}
/**
 * Resolve LLM config for a specific agent, respecting per-agent model overrides.
 * Precedence: explicit config → agent-specific override → global settings → env → defaults.
 * Empty-string agent override ('') falls back to global default, not sent literally.
 */
export function resolveConfigForAgent(agent, config = {}) {
    const settings = readLlmSettings();
    const agentModel = settings.agents?.[agent]?.model?.trim();
    return {
        model: config.model ?? (agentModel || undefined) ?? settings.model ?? process.env.LLM_MODEL?.trim() ?? DEFAULT_MODEL,
        temperature: config.temperature ?? settings.temperature ?? DEFAULT_TEMPERATURE,
        timeoutMs: config.timeoutMs ?? settings.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
        baseUrl: resolveBaseUrl(config.baseUrl, settings.baseUrl),
        hasApiKey: resolveApiKey(config.apiKey) !== undefined,
    };
}
function asProviderError(err) {
    if (typeof err !== 'object' || err === null)
        return {};
    return err;
}
/**
 * The failing error plus its nested `cause`s. The `openai` SDK wraps transport
 * faults in `APIConnectionError` and keeps the useful detail (`fetch failed`,
 * `ECONNREFUSED`) on `cause`.
 */
function causeChain(err, depth = 4) {
    const chain = [];
    let current = err;
    for (let i = 0; i <= depth && typeof current === 'object' && current !== null; i += 1) {
        chain.push(current);
        current = current.cause;
    }
    return chain;
}
/**
 * The SDK's error subclasses do not set `name`, so it reads as "Error";
 * `constructor.name` is what actually identifies them.
 */
function isErrorNamed(err, className) {
    return causeChain(err).some((e) => e.name === className || e.constructor?.name === className);
}
function anyMessageMatches(err, pattern) {
    return causeChain(err).some((e) => pattern.test(e.message ?? ''));
}
function anyCodeMatches(err, pattern) {
    return causeChain(err).some((e) => typeof e.code === 'string' && pattern.test(e.code));
}
/** HTTP status, whether the SDK exposes it directly or only in the message. */
export function statusOf(err) {
    for (const e of causeChain(err)) {
        if (typeof e.status === 'number')
            return e.status;
    }
    // LangChain sometimes wraps the SDK error and keeps only the message. Require
    // a status-like prefix so counts in the text ("512 tokens") aren't misread.
    const message = asProviderError(err).message ?? '';
    const match = /\b(?:status(?:\s*code)?|HTTP)\D{0,3}(\d{3})\b/i.exec(message);
    return match ? Number(match[1]) : undefined;
}
function isTimeoutError(err) {
    if (isErrorNamed(err, 'AbortError') || isErrorNamed(err, 'TimeoutError'))
        return true;
    if (isErrorNamed(err, 'APIConnectionTimeoutError'))
        return true;
    if (anyCodeMatches(err, /^(ETIMEDOUT|ECONNABORTED)$/))
        return true;
    return anyMessageMatches(err, /timed? ?out|timeout|aborted/i);
}
function isConnectionError(err) {
    if (isErrorNamed(err, 'APIConnectionError'))
        return true;
    if (anyCodeMatches(err, /^(ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)$/)) {
        return true;
    }
    return anyMessageMatches(err, /connection error|fetch failed|network|socket hang up/i);
}
/** 429 and 5xx are worth another attempt; so are timeouts and transport faults. */
export function isRetryableLlmError(err) {
    if (err instanceof LlmNotConfiguredError || err instanceof LlmAuthError)
        return false;
    if (err instanceof LlmRequestError)
        return false;
    if (err instanceof LlmRateLimitError)
        return true;
    if (err instanceof LlmTimeoutError || err instanceof LlmUpstreamError)
        return true;
    const status = statusOf(err);
    if (status !== undefined)
        return status === 408 || status === 409 || status === 429 || status >= 500;
    return isTimeoutError(err) || isConnectionError(err);
}
function headerValue(headers, name) {
    if (!headers)
        return undefined;
    if (typeof headers.get === 'function') {
        return headers.get(name) ?? undefined;
    }
    if (typeof headers === 'object') {
        const record = headers;
        const hit = Object.entries(record).find(([k]) => k.toLowerCase() === name.toLowerCase());
        return typeof hit?.[1] === 'string' ? hit[1] : undefined;
    }
    return undefined;
}
/** `Retry-After` in either delta-seconds or HTTP-date form. */
export function parseRetryAfterMs(err) {
    if (err instanceof LlmRateLimitError)
        return err.retryAfterMs;
    const raw = headerValue(asProviderError(err).headers, 'retry-after');
    if (!raw)
        return undefined;
    const seconds = Number(raw);
    if (Number.isFinite(seconds))
        return Math.max(0, Math.round(seconds * 1000));
    const date = Date.parse(raw);
    if (Number.isFinite(date))
        return Math.max(0, date - Date.now());
    return undefined;
}
function providerMessage(err) {
    const e = asProviderError(err);
    return e.error?.message ?? e.message ?? 'Unknown error';
}
/** Turn any provider failure into an `AppError` with a user-facing message. */
export function mapLlmError(err, timeoutMs) {
    if (err instanceof AppError)
        return err;
    if (isTimeoutError(err))
        return new LlmTimeoutError(timeoutMs);
    const status = statusOf(err);
    if (status === 401 || status === 403)
        return new LlmAuthError();
    if (status === 429) {
        const retryAfterMs = parseRetryAfterMs(err);
        const insufficientQuota = /quota|billing/i.test(providerMessage(err));
        return new LlmRateLimitError(insufficientQuota
            ? 'The OpenAI account has no remaining quota. Check the billing plan for this API key.'
            : 'OpenAI is rate limiting this API key. Retries were exhausted; try again in a moment.', retryAfterMs);
    }
    if (status === 404) {
        return new LlmRequestError(`The configured model is not available to this API key: ${providerMessage(err)}`);
    }
    if (status === 400 || status === 413 || status === 422) {
        return new LlmRequestError(`OpenAI rejected the request: ${providerMessage(err)}`);
    }
    if (status !== undefined && status >= 500) {
        return new LlmUpstreamError('OpenAI is currently unavailable. Retries were exhausted; try again shortly.');
    }
    if (isConnectionError(err)) {
        return new LlmUpstreamError('Could not reach OpenAI. Check network connectivity and the API base URL.');
    }
    return new LlmUpstreamError(`The model call failed: ${providerMessage(err)}`);
}
/* -------------------------------------------------------------------------- */
/* Default client (LangChain ChatOpenAI)                                      */
/* -------------------------------------------------------------------------- */
function toLangChainMessage(message) {
    switch (message.role) {
        case 'system':
            return new SystemMessage(message.content);
        case 'assistant':
            return new AIMessage(message.content);
        case 'user':
            return new HumanMessage(message.content);
        default: {
            const exhaustive = message.role;
            throw new LlmRequestError(`Unsupported message role: ${String(exhaustive)}`);
        }
    }
}
function toTokenUsage(raw) {
    if (!raw)
        return undefined;
    const inputTokens = raw.promptTokens;
    const outputTokens = raw.completionTokens;
    if (typeof inputTokens !== 'number' && typeof outputTokens !== 'number')
        return undefined;
    const input = inputTokens ?? 0;
    const output = outputTokens ?? 0;
    return {
        inputTokens: input,
        outputTokens: output,
        totalTokens: raw.totalTokens ?? input + output,
    };
}
function createChatOpenAIClient(config, apiKey) {
    const chat = new ChatOpenAI({
        apiKey,
        model: config.model,
        temperature: config.temperature,
        timeout: config.timeoutMs,
        // This wrapper owns retries; don't let the SDK retry underneath us.
        maxRetries: 0,
        ...(config.baseUrl ? { configuration: { baseURL: config.baseUrl } } : {}),
    });
    return {
        async generate(messages, options) {
            const result = await chat.generate([messages.map(toLangChainMessage)], options.signal ? { signal: options.signal } : undefined);
            const generation = result.generations[0]?.[0];
            if (!generation) {
                throw new LlmUpstreamError('OpenAI returned an empty response.');
            }
            const llmOutput = result.llmOutput;
            return {
                content: generation.text,
                model: config.model,
                tokens: toTokenUsage(llmOutput?.tokenUsage),
            };
        },
    };
}
/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */
/**
 * Build a chat model. Configuration is resolved eagerly so callers can inspect
 * `model.config`, but the API key is resolved per call — that way a key added
 * through the settings UI takes effect without recreating the model.
 */
export function createOpenAIChatModel(config = {}, deps = {}) {
    const resolved = resolveConfig(config);
    const createClient = deps.createClient ?? createChatOpenAIClient;
    const sleepFn = deps.sleep ?? sleep;
    async function complete(messages, options = {}) {
        if (messages.length === 0) {
            throw new LlmRequestError('At least one message is required.');
        }
        const apiKey = resolveApiKey(config.apiKey);
        if (!apiKey)
            throw new LlmNotConfiguredError();
        log.debug('starting model call', {
            model: resolved.model,
            baseUrl: resolved.baseUrl ?? '(openai default)',
        });
        const client = createClient(resolved, apiKey);
        // `withRetry` calls onRetry immediately before sleeping, so capturing the
        // provider's Retry-After there lets the injected sleep honour it.
        let retryAfterMs;
        const retryOptions = {
            retries: resolved.maxRetries,
            isRetryable: isRetryableLlmError,
            onRetry: ({ attempt, delayMs, error }) => {
                retryAfterMs = parseRetryAfterMs(error);
                log.warn('retrying model call', {
                    model: resolved.model,
                    baseUrl: resolved.baseUrl ?? '(openai default)',
                    attempt,
                    delayMs: retryAfterMs ?? delayMs,
                    status: statusOf(error),
                    error: error instanceof Error ? error.message : String(error),
                });
            },
            sleep: async (delayMs) => {
                const wait = Math.min(retryAfterMs ?? delayMs, MAX_RETRY_DELAY_MS);
                retryAfterMs = undefined;
                await sleepFn(wait);
            },
        };
        try {
            return await withRetry(() => client.generate(messages, options), retryOptions);
        }
        catch (err) {
            throw mapLlmError(err, resolved.timeoutMs);
        }
    }
    return { config: resolved, complete };
}
/** Convenience wrapper for a single prompt. */
export function promptMessages(prompt, system) {
    const messages = [];
    if (system)
        messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    return messages;
}
//# sourceMappingURL=openaiChatModel.js.map