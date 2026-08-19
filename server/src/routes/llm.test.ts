import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { createTestLlmHandler, DEFAULT_TEST_PROMPT } from './llm.ts';
import { ValidationError } from '../lib/errors.ts';
import {
  LlmNotConfiguredError,
  LlmRateLimitError,
  type ChatCompletion,
  type ChatMessage,
  type ChatModel,
} from '../llm/openaiChatModel.ts';

const COMPLETION: ChatCompletion = {
  content: 'pong',
  model: 'gpt-4-turbo',
  tokens: { inputTokens: 18, outputTokens: 1, totalTokens: 19 },
};

interface Captured {
  status?: number;
  body?: unknown;
  error?: unknown;
  messages: ChatMessage[][];
}

function run(
  body: unknown,
  complete: (messages: ChatMessage[]) => Promise<ChatCompletion>,
  clock?: number[]
): Promise<Captured> {
  const captured: Captured = { messages: [] };

  const model: ChatModel = {
    config: {
      model: 'gpt-4-turbo',
      temperature: 0.7,
      timeoutMs: 30000,
      maxRetries: 2,
      hasApiKey: true,
    },
    complete: (messages) => {
      captured.messages.push(messages);
      return complete(messages);
    },
  };

  const ticks = clock ? [...clock] : undefined;
  const handler = createTestLlmHandler({
    createModel: () => model,
    ...(ticks ? { now: () => ticks.shift() ?? 0 } : {}),
  });

  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: unknown) {
      captured.body = payload;
      return this;
    },
  } as unknown as Response;

  const next: NextFunction = (err?: unknown) => {
    captured.error = err;
  };

  return handler({ body } as Request, res, next).then(() => captured);
}

const ok = async (): Promise<ChatCompletion> => COMPLETION;

describe('POST /api/llm/test', () => {
  it('returns response, latency and tokens on success', async () => {
    const result = await run({ prompt: 'ping' }, ok, [1000, 1245.6]);

    assert.equal(result.error, undefined);
    assert.deepEqual(result.body, {
      ok: true,
      data: {
        model: 'gpt-4-turbo',
        response: 'pong',
        latency: 246,
        tokens: { inputTokens: 18, outputTokens: 1, totalTokens: 19 },
      },
    });
  });

  it('measures latency from the injected clock', async () => {
    const result = await run({ prompt: 'ping' }, ok, [0, 4200]);
    const data = (result.body as { data: { latency: number } }).data;
    assert.equal(data.latency, 4200);
  });

  it('omits tokens when the provider reports none', async () => {
    const result = await run({ prompt: 'ping' }, async () => ({
      content: 'pong',
      model: 'gpt-4-turbo',
    }));
    const data = (result.body as { data: Record<string, unknown> }).data;
    assert.equal('tokens' in data, false);
  });

  it('uses the default prompt when the body is empty', async () => {
    for (const body of [undefined, null, {}, { prompt: '   ' }, { prompt: null }]) {
      const result = await run(body, ok);
      assert.equal(result.error, undefined, `body ${JSON.stringify(body)}`);
      const user = result.messages[0].find((m) => m.role === 'user');
      assert.equal(user?.content, DEFAULT_TEST_PROMPT);
    }
  });

  it('sends a system message ahead of the user prompt', async () => {
    const result = await run({ prompt: 'ping' }, ok);
    assert.equal(result.messages[0][0].role, 'system');
    assert.equal(result.messages[0][1].content, 'ping');
  });

  it('rejects a non-string prompt', async () => {
    const result = await run({ prompt: 42 }, ok);
    assert.ok(result.error instanceof ValidationError);
    assert.match(result.error.message, /must be a string/);
    assert.equal(result.messages.length, 0);
  });

  it('rejects a non-object body', async () => {
    const result = await run('just a string', ok);
    assert.ok(result.error instanceof ValidationError);
    assert.match(result.error.message, /must be a JSON object/);
  });

  it('rejects an oversized prompt', async () => {
    const result = await run({ prompt: 'x'.repeat(4001) }, ok);
    assert.ok(result.error instanceof ValidationError);
    assert.match(result.error.message, /at most 4000 characters/);
  });

  it('forwards a missing-key error for the error middleware to map', async () => {
    const result = await run({}, async () => {
      throw new LlmNotConfiguredError();
    });
    assert.ok(result.error instanceof LlmNotConfiguredError);
    assert.equal(result.error.statusCode, 503);
    assert.equal(result.body, undefined);
  });

  it('forwards a rate-limit error unchanged', async () => {
    const result = await run({}, async () => {
      throw new LlmRateLimitError('slow down', 2000);
    });
    assert.ok(result.error instanceof LlmRateLimitError);
    assert.equal(result.error.statusCode, 429);
    assert.equal(result.error.retryAfterMs, 2000);
  });
});
