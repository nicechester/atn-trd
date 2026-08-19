import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FinnhubNewsDataSource, type FinnhubArticleRaw } from './finnhubNews.ts';
import { HttpClient } from '../http.ts';
import { DataSourceNotConfiguredError, UpstreamError } from '../../lib/errors.ts';

const NOW = Date.parse('2026-08-18T12:00:00Z');

interface Call {
  url: string;
  headers: Record<string, string>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Routes each request path to a canned response and records what was sent. */
function harness(
  routes: Array<{ match: RegExp; respond: () => Response }>,
  options: { key?: string | undefined; sentiment?: boolean } = {}
) {
  const calls: Call[] = [];
  const http = new HttpClient({
    name: 'finnhub-test',
    baseUrl: 'https://finnhub.io/api/v1/',
    rateLimit: { capacity: 100, refillPerSecond: 1000 },
    retry: { retries: 0, sleep: async () => {} },
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
      const route = routes.find((r) => r.match.test(url));
      if (!route) return jsonResponse({ error: `no route for ${url}` }, 404);
      return route.respond();
    },
  });

  const source = new FinnhubNewsDataSource({
    http,
    now: () => NOW,
    resolveKey: () => ('key' in options ? options.key : 'test-key'),
    ...(options.sentiment === undefined ? {} : { sentiment: options.sentiment }),
  });

  return { source, calls };
}

const ARTICLE: FinnhubArticleRaw = {
  id: 7401,
  category: 'company',
  datetime: 1755500000,
  headline: 'Apple unveils new silicon',
  image: 'https://img.example/1.jpg',
  related: 'AAPL,MSFT',
  source: 'Reuters',
  summary: 'The company announced...',
  url: 'https://news.example/apple',
};

