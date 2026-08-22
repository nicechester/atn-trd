import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RssNewsDataSource } from './rssNews.ts';
import Parser from 'rss-parser';

const NOW = Date.parse('2026-08-18T12:00:00Z');

describe('RssNewsDataSource', () => {
  it('should be configured without requiring any API keys', () => {
    const source = new RssNewsDataSource();
    assert.strictEqual(source.isConfigured(), true);
  });

  it('should have the correct metadata', () => {
    const source = new RssNewsDataSource();
    assert.strictEqual(source.name, 'rss-news');
    assert.strictEqual(source.kind, 'news');
    assert.strictEqual(source.provider, 'rss');
  });

  it('should deduplicate articles by URL', async () => {
    // Create mock parser with controlled test data
    const mockParser = new Parser();

    // Override parseURL to return controlled test items
    const mockItems: Parser.Item[] = [
      {
        title: 'Test Article 1',
        link: 'https://example.com/article1',
        pubDate: new Date(NOW).toISOString(),
        content: 'Content 1',
      },
      {
        title: 'Test Article 2',
        link: 'https://example.com/article2',
        pubDate: new Date(NOW).toISOString(),
        content: 'Content 2',
      },
      // Duplicate URL should be filtered
      {
        title: 'Test Article 1 Duplicate',
        link: 'https://example.com/article1',
        pubDate: new Date(NOW).toISOString(),
        content: 'Content 1 Duplicate',
      },
    ];

    mockParser.parseURL = async () => ({
      items: mockItems,
      title: 'Test Feed',
      description: 'Test Description',
      link: 'https://example.com',
    });

    const source = new RssNewsDataSource({
      parser: mockParser,
      now: () => NOW,
    });

    const result = await source.fetch({ symbol: 'AAPL', limit: 10 });

    // Should have 2 unique articles (1st and 2nd), not 3 (3rd is duplicate)
    assert.strictEqual(result.data.articles.length, 2);
    assert.strictEqual(result.data.articles[0]?.headline, 'Test Article 1');
    assert.strictEqual(result.data.articles[1]?.headline, 'Test Article 2');
  });

  it('should normalize RSS articles to NewsArticle format', async () => {
    const mockParser = new Parser();
    const mockItems: Parser.Item[] = [
      {
        title: 'Breaking News: Stock Soars',
        link: 'https://news.example.com/breaking',
        pubDate: new Date(NOW - 3600000).toISOString(), // 1 hour ago
        content: 'This is a summary of the breaking news article.',
      },
    ];

    mockParser.parseURL = async () => ({
      items: mockItems,
      title: 'News Feed',
      description: 'Test News',
      link: 'https://example.com',
    });

    const source = new RssNewsDataSource({
      parser: mockParser,
      now: () => NOW,
    });

    const result = await source.fetch({ limit: 5 });
    const article = result.data.articles[0];

    assert.ok(article);
    assert.strictEqual(article.headline, 'Breaking News: Stock Soars');
    assert.strictEqual(article.url, 'https://news.example.com/breaking');
    assert.strictEqual(article.summary, 'This is a summary of the breaking news article.');
    assert.strictEqual(typeof article.publishedAt, 'number');
    assert.ok(article.publishedAt <= NOW);
    assert.strictEqual(article.imageUrl, null);
  });

  it('should handle fetch with general market news (no symbol)', async () => {
    const mockParser = new Parser();
    mockParser.parseURL = async () => ({
      items: [
        {
          title: 'Market Update',
          link: 'https://example.com/market',
          pubDate: new Date(NOW).toISOString(),
          content: 'Today market update',
        },
      ],
      title: 'Market News',
      description: 'General market news',
      link: 'https://example.com',
    });

    const source = new RssNewsDataSource({
      parser: mockParser,
      now: () => NOW,
    });

    const result = await source.fetch({ limit: 10 });
    assert.strictEqual(result.data.symbol, null);
    assert.ok(result.data.articles.length > 0);
  });

  it('should warn about lack of sentiment data', async () => {
    const mockParser = new Parser();
    mockParser.parseURL = async () => ({
      items: [],
      title: 'Empty Feed',
      description: 'No items',
      link: 'https://example.com',
    });

    const source = new RssNewsDataSource({
      parser: mockParser,
    });

    const result = await source.fetch();
    assert.ok(result.data.warnings.length > 0);
    assert.ok(result.data.warnings[0]?.includes('sentiment'));
  });
});
