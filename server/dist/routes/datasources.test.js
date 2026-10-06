import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createListDataSourcesHandler, createTestDataSourceHandler } from './datasources.ts';
import { DATA_SOURCE_IDS } from '../datasources/types.ts';
import { NotFoundError } from '../lib/errors.ts';
const DESCRIPTOR = {
    id: 'news',
    provider: 'finnhub',
    name: 'finnhub-news',
    configured: true,
    enabled: true,
    requiresKey: true,
    secretName: 'FINNHUB_API_KEY',
};
const HEALTH = {
    name: 'finnhub-news',
    kind: 'news',
    provider: 'finnhub',
    configured: true,
    ok: true,
    detail: 'Fetched 3 AAPL headline(s)',
    latencyMs: 142,
    checkedAt: 1_766_000_000_000,
};
function capture() {
    const captured = {};
    const res = {
        status(code) {
            captured.status = code;
            return this;
        },
        json(payload) {
            captured.body = payload;
            return this;
        },
    };
    const next = (err) => {
        captured.error = err;
    };
    return { res, next, captured };
}
function fakeRegistry(overrides = {}) {
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
        createListDataSourcesHandler({ registry: fakeRegistry() })({}, res, next);
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
        createListDataSourcesHandler({ registry })({}, res, next);
        assert.ok(captured.error instanceof Error);
        assert.equal(captured.body, undefined);
    });
});
describe('POST /api/datasources/:id/test', () => {
    it('returns the health report for a known source', async () => {
        const { res, next, captured } = capture();
        const seen = [];
        const registry = fakeRegistry({
            test: async (id) => {
                seen.push(id);
                return HEALTH;
            },
        });
        await createTestDataSourceHandler({ registry })({ params: { id: 'news' } }, res, next);
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
        await createTestDataSourceHandler({ registry })({ params: { id: 'news' } }, res, next);
        // A down provider is a successful answer, not a server error.
        assert.equal(captured.status, undefined);
        assert.equal(captured.error, undefined);
        assert.equal(captured.body.ok, false);
        assert.match(captured.body.detail, /rate limit/);
    });
    it('404s an unknown data source id', async () => {
        const { res, next, captured } = capture();
        await createTestDataSourceHandler({ registry: fakeRegistry() })({ params: { id: 'weather' } }, res, next);
        assert.ok(captured.error instanceof NotFoundError);
        assert.match(captured.error.message, /Unknown data source "weather"/);
        assert.equal(captured.body, undefined);
    });
    it('accepts every registered id', async () => {
        for (const id of DATA_SOURCE_IDS) {
            const { res, next, captured } = capture();
            await createTestDataSourceHandler({ registry: fakeRegistry() })({ params: { id } }, res, next);
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
        await createTestDataSourceHandler({ registry })({ params: { id: 'macro' } }, res, next);
        assert.equal(captured.error, undefined);
        assert.equal(captured.body.ok, false);
        assert.equal(captured.body.detail, 'registry exploded');
    });
});
//# sourceMappingURL=datasources.test.js.map