import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmbeddingService,
  truncateForEmbedding,
  assessmentToEmbeddingText,
  artifactToEmbeddingText,
  tradeOutcomeToEmbeddingText,
} from './embeddingService.ts';
import { LlmNotConfiguredError } from './openaiChatModel.ts';

const ENV_KEYS = ['OPENAI_API_KEY', 'LLM_API_KEY', 'OPENAI_API_URL', 'LLM_API_URL', 'EMBEDDING_MODEL'] as const;
let savedEnv: Record<string, string | undefined> = {};
let originalFetch: typeof fetch;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  globalThis.fetch = originalFetch;
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return (async (url: string | URL, init?: RequestInit) => handler(String(url), init ?? {})) as typeof fetch;
}

describe('createEmbeddingService', () => {
  it('throws LlmNotConfiguredError when no API key is available', async () => {
    const service = createEmbeddingService();
    await assert.rejects(() => service.embed('hello'), LlmNotConfiguredError);
  });

  it('sends the expected request shape and returns the embedding vector', async () => {
    let capturedUrl = '';
    let capturedBody: unknown;
    let capturedHeaders: Record<string, string> = {};

    globalThis.fetch = fakeFetch(async (url, init) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(JSON.stringify({
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
      }), { status: 200 });
    });

    const service = createEmbeddingService({ apiKey: 'sk-test', model: 'text-embedding-3-small' });
    const result = await service.embed('hello world');

    assert.deepEqual(result, [0.1, 0.2, 0.3]);
    assert.equal(capturedUrl, 'https://api.openai.com/v1/embeddings');
    assert.deepEqual(capturedBody, { model: 'text-embedding-3-small', input: ['hello world'] });
    assert.equal(capturedHeaders['Authorization'], 'Bearer sk-test');
    assert.equal(capturedHeaders['Content-Type'], 'application/json');
  });

  it('sorts batch results by index to preserve input order', async () => {
    globalThis.fetch = fakeFetch(async () => new Response(JSON.stringify({
      data: [
        { embedding: [2], index: 1 },
        { embedding: [1], index: 0 },
      ],
    }), { status: 200 }));

    const service = createEmbeddingService({ apiKey: 'sk-test' });
    const result = await service.embedBatch(['first', 'second']);

    assert.deepEqual(result, [[1], [2]]);
  });

  it('returns an empty array for an empty batch without calling fetch', async () => {
    let called = false;
    globalThis.fetch = fakeFetch(async () => {
      called = true;
      return new Response('{}', { status: 200 });
    });

    const service = createEmbeddingService({ apiKey: 'sk-test' });
    const result = await service.embedBatch([]);

    assert.deepEqual(result, []);
    assert.equal(called, false);
  });

  it('propagates API errors with status and error text', async () => {
    globalThis.fetch = fakeFetch(async () => new Response('rate limited', { status: 429 }));

    const service = createEmbeddingService({ apiKey: 'sk-test' });
    await assert.rejects(() => service.embed('hello'), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /Embedding API error: 429/);
      assert.match(err.message, /rate limited/);
      return true;
    });
  });

  it('honours a custom base URL', async () => {
    let capturedUrl = '';
    globalThis.fetch = fakeFetch(async (url) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ data: [{ embedding: [1], index: 0 }] }), { status: 200 });
    });

    const service = createEmbeddingService({ apiKey: 'sk-test', baseUrl: 'https://gateway.example/v1' });
    await service.embed('hi');

    assert.equal(capturedUrl, 'https://gateway.example/v1/embeddings');
  });
});

describe('truncateForEmbedding', () => {
  it('leaves short text untouched', () => {
    assert.equal(truncateForEmbedding('hello'), 'hello');
  });

  it('truncates long text and appends an ellipsis', () => {
    const long = 'a'.repeat(100);
    const truncated = truncateForEmbedding(long, 10);
    assert.equal(truncated, 'a'.repeat(10) + '...');
  });
});

describe('assessmentToEmbeddingText', () => {
  it('includes required fields and omits optional ones when absent', () => {
    const text = assessmentToEmbeddingText({ symbol: 'AAPL', score: 0.8, thesis: 'strong growth' });
    assert.match(text, /Symbol: AAPL/);
    assert.match(text, /Score: 0.8/);
    assert.match(text, /Thesis: strong growth/);
    assert.doesNotMatch(text, /Risks:/);
    assert.doesNotMatch(text, /Catalysts:/);
  });

  it('includes risks and catalysts when present', () => {
    const text = assessmentToEmbeddingText({
      symbol: 'AAPL',
      score: 0.8,
      thesis: 'strong growth',
      risks: 'valuation risk',
      catalysts: 'product launch',
    });
    assert.match(text, /Risks: valuation risk/);
    assert.match(text, /Catalysts: product launch/);
  });
});

describe('artifactToEmbeddingText', () => {
  it('builds text with source, provider, and condensed payload', () => {
    const text = artifactToEmbeddingText({
      symbol: 'AAPL',
      source: 'news',
      provider: 'finnhub',
      summary: 'positive coverage',
      payload: { headline: 'AAPL beats estimates' },
    });
    assert.match(text, /Symbol: AAPL/);
    assert.match(text, /Source: news/);
    assert.match(text, /Provider: finnhub/);
    assert.match(text, /Summary: positive coverage/);
    assert.match(text, /AAPL beats estimates/);
  });
});

describe('tradeOutcomeToEmbeddingText', () => {
  it('summarizes a realized gain with holding period', () => {
    const text = tradeOutcomeToEmbeddingText({
      symbol: 'AAPL',
      side: 'sell',
      qty: 10,
      avgCostCents: 10000,
      exitPriceCents: 11000,
      realizedPnlCents: 10000,
      holdingPeriodMs: 5 * 86_400_000,
      thesis: 'strong growth thesis',
    });

    assert.match(text, /Symbol: AAPL/);
    assert.match(text, /SELL 10 shares realized P&L \$100\.00/);
    assert.match(text, /Entry: \$100\.00, Exit: \$110\.00/);
    assert.match(text, /Held: 5 day\(s\)/);
    assert.match(text, /Original thesis: strong growth thesis/);
  });

  it('omits holding period and thesis when not provided', () => {
    const text = tradeOutcomeToEmbeddingText({
      symbol: 'MSFT',
      side: 'sell',
      qty: 5,
      avgCostCents: 20000,
      exitPriceCents: 19000,
      realizedPnlCents: -5000,
    });

    assert.doesNotMatch(text, /Held:/);
    assert.doesNotMatch(text, /Original thesis:/);
    assert.match(text, /-50\.00/);
  });
});
