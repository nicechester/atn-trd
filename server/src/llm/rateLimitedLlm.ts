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

import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import { resolveConfigForAgent, resolveApiKey, LlmNotConfiguredError } from './openaiChatModel.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'rate-limited-llm' });

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

interface RateLimitedLlmConfig {
  baseDelayMs?: number;
  maxRetries?: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse retry delay from Gemini 429 error message.
 * Example: "Please retry in 18.65574633s"
 */
function parseRetryDelay(err: unknown): number | undefined {
  const message = err instanceof Error ? err.message : String(err);
  
  // Match "retry in Xs" or "retryDelay":"Xs"
  const match = message.match(/retry\s+in\s+([\d.]+)s|"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (match) {
    const seconds = parseFloat(match[1] || match[2]);
    if (!isNaN(seconds)) {
      return Math.ceil(seconds * 1000);
    }
  }
  return undefined;
}

function is429Error(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('429') || message.includes('Too Many Requests') || message.includes('rate limit');
}

/* -------------------------------------------------------------------------- */
/* RateLimitedLlm Class                                                       */
/* -------------------------------------------------------------------------- */

class RateLimitedLlm {
  private llm: BaseChatModel;
  private waitPromise: Promise<void> | null = null;
  private baseDelayMs: number;
  private maxRetries: number;

  constructor(llm: BaseChatModel, config: RateLimitedLlmConfig = {}) {
    this.llm = llm;
    this.baseDelayMs = config.baseDelayMs ?? 60_000; // 60s base delay for Gemini free tier
    this.maxRetries = config.maxRetries ?? 5;
  }

  /**
   * Get the underlying LLM for operations that need direct access
   * (e.g., createReactAgent, streamEvents)
   */
  get baseLlm(): BaseChatModel {
    return this.llm;
  }

  /**
   * Invoke with rate limit handling and shared cooldown queue.
   */
  async invoke(messages: BaseMessage[]): Promise<any> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      // Wait if someone else triggered cooldown
      if (this.waitPromise) {
        log.debug('waiting for shared cooldown', { attempt });
        await this.waitPromise;
      }

      try {
        return await this.llm.invoke(messages);
      } catch (err) {
        if (!is429Error(err)) {
          throw err;
        }

        if (attempt === this.maxRetries - 1) {
          log.error('max retries exceeded for rate limit', { attempt });
          throw err;
        }

        // Only set cooldown if not already set (first caller to hit 429 wins)
        if (!this.waitPromise) {
          const parsedDelay = parseRetryDelay(err);
          const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
          // Use the longer of parsed delay or exponential backoff
          const delay = Math.max(parsedDelay ?? 0, exponentialDelay);
          
          log.warn('rate limited, backing off', { 
            attempt, 
            delayMs: delay,
            parsedFromResponse: parsedDelay,
            exponentialDelay,
          });

          this.waitPromise = sleep(delay).then(() => {
            this.waitPromise = null;
          });
        }

        // Always wait on the shared promise
        await this.waitPromise;
      }
    }

