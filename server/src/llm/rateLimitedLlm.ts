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
import { BaseChatModel, type BaseChatModelCallOptions } from '@langchain/core/language_models/chat_models';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';
import type { CallbackManagerForLLMRun } from '@langchain/core/callbacks/manager';
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
/* Blocking Queue - serializes all LLM calls                                  */
/* -------------------------------------------------------------------------- */

/** Queue tail - each call chains off this promise */
let queueTail: Promise<void> = Promise.resolve();

/** Minimum delay between requests (4s = 15 req/min with buffer) */
const MIN_DELAY_MS = 4000;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enqueue a task to run after all previous tasks complete.
 * Returns when it's this task's turn.
 */
function enqueue(): Promise<void> {
  const myTurn = queueTail;
  let resolve: () => void;
  queueTail = new Promise<void>((r) => { resolve = r; });
  
  return myTurn.then(() => {
    // Return a release function via closure - caller must call it when done
    (enqueue as any)._release = resolve!;
  });
}

/** Release the queue for the next caller */
function releaseQueue(): void {
  const release = (enqueue as any)._release;
  if (release) {
    delete (enqueue as any)._release;
    release();
  }
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
/* RateLimitedLlm Class - extends BaseChatModel for use with LangGraph        */
/* -------------------------------------------------------------------------- */

class RateLimitedLlm extends BaseChatModel<BaseChatModelCallOptions> {
  private llm: BaseChatModel;
  private baseDelayMs: number;
  private maxRetries: number;

  constructor(llm: BaseChatModel, config: RateLimitedLlmConfig = {}) {
    super({});
    this.llm = llm;
    this.baseDelayMs = config.baseDelayMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 5;
  }

  _llmType(): string {
    return 'rate-limited-wrapper';
  }

  /** Bind tools to the underlying LLM */
  override bindTools(tools: any[], kwargs?: any): BaseChatModel {
    const boundLlm = this.llm.bindTools?.(tools, kwargs) ?? this.llm;
    return new RateLimitedLlm(boundLlm as BaseChatModel, {
      baseDelayMs: this.baseDelayMs,
      maxRetries: this.maxRetries,
    });
  }

  /**
   * Core generation method - all LLM calls go through here.
   * Implements blocking queue with retry logic.
   */
  async _generate(
    messages: BaseMessage[],
    options: this['ParsedCallOptions'],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    await enqueue();
    log.debug('acquired queue slot');

    try {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          // Call underlying LLM's _generate
          const result = await this.llm.invoke(messages, {
            ...options,
            callbacks: runManager ? [runManager] : undefined,
          });
          await sleep(MIN_DELAY_MS);
          return {
            generations: [{ message: result, text: typeof result.content === 'string' ? result.content : '' }],
          };
        } catch (err) {
          if (!is429Error(err)) {
            throw err;
          }

          if (attempt === this.maxRetries - 1) {
            log.error('max retries exceeded for rate limit', { attempt });
            throw err;
          }

          const parsedDelay = parseRetryDelay(err);
          const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
          const delay = Math.max(parsedDelay ?? 0, exponentialDelay);

          log.warn('rate limited, backing off', {
            attempt,
            delayMs: delay,
            parsedFromResponse: parsedDelay,
            exponentialDelay,
          });

          await sleep(delay);
        }
      }
      throw new Error('Max retries exceeded');
    } finally {
      releaseQueue();
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
 * Get synthesis LLM - returns the same singleton.
 * Temperature differences are minor; using same instance ensures queue is respected.
 */
export function getSynthesisLlm(): RateLimitedLlm {
  return getRateLimitedLlm();
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
