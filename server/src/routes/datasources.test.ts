import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { createListDataSourcesHandler, createTestDataSourceHandler } from './datasources.ts';
import type { DataSourceRegistry, DataSourceDescriptor } from '../datasources/registry.ts';
import { DATA_SOURCE_IDS, type DataSourceHealth, type DataSourceId } from '../datasources/types.ts';
import { NotFoundError } from '../lib/errors.ts';

const DESCRIPTOR: DataSourceDescriptor = {
  id: 'news',
  provider: 'finnhub',
  name: 'finnhub-news',
  configured: true,
  enabled: true,
  requiresKey: true,
  secretName: 'FINNHUB_API_KEY',
};

const HEALTH: DataSourceHealth = {
  name: 'finnhub-news',
  kind: 'news',
  provider: 'finnhub',
  configured: true,
  ok: true,
  detail: 'Fetched 3 AAPL headline(s)',
  latencyMs: 142,
  checkedAt: 1_766_000_000_000,
};

interface Captured {
  status?: number;
  body?: unknown;
  error?: unknown;
}

function capture(): { res: Response; next: NextFunction; captured: Captured } {
  const captured: Captured = {};
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
  return { res, next, captured };
}

function fakeRegistry(overrides: Partial<DataSourceRegistry> = {}): DataSourceRegistry {
  return {
    ids: () => DATA_SOURCE_IDS,
    get: () => {
      throw new Error('not used');
    },
    describe: () => DESCRIPTOR,
    list: () => [DESCRIPTOR],
    test: async () => HEALTH,
    ...overrides,
  };
}

describe('GET /api/datasources', () => {
  it('returns the descriptor list', () => {
    const { res, next, captured } = capture();

    createListDataSourcesHandler({ registry: fakeRegistry() })({} as Request, res, next);

    assert.equal(captured.error, undefined);
    assert.deepEqual(captured.body, { ok: true, data: [DESCRIPTOR] });
  });

  it('forwards registry failures to the error middleware', () => {
    const { res, next, captured } = capture();
    const registry = fakeRegistry({
      list: () => {
        throw new Error('settings unavailable');
      },
    });

    createListDataSourcesHandler({ registry })({} as Request, res, next);

    assert.ok(captured.error instanceof Error);
    assert.equal(captured.body, undefined);
  });
});

describe('POST /api/datasources/:id/test', () => {
  it('returns the health report for a known source', async () => {
    const { res, next, captured } = capture();
    const seen: DataSourceId[] = [];
    const registry = fakeRegistry({
      test: async (id) => {
        seen.push(id);
        return HEALTH;
      },
    });

    await createTestDataSourceHandler({ registry })(
      { params: { id: 'news' } } as unknown as Request,
      res,
      next
    );

    assert.deepEqual(seen, ['news']);
    assert.equal(captured.error, undefined);
    assert.deepEqual(captured.body, {
      ok: true,
      id: 'news',
      name: 'finnhub-news',
      provider: 'finnhub',
      configured: true,
      detail: 'Fetched 3 AAPL headline(s)',
      latencyMs: 142,
      checkedAt: 1_766_000_000_000,
    });
  });

  it('reports an unhealthy source with HTTP 200 and ok:false', async () => {
    const { res, next, captured } = capture();
    const registry = fakeRegistry({
      test: async () => ({
        ...HEALTH,
        ok: false,
        detail: 'Finnhub rate limit exceeded (HTTP 429)',
        error: 'Finnhub rate limit exceeded (HTTP 429)',
      }),
    });

    await createTestDataSourceHandler({ registry })(
      { params: { id: 'news' } } as unknown as Request,
      res,
      next
    );

    // A down provider is a successful answer, not a server error.
    assert.equal(captured.status, undefined);
    assert.equal(captured.error, undefined);
    assert.equal((captured.body as { ok: boolean }).ok, false);
    assert.match((captured.body as { detail: string }).detail, /rate limit/);
  });

  it('404s an unknown data source id', async () => {
    const { res, next, captured } = capture();

    await createTestDataSourceHandler({ registry: fakeRegistry() })(
      { params: { id: 'weather' } } as unknown as Request,
      res,
      next
    );

    assert.ok(captured.error instanceof NotFoundError);
    assert.match((captured.error as NotFoundError).message, /Unknown data source "weather"/);
    assert.equal(captured.body, undefined);
  });

  it('accepts every registered id', async () => {
    for (const id of DATA_SOURCE_IDS) {
      const { res, next, captured } = capture();
      await createTestDataSourceHandler({ registry: fakeRegistry() })(
        { params: { id } } as unknown as Request,
        res,
        next
      );
      assert.equal(captured.error, undefined, `id ${id} should be accepted`);
    }
  });

  it('degrades to ok:false if the registry itself throws', async () => {
    const { res, next, captured } = capture();
    const registry = fakeRegistry({
      test: async () => {
        throw new Error('registry exploded');
      },
    });

    await createTestDataSourceHandler({ registry })(
      { params: { id: 'macro' } } as unknown as Request,
      res,
      next
    );

    assert.equal(captured.error, undefined);
    assert.equal((captured.body as { ok: boolean }).ok, false);
    assert.equal((captured.body as { detail: string }).detail, 'registry exploded');
  });
});