    throw new Error('Max retries exceeded');
  }

  /**
   * Stream events with rate limit handling.
   * Note: Streaming is harder to retry mid-stream, so we only handle
   * initial connection failures.
   */
  async *streamEvents(
    input: { messages: BaseMessage[] },
    config: { version: string; recursionLimit: number }
  ): AsyncGenerator<any> {
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      // Wait if in cooldown
      if (this.waitPromise) {
        log.debug('waiting for shared cooldown before stream', { attempt });
        await this.waitPromise;
      }

      try {
        // For streaming, we need to use the underlying LLM's stream method
        // This is typically used with createReactAgent which handles its own streaming
        const stream = (this.llm as any).streamEvents?.(input, config);
        if (stream) {
          for await (const event of stream) {
            yield event;
          }
          return;
        }
        // Fallback: just invoke
        yield await this.invoke(input.messages);
        return;
      } catch (err) {
        if (!is429Error(err)) {
          throw err;
        }

        if (attempt === this.maxRetries - 1) {
          throw err;
        }

        if (!this.waitPromise) {
          const parsedDelay = parseRetryDelay(err);
          const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
          const delay = Math.max(parsedDelay ?? 0, exponentialDelay);
          
          log.warn('rate limited on stream, backing off', { attempt, delayMs: delay });

          this.waitPromise = sleep(delay).then(() => {
            this.waitPromise = null;
          });
        }

        // Always wait on the shared promise
        await this.waitPromise;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton Instance                                                         */
/* -------------------------------------------------------------------------- */

let instance: RateLimitedLlm | null = null;
let currentModel: string | null = null;

/**
 * Get or create the singleton rate-limited LLM instance.
 * Recreates if model changes.
 */
export function getRateLimitedLlm(): RateLimitedLlm {
  const resolved = resolveConfigForAgent('analyst'); // Use analyst config as default
  const apiKey = resolveApiKey();
  
  if (!apiKey) {
    throw new LlmNotConfiguredError();
  }

  // Recreate if model changed
  if (instance && currentModel !== resolved.model) {
    log.info('model changed, recreating LLM instance', { 
      from: currentModel, 
      to: resolved.model 
    });
    instance = null;
  }

  if (!instance) {
    const isGemini = /gemini/i.test(resolved.model);
    
    let baseLlm: BaseChatModel;
    
    if (isGemini) {
      baseLlm = new ChatGoogleGenerativeAI({
        model: resolved.model,
        apiKey,
        temperature: resolved.temperature,
        maxRetries: 0, // We handle retries
      });
    } else {
      baseLlm = new ChatOpenAI({
        apiKey,
        model: resolved.model,
        temperature: resolved.temperature,
        timeout: resolved.timeoutMs,
        maxRetries: 0, // We handle retries
        ...(resolved.baseUrl ? { configuration: { baseURL: resolved.baseUrl } } : {}),
      });
    }

    instance = new RateLimitedLlm(baseLlm);
    currentModel = resolved.model;
    
    log.info('created rate-limited LLM instance', { model: resolved.model, isGemini });
  }

  return instance;
}

/**
 * Get a synthesis LLM (temperature=0) with shared rate limiting.
 * Returns a wrapper that uses the same cooldown queue.
 */
export function getSynthesisLlm(): RateLimitedLlm {
  const resolved = resolveConfigForAgent('analyst');
  const apiKey = resolveApiKey();
  
  if (!apiKey) {
    throw new LlmNotConfiguredError();
  }

  const isGemini = /gemini/i.test(resolved.model);
  
  let baseLlm: BaseChatModel;
  
  if (isGemini) {
    baseLlm = new ChatGoogleGenerativeAI({
      model: resolved.model,
      apiKey,
      temperature: 0,
      maxRetries: 0,
    });
  } else {
    baseLlm = new ChatOpenAI({
      apiKey,
      model: resolved.model,
      temperature: 0,
      timeout: resolved.timeoutMs,
      maxRetries: 0,
      ...(resolved.baseUrl ? { configuration: { baseURL: resolved.baseUrl } } : {}),
    });
  }

  // Share the same cooldown state by returning a wrapper that checks the main instance's waitPromise
  return new SynthesisLlmWrapper(baseLlm);
}

/**
 * Wrapper that shares cooldown state with the main instance.
 */
class SynthesisLlmWrapper extends RateLimitedLlm {
  private static sharedWaitPromise: Promise<void> | null = null;

  async invoke(messages: BaseMessage[]): Promise<any> {
    const maxRetries = 5;
    const baseDelayMs = 60_000; // 60s base delay

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Check shared cooldown from main instance OR our own
      const mainInstance = instance;
      const sharedWait = (mainInstance as any)?.waitPromise || SynthesisLlmWrapper.sharedWaitPromise;
      
      if (sharedWait) {
        log.debug('synthesis waiting for shared cooldown', { attempt });
        await sharedWait;
      }

      try {
        return await this.baseLlm.invoke(messages);
      } catch (err) {
        if (!is429Error(err)) {
          throw err;
        }

        if (attempt === maxRetries - 1) {
          throw err;
        }

        // Set shared cooldown
        if (!SynthesisLlmWrapper.sharedWaitPromise && !(mainInstance as any)?.waitPromise) {
          const parsedDelay = parseRetryDelay(err);
          const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
          const delay = Math.max(parsedDelay ?? 0, exponentialDelay);
          
          log.warn('synthesis rate limited, backing off', { attempt, delayMs: delay, parsedDelay, exponentialDelay });

          SynthesisLlmWrapper.sharedWaitPromise = sleep(delay).then(() => {
            SynthesisLlmWrapper.sharedWaitPromise = null;
          });

          // Also set on main instance if it exists
          if (mainInstance) {
            (mainInstance as any).waitPromise = SynthesisLlmWrapper.sharedWaitPromise;
          }
        }

        // Always wait on the shared promise
        const waitPromise = SynthesisLlmWrapper.sharedWaitPromise || (mainInstance as any)?.waitPromise;
        if (waitPromise) await waitPromise;
      }
    }

    throw new Error('Max retries exceeded');
  }
}

/** Reset singleton (for testing) */
export function resetRateLimitedLlm(): void {
  instance = null;
  currentModel = null;
}

/** Check if model is Gemini */
export function isGeminiModel(): boolean {
  const resolved = resolveConfigForAgent('analyst');
  return /gemini/i.test(resolved.model);
}