describe('FinnhubNewsDataSource', () => {
  it('reports itself unconfigured without an API key', async () => {
    const { source } = harness([], { key: undefined });

    assert.equal(source.isConfigured(), false);

    const health = await source.healthCheck();
    assert.equal(health.ok, false);
    assert.equal(health.configured, false);
    assert.equal(health.detail, 'Missing FINNHUB_API_KEY');
    assert.equal(health.latencyMs, null);
    assert.equal(health.kind, 'news');
    assert.equal(health.provider, 'finnhub');
  });

  it('throws a typed error when fetching without a key', async () => {
    const { source } = harness([], { key: undefined });
    await assert.rejects(() => source.fetch({ symbol: 'AAPL' }), DataSourceNotConfiguredError);
  });

  it('fetches company news with a default 7-day window and header auth', async () => {
    const { source, calls } = harness([
      { match: /company-news/, respond: () => jsonResponse([ARTICLE]) },
      { match: /news-sentiment/, respond: () => jsonResponse({ companyNewsScore: 0.8 }) },
    ]);

    const result = await source.fetch({ symbol: 'aapl' });

    assert.match(calls[0]!.url, /company-news\?symbol=AAPL&from=2026-08-11&to=2026-08-18/);
    assert.equal(calls[0]!.headers['X-Finnhub-Token'], 'test-key');
    // The key must never leak into the query string.
    assert.ok(!calls[0]!.url.includes('test-key'));

    assert.equal(result.provider, 'finnhub');
    assert.equal(result.fetchedAt, NOW);
    assert.equal(result.data.symbol, 'AAPL');
    assert.deepEqual(result.data.articles, [
      {
        id: '7401',
        headline: 'Apple unveils new silicon',
        summary: 'The company announced...',
        url: 'https://news.example/apple',
        source: 'Reuters',
        publishedAt: 1755500000 * 1000,
        symbols: ['AAPL', 'MSFT'],
        imageUrl: 'https://img.example/1.jpg',
      },
    ]);
    assert.deepEqual(result.citations, [
      { title: 'Apple unveils new silicon', url: 'https://news.example/apple' },
    ]);
  });

  it('honours explicit from/to and limit', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...ARTICLE, id: i }));
    const { source, calls } = harness(
      [{ match: /company-news/, respond: () => jsonResponse(many) }],
      { sentiment: false }
    );

    const result = await source.fetch({ symbol: 'AAPL', from: '2026-01-01', to: '2026-01-31', limit: 3 });

    assert.match(calls[0]!.url, /from=2026-01-01&to=2026-01-31/);
    assert.equal(result.data.articles.length, 3);
    assert.deepEqual(result.data.warnings, ['Sentiment lookup disabled']);
  });

  it('falls back to general market news when no symbol is given', async () => {
    const { source, calls } = harness([
      { match: /news\?category=general/, respond: () => jsonResponse([ARTICLE]) },
    ]);

    const result = await source.fetch({});

    assert.match(calls[0]!.url, /news\?category=general/);
    assert.equal(result.data.symbol, null);
    assert.equal(result.data.sentiment, null);
    assert.equal(result.data.articles.length, 1);
  });

  it('maps the sentiment payload when the plan allows it', async () => {
    const { source } = harness([
      { match: /company-news/, respond: () => jsonResponse([ARTICLE]) },
      {
        match: /news-sentiment/,
        respond: () =>
          jsonResponse({
            buzz: { articlesInLastWeek: 42 },
            companyNewsScore: 0.79,
            sectorAverageBullishPercent: 0.63,
            sentiment: { bullishPercent: 0.71, bearishPercent: 0.29 },
          }),
      },
    ]);

    const { data } = await source.fetch({ symbol: 'AAPL' });

    assert.deepEqual(data.sentiment, {
      symbol: 'AAPL',
      companyNewsScore: 0.79,
      bullishPercent: 0.71,
      bearishPercent: 0.29,
      sectorAverageBullishPercent: 0.63,
      articlesInLastWeek: 42,
    });
    assert.deepEqual(data.warnings, []);
  });

  it('degrades to a warning when sentiment is paid-tier only', async () => {
    const { source } = harness([
      { match: /company-news/, respond: () => jsonResponse([ARTICLE]) },
      { match: /news-sentiment/, respond: () => jsonResponse({ error: 'premium' }, 403) },
    ]);

    const { data } = await source.fetch({ symbol: 'AAPL' });

    // The articles still come back: a partial failure must not fail the fetch.
    assert.equal(data.articles.length, 1);
    assert.equal(data.sentiment, null);
    assert.equal(data.warnings.length, 1);
    assert.match(data.warnings[0]!, /Sentiment unavailable.*rejected the API key/);
  });

  it('maps a rejected key to a descriptive upstream error', async () => {
    const { source } = harness([
      { match: /company-news/, respond: () => jsonResponse({ error: 'nope' }, 401) },
    ]);

    await assert.rejects(
      () => source.fetch({ symbol: 'AAPL' }),
      (err: unknown) => {
        assert.ok(err instanceof UpstreamError);
        assert.match(err.message, /rejected the API key \(HTTP 401\).*FINNHUB_API_KEY/);
        return true;
      }
    );
  });

  it('maps a 200-with-error body to an upstream error', async () => {
    const { source } = harness([
      { match: /company-news/, respond: () => jsonResponse({ error: 'You do not have access' }) },
    ]);

    await assert.rejects(
      () => source.fetch({ symbol: 'AAPL' }),
      /Finnhub rejected the request: You do not have access/
    );
  });

  it('healthCheck reports ok with a headline summary', async () => {
    const { source, calls } = harness([
      { match: /company-news/, respond: () => jsonResponse([ARTICLE]) },
    ]);

    const health = await source.healthCheck();

    assert.equal(health.ok, true);
    assert.equal(health.configured, true);
    assert.match(health.detail, /Fetched 1 AAPL headline\(s\); latest: Apple unveils new silicon/);
    assert.ok(typeof health.latencyMs === 'number');
    // The probe stays cheap: no sentiment call.
    assert.equal(calls.length, 1);
  });

  it('healthCheck degrades instead of throwing when the provider is down', async () => {
    const { source } = harness([
      { match: /company-news/, respond: () => jsonResponse({ error: 'boom' }, 500) },
    ]);

    const health = await source.healthCheck();

    assert.equal(health.ok, false);
    assert.equal(health.configured, true);
    assert.match(health.detail, /HTTP 500/);
    assert.equal(health.error, health.detail);
  });
});
