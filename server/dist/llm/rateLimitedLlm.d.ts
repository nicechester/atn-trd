/**
 * Rate-limited LLM singleton with shared cooldown queue.
 *
 * All agents share this instance. When any caller hits a 429 rate limit,
 * all concurrent callers wait on the same cooldown promise, then retry together.
 *
 * Features:
 * - Exponential backoff starting at 60s, max 5 retries
 * - Parses retry delay from Gemini 429 response (uses longer of parsed or base)
 * - Shared cooldown prevents wasted API calls during rate limit window
 */
import { BaseChatModel, type BaseChatModelCallOptions } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
interface RateLimitedLlmConfig {
    baseDelayMs?: number;
    maxRetries?: number;
}
declare class RateLimitedLlm extends BaseChatModel<BaseChatModelCallOptions> {
    private llm;
    private baseDelayMs;
    private maxRetries;
    constructor(llm: BaseChatModel, config?: RateLimitedLlmConfig);
    _llmType(): string;
    /** Bind tools to the underlying LLM */
    bindTools(tools: any[], kwargs?: any): BaseChatModel;
    /**
     * Core generation method - all LLM calls go through here.
     * Implements blocking queue with retry logic.
     */
    _generate(messages: BaseMessage[], options: this['ParsedCallOptions'], runManager?: CallbackManagerForLLMRun): Promise<ChatResult>;
}
/**
 * Get or create the singleton rate-limited LLM instance.
 * Recreates if model changes.
 */
export declare function getRateLimitedLlm(): RateLimitedLlm;
/**
 * Get synthesis LLM - returns the same singleton.
 * Temperature differences are minor; using same instance ensures queue is respected.
 */
export declare function getSynthesisLlm(): RateLimitedLlm;
/** Reset singleton (for testing) */
export declare function resetRateLimitedLlm(): void;
/** Check if model is Gemini */
export declare function isGeminiModel(): boolean;
export {};
//# sourceMappingURL=rateLimitedLlm.d.ts.map