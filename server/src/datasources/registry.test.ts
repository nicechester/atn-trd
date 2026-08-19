import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '@atn-trd/shared';
import { createDataSourceRegistry, type AnyDataSource, type DataSourcesSettings } from './registry.ts';
import { BaseDataSource, type DataSourceHealth, type DataSourceId, type DataSourceKind } from './types.ts';

class FakeSource extends BaseDataSource<never, unknown> {
  readonly name: string;
  readonly kind: DataSourceKind;
  readonly provider: string;
  private readonly configured: boolean;
  probes = 0;

  constructor(name: string, kind: DataSourceKind, provider: string, configured = true) {
    super();
    this.name = name;
    this.kind = kind;
    this.provider = provider;
    this.configured = configured;
  }

  override isConfigured(): boolean {
    return this.configured;
  }

  async fetch(): Promise<unknown> {
    return {};
  }

  protected async probe(): Promise<string> {
    this.probes += 1;
    return `probed ${this.name}`;
  }
}

function registryWith(
  settings: Partial<DataSourcesSettings> = {},
  configuredByDefault = true
) {
  const created: string[] = [];
  const instances = new Map<string, FakeSource>();

  const registry = createDataSourceRegistry({
    readSettings: () => ({ ...DEFAULT_SETTINGS.dataSources, ...settings }) as DataSourcesSettings,
    createSource: (id: DataSourceId, provider: string): AnyDataSource => {
      const key = `${id}:${provider}`;
      created.push(key);
      const source = new FakeSource(`${provider}-${id}`, id, provider, configuredByDefault);
      instances.set(key, source);
      return source;
    },
  });

  return { registry, created, instances };
}

describe('data source registry', () => {
  it('lists all four connectors with their configured provider', () => {
    const { registry } = registryWith();

    const list = registry.list();

    assert.deepEqual(list.map((d) => d.id), ['news', 'fundamentals', 'macro', 'options']);
    assert.deepEqual(
      list.map((d) => d.provider),
      ['finnhub', 'yahoo', 'fred', 'yahoo']
    );
    assert.deepEqual(list.map((d) => d.name), [
      'finnhub-news',
      'yahoo-fundamentals',
      'fred-macro',
      'yahoo-options',
    ]);
    assert.ok(list.every((d) => d.enabled && d.configured));
  });

  it('follows the provider selected in settings', () => {
    const { registry } = registryWith({ news: { provider: 'yahoo', enabled: true } });

    const news = registry.describe('news');

    assert.equal(news.provider, 'yahoo');
    assert.equal(news.name, 'yahoo-news');
  });

  it('reports which connectors need an API key', () => {
    const { registry } = registryWith();

    const bySecret = Object.fromEntries(registry.list().map((d) => [d.id, d.secretName]));

    assert.deepEqual(bySecret, {
      news: 'FINNHUB_API_KEY',
      fundamentals: null,
      macro: 'FRED_API_KEY',
      options: null,
    });
    assert.equal(registry.describe('macro').requiresKey, true);
    assert.equal(registry.describe('options').requiresKey, false);
  });

  it('drops the key requirement when a zero-key provider is selected', () => {
    const { registry } = registryWith({ news: { provider: 'yahoo', enabled: true } });

    const news = registry.describe('news');

    assert.equal(news.requiresKey, false);
    assert.equal(news.secretName, null);
  });

  it('reflects the enabled flag from settings', () => {
    const { registry } = registryWith({ macro: { provider: 'fred', enabled: false } });

    assert.equal(registry.describe('macro').enabled, false);
    // Disabled sources are still listed and still testable.
    assert.equal(registry.describe('macro').name, 'fred-macro');
  });

  it('reports unconfigured connectors without throwing', async () => {
    const { registry } = registryWith({}, false);

    assert.equal(registry.describe('news').configured, false);

    const health = await registry.test('news');
    assert.equal(health.ok, false);
    assert.equal(health.configured, false);
    assert.equal(health.detail, 'Data source is not configured');
  });

  it('caches instances so token buckets survive across calls', () => {
    const { registry, created } = registryWith();

    registry.get('news');
    registry.get('news');
    registry.describe('news');

    assert.deepEqual(created, ['news:finnhub']);
  });

  it('runs a real health check through the connector', async () => {
    const { registry, instances } = registryWith();

    const health: DataSourceHealth = await registry.test('options');

    assert.equal(health.ok, true);
    assert.equal(health.name, 'yahoo-options');
    assert.equal(health.provider, 'yahoo');
    assert.equal(health.detail, 'probed yahoo-options');
    assert.equal(instances.get('options:yahoo')!.probes, 1);
  });
});
