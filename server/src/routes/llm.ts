/**
 * LLM test endpoint: proves the configured OpenAI credentials and model can
 * complete a minimal request, and reports round-trip latency plus token usage.
 */

import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import {
  createOpenAIChatModel,
  promptMessages,
  type ChatModel,
  type TokenUsage,
} from '../llm/openaiChatModel.js';

/** Cheap, deterministic prompt used when the caller doesn't supply one. */
export const DEFAULT_TEST_PROMPT = 'Reply with the single word: pong';

const SYSTEM_PROMPT = 'You are a connectivity probe. Answer in as few words as possible.';
const MAX_PROMPT_LENGTH = 4000;

const log = logger.child({ component: 'llm-route' });

export interface TestLlmData {
  model: string;
  response: string;
  /** Round-trip milliseconds, including any retries. */
  latency: number;
  tokens?: TokenUsage;
}

export interface LlmRouteDeps {
  /** Overridable so tests can drive the handler without network access. */
  createModel?: () => ChatModel;
  now?: () => number;
}

function parsePrompt(body: unknown): string {
  if (body === undefined || body === null) return DEFAULT_TEST_PROMPT;
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }

  const { prompt } = body as Record<string, unknown>;
  if (prompt === undefined || prompt === null) return DEFAULT_TEST_PROMPT;

  if (typeof prompt !== 'string') {
    throw new ValidationError('Field "prompt" must be a string');
  }
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return DEFAULT_TEST_PROMPT;
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new ValidationError(
      `Field "prompt" must be at most ${MAX_PROMPT_LENGTH} characters (received ${trimmed.length})`
    );
  }
  return trimmed;
}

export function createTestLlmHandler(deps: LlmRouteDeps = {}) {
  const createModel = deps.createModel ?? (() => createOpenAIChatModel());
  const now = deps.now ?? (() => performance.now());

  /** POST /api/llm/test */
  return async function testLlmHandler(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const prompt = parsePrompt(req.body);
      const model = createModel();

      // Clock starts around the provider call only, so validation and config
      // resolution don't inflate the reported latency.
      const startedAt = now();
      const completion = await model.complete(promptMessages(prompt, SYSTEM_PROMPT));
      const latency = Math.round(now() - startedAt);

      const data: TestLlmData = {
        model: completion.model,
        response: completion.content,
        latency,
        ...(completion.tokens ? { tokens: completion.tokens } : {}),
      };

      log.info('llm test succeeded', {
        model: data.model,
        latency,
        // Not "totalTokens": the logger redacts any key containing "token".
        usageTotal: completion.tokens?.totalTokens,
      });

      res.json({ ok: true, data });
    } catch (err) {
      // Errors from the model layer are already AppErrors with user-facing
      // messages; app.ts maps them to status codes and JSON.
      next(err);
    }
  };
}

export const testLlmHandler = createTestLlmHandler();
