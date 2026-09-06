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
import { AppError } from '../lib/errors.js';
export type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage {
    role: ChatRole;
    content: string;
}
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
}
export interface ChatCompletion {
    /** Assistant text for the first (and only) generation. */
    content: string;
    /** Model that actually served the request. */
    model: string;
    /** Present only when the provider reported usage. */
    tokens?: TokenUsage;
}
export interface ChatCompleteOptions {
    /** Caller-supplied cancellation, in addition to the configured timeout. */
    signal?: AbortSignal;
}
export interface OpenAIChatModelConfig {
    /** Model name, e.g. "gpt-4-turbo". */
    model?: string;
    /** Sampling temperature, 0-2. */
    temperature?: number;
    /** Per-attempt timeout in milliseconds. */
    timeoutMs?: number;
    /** Explicit API key; overrides the secret store and environment. */
    apiKey?: string;
    /** Custom API base URL (OpenAI-compatible gateways). */
    baseUrl?: string;
    /** Retries after the initial attempt. Default 2. */
    maxRetries?: number;
}
/** Fully resolved configuration, minus the key itself. */
export interface ResolvedChatModelConfig {
    model: string;
    temperature: number;
    timeoutMs: number;
    maxRetries: number;
    baseUrl?: string;
    hasApiKey: boolean;
}
export interface ChatModel {
    readonly config: ResolvedChatModelConfig;
    complete(messages: ChatMessage[], options?: ChatCompleteOptions): Promise<ChatCompletion>;
}
/**
 * Provider seam. The default implementation is backed by `ChatOpenAI`; tests
 * inject a fake so retry and error mapping can be exercised offline.
 */
export interface ChatCompletionClient {
    generate(messages: ChatMessage[], options: ChatCompleteOptions): Promise<ChatCompletion>;
}
export interface ChatModelDeps {
    /** Build the low-level client. Overridden in tests. */
    createClient?: (config: ResolvedChatModelConfig, apiKey: string) => ChatCompletionClient;
    sleep?: (ms: number) => Promise<void>;
}
/** No API key is available from settings, the secret store, or the environment. */
export declare class LlmNotConfiguredError extends AppError {
    constructor(message?: string);
}
/** The provider rejected our credentials (401/403). */
export declare class LlmAuthError extends AppError {
    constructor(message?: string);
}
/** Rate limited or out of quota, and retries did not clear it. */
export declare class LlmRateLimitError extends AppError {
    readonly retryAfterMs?: number;
    constructor(message: string, retryAfterMs?: number);
}
/** The request exceeded the configured timeout or was aborted. */
export declare class LlmTimeoutError extends AppError {
    readonly timeoutMs: number;
    constructor(timeoutMs: number);
}
/** The caller sent something the provider refused (bad model, oversized prompt). */
export declare class LlmRequestError extends AppError {
    constructor(message: string);
}
/** Anything else: provider 5xx, network failure, malformed response. */
export declare class LlmUpstreamError extends AppError {
    constructor(message: string);
}
export declare const DEFAULT_MODEL = "gpt-4-turbo";
export declare const DEFAULT_TEMPERATURE = 0.7;
export declare const DEFAULT_TIMEOUT_MS = 30000;
export declare const DEFAULT_MAX_RETRIES = 2;
/**
 * Key precedence: explicit config → encrypted secret store (DB) → env vars.
 * DB wins over env so a key set in the UI always takes effect.
 */
export declare function resolveApiKey(explicit?: string): string | undefined;
export declare function resolveConfig(config?: OpenAIChatModelConfig): ResolvedChatModelConfig;
export type AgentKey = 'analyst' | 'portfolioManager' | 'screener';
/**
 * Resolve LLM config for a specific agent, respecting per-agent model overrides.
 * Precedence: explicit config → agent-specific override → global settings → env → defaults.
 * Empty-string agent override ('') falls back to global default, not sent literally.
 */
export declare function resolveConfigForAgent(agent: AgentKey, config?: OpenAIChatModelConfig): ResolvedChatModelConfig;
/** HTTP status, whether the SDK exposes it directly or only in the message. */
export declare function statusOf(err: unknown): number | undefined;
/** 429 and 5xx are worth another attempt; so are timeouts and transport faults. */
export declare function isRetryableLlmError(err: unknown): boolean;
/** `Retry-After` in either delta-seconds or HTTP-date form. */
export declare function parseRetryAfterMs(err: unknown): number | undefined;
/** Turn any provider failure into an `AppError` with a user-facing message. */
export declare function mapLlmError(err: unknown, timeoutMs: number): AppError;
/**
 * Build a chat model. Configuration is resolved eagerly so callers can inspect
 * `model.config`, but the API key is resolved per call — that way a key added
 * through the settings UI takes effect without recreating the model.
 */
export declare function createOpenAIChatModel(config?: OpenAIChatModelConfig, deps?: ChatModelDeps): ChatModel;
/** Convenience wrapper for a single prompt. */
export declare function promptMessages(prompt: string, system?: string): ChatMessage[];
//# sourceMappingURL=openaiChatModel.d.ts.map