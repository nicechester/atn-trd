import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YahooNewsDataSource, type YahooNewsItemRaw } from './yahooNews.ts';
import { HttpClient } from '../http.ts';
import { UpstreamError } from '../../lib/errors.ts';

const NOW = Date.parse('2026-08-18T12:00:00Z');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function harness(respond: () => Response) {
  const urls: string[] = [];
  const http = new HttpClient({
    name: 'yahoo-news-test',
    baseUrl: 'https://query1.finance.yahoo.com/',
    rateLimit: { capacity: 100, refillPerSecond: 1000 },
    retry: { retries: 0, sleep: async () => {} },
    fetchImpl: async (input) => {
      urls.push(String(input));
      return respond();
    },
  });
  return { source: new YahooNewsDataSource({ http, now: () => NOW }), urls };
}

const ITEM: YahooNewsItemRaw = {
  uuid: 'abc-123',
  title: 'Apple hits a new high',
  publisher: 'Barrons',
  link: 'https://finance.yahoo.com/news/apple',
  providerPublishTime: 1755500000,
  type: 'STORY',
  relatedTickers: ['AAPL', 'spy'],
  thumbnail: { resolutions: [{ url: 'https://img.example/thumb.jpg', width: 140, height: 140 }] },
};

describe('YahooNewsDataSource', () => {
  it('needs no API key', () => {
    const { source } = harness(() => jsonResponse({ news: [] }));
    assert.equal(source.isConfigured(), true);
    assert.equal(source.provider, 'yahoo');
    assert.equal(source.kind, 'news');
  });

  it('maps the search feed to normalized articles', async () => {
    const { source, urls } = harness(() => jsonResponse({ news: [ITEM] }));

    const result = await source.fetch({ symbol: 'aapl', limit: 5 });

    assert.match(urls[0]!, /v1\/finance\/search\?q=AAPL&newsCount=5&quotesCount=0/);
    assert.equal(result.provider, 'yahoo');
    assert.deepEqual(result.data.articles, [
      {
        id: 'abc-123',
        headline: 'Apple hits a new high',
        summary: '',
        url: 'https://finance.yahoo.com/news/apple',
        source: 'Barrons',
        publishedAt: 1755500000 * 1000,
        symbols: ['AAPL', 'SPY'],
        imageUrl: 'https://img.example/thumb.jpg',
      },
    ]);
    assert.equal(result.data.sentiment, null);
    assert.deepEqual(result.data.warnings, ['Yahoo news does not expose sentiment scores']);
  });

  it('searches the general market feed when no symbol is given', async () => {
    const { source, urls } = harness(() => jsonResponse({ news: [ITEM] }));

    const result = await source.fetch({});

    assert.match(urls[0]!, /q=stock%20market/);
    assert.equal(result.data.symbol, null);
  });

  it('warns that date filters are ignored', async () => {
    const { source } = harness(() => jsonResponse({ news: [] }));

    const { data } = await source.fetch({ symbol: 'AAPL', from: '2026-01-01' });

    assert.deepEqual(data.warnings, [
      'Yahoo news does not expose sentiment scores',
      'Yahoo news ignores from/to date filters',
    ]);
    assert.deepEqual(data.articles, []);
  });

  it('tolerates a missing news array', async () => {
    const { source } = harness(() => jsonResponse({}));
    const { data } = await source.fetch({ symbol: 'AAPL' });
    assert.deepEqual(data.articles, []);
  });

  it('maps transport failures to upstream errors', async () => {
    const { source } = harness(() => jsonResponse({}, 503));

    await assert.rejects(
      () => source.fetch({ symbol: 'AAPL' }),
      (err: unknown) => {
        assert.ok(err instanceof UpstreamError);
        assert.match(err.message, /Yahoo news request failed \(HTTP 503\)/);
        return true;
      }
    );
  });

  it('surfaces an in-body provider error', async () => {
    const { source } = harness(() =>
      jsonResponse({ error: { code: 'Bad Request', description: 'query too long' } })
    );
    await assert.rejects(() => source.fetch({ symbol: 'AAPL' }), /query too long/);
  });

  it('healthCheck reports ok with the latest headline', async () => {
    const { source } = harness(() => jsonResponse({ news: [ITEM] }));

    const health = await source.healthCheck();

    assert.equal(health.ok, true);
    assert.equal(health.configured, true);
    assert.equal(health.name, 'yahoo-news');
    assert.match(health.detail, /Fetched 1 AAPL headline\(s\); latest: Apple hits a new high/);
  });

  it('healthCheck degrades instead of throwing', async () => {
    const { source } = harness(() => jsonResponse({}, 500));

    const health = await source.healthCheck();

    assert.equal(health.ok, false);
    assert.match(health.detail, /HTTP 500/);
  });
});
