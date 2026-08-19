import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FredMacroDataSource, DEFAULT_SERIES_IDS } from './fredMacro.ts';
import { HttpClient } from '../http.ts';
import { DataSourceNotConfiguredError, UpstreamError, ValidationError } from '../../lib/errors.ts';

const NOW = Date.parse('2026-08-18T12:00:00Z');

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function observations(rows: Array<[string, string]>, realtimeStart = '2026-08-18') {
  return {
    observations: rows.map(([date, value]) => ({
      realtime_start: realtimeStart,
      realtime_end: '9999-12-31',
      date,
      value,
    })),
  };
}

/** Serves per-series responses keyed by series_id. */
function harness(
  bySeries: Record<string, () => Response>,
  options: { key?: string | undefined; defaultSeriesIds?: string[] } = {}
) {
  const urls: string[] = [];
  const http = new HttpClient({
    name: 'fred-test',
    baseUrl: 'https://api.stlouisfed.org/fred/',
    rateLimit: { capacity: 100, refillPerSecond: 1000 },
    retry: { retries: 0, sleep: async () => {} },
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      const seriesId = new URL(url).searchParams.get('series_id') ?? '';
      const responder = bySeries[seriesId];
      return responder ? responder() : jsonResponse({ error_message: `no fixture for ${seriesId}` }, 400);
    },
  });

  const source = new FredMacroDataSource({
    http,
    now: () => NOW,
    resolveKey: () => ('key' in options ? options.key : 'test-key'),
    ...(options.defaultSeriesIds ? { defaultSeriesIds: options.defaultSeriesIds } : {}),
  });

  return { source, urls };
}

describe('FredMacroDataSource', () => {
  it('reports itself unconfigured without an API key', async () => {
    const { source } = harness({}, { key: undefined });

    assert.equal(source.isConfigured(), false);

    const health = await source.healthCheck();
    assert.equal(health.ok, false);
    assert.equal(health.configured, false);
    assert.equal(health.detail, 'Missing FRED_API_KEY');
    assert.equal(health.provider, 'fred');
    assert.equal(health.kind, 'macro');
  });

  it('throws a typed error when fetching without a key', async () => {
    const { source } = harness({}, { key: undefined });
    await assert.rejects(() => source.fetch({}), DataSourceNotConfiguredError);
  });

  it('returns latest, prior, delta and release date per series', async () => {
    const { source, urls } = harness(
      {
        DGS10: () =>
          jsonResponse(observations([
            ['2026-08-15', '4.25'],
            ['2026-08-14', '4.10'],
            ['2026-08-13', '4.05'],
          ], '2026-08-16')),
      },
      { defaultSeriesIds: ['DGS10'] }
    );

    const result = await source.fetch({});

    assert.match(urls[0]!, /series\/observations\?series_id=DGS10/);
    assert.match(urls[0]!, /sort_order=desc/);
    assert.equal(result.provider, 'fred');
    assert.equal(result.fetchedAt, NOW);
    assert.deepEqual(result.data.errors, []);
    assert.deepEqual(result.data.series, [
      {
        seriesId: 'DGS10',
        label: '10-Year Treasury Yield',
        latest: { date: '2026-08-15', value: 4.25 },
        prior: { date: '2026-08-14', value: 4.1 },
        change: 4.25 - 4.1,
        changePercent: ((4.25 - 4.1) / 4.1) * 100,
        releasedAt: '2026-08-16',
      },
    ]);
    assert.deepEqual(result.citations, [
      { title: 'FRED — 10-Year Treasury Yield', url: 'https://fred.stlouisfed.org/series/DGS10' },
    ]);
  });

  it('skips FRED\'s "." placeholders when picking latest and prior', async () => {
    const { source } = harness(
      {
        VIXCLS: () =>
          jsonResponse(observations([
            ['2026-08-17', '.'],
            ['2026-08-15', '14.2'],
            ['2026-08-14', '.'],
            ['2026-08-13', '15.0'],
          ])),
      },
      { defaultSeriesIds: ['VIXCLS'] }
    );

    const { data } = await source.fetch({});

    assert.deepEqual(data.series[0]!.latest, { date: '2026-08-15', value: 14.2 });
    assert.deepEqual(data.series[0]!.prior, { date: '2026-08-13', value: 15 });
  });

  it('fetches the curated series list by default', async () => {
    const bySeries = Object.fromEntries(
      DEFAULT_SERIES_IDS.map((id) => [id, () => jsonResponse(observations([['2026-08-15', '1']]))])
    );
    const { source, urls } = harness(bySeries);

    const { data } = await source.fetch({});

    assert.equal(urls.length, DEFAULT_SERIES_IDS.length);
    assert.deepEqual(
      data.series.map((s) => s.seriesId).sort(),
      [...DEFAULT_SERIES_IDS].sort()
    );
    // Single observation: no prior, so no delta.
    assert.equal(data.series[0]!.prior, null);
    assert.equal(data.series[0]!.change, null);
  });

  it('keeps healthy series when one of them fails', async () => {
    const { source } = harness(
      {
        DGS10: () => jsonResponse(observations([['2026-08-15', '4.25']])),
        UNRATE: () => jsonResponse({ error_message: 'series temporarily unavailable' }, 500),
        VIXCLS: () => jsonResponse(observations([['2026-08-15', '14.2']])),
      },
      { defaultSeriesIds: ['DGS10', 'UNRATE', 'VIXCLS'] }
    );

    const { data } = await source.fetch({});

    assert.deepEqual(data.series.map((s) => s.seriesId), ['DGS10', 'VIXCLS']);
    assert.equal(data.errors.length, 1);
    assert.equal(data.errors[0]!.seriesId, 'UNRATE');
    assert.match(data.errors[0]!.error, /HTTP 500/);
  });

  it('fails only when every series fails', async () => {
    const { source } = harness(
      { DGS10: () => jsonResponse({}, 500) },
      { defaultSeriesIds: ['DGS10'] }
    );

    await assert.rejects(() => source.fetch({}), UpstreamError);
  });

  it('surfaces the FRED error message for a rejected key', async () => {
    const { source } = harness(
      {
        DGS10: () =>
          jsonResponse(
            { error_code: 400, error_message: 'The value for variable api_key is not registered.' },
            400
          ),
      },
      { defaultSeriesIds: ['DGS10'] }
    );

    await assert.rejects(
      () => source.fetch({}),
      /FRED rejected the request \(HTTP 400\): The value for variable api_key is not registered\./
    );
  });

  it('treats an empty observation list as a series failure', async () => {
    const { source } = harness(
      { DGS10: () => jsonResponse({ observations: [] }) },
      { defaultSeriesIds: ['DGS10'] }
    );

    await assert.rejects(() => source.fetch({}), /no observations for DGS10/);
  });

  it('validates caller-supplied series ids', async () => {
    const { source } = harness({});

    await assert.rejects(() => source.fetch({ seriesIds: [] }), ValidationError);
    await assert.rejects(() => source.fetch({ seriesIds: ['DGS10; DROP'] }), ValidationError);
  });

  it('uppercases caller-supplied series ids', async () => {
    const { source, urls } = harness({
      DGS2: () => jsonResponse(observations([['2026-08-15', '3.9']])),
    });

    await source.fetch({ seriesIds: ['dgs2'] });

    assert.match(urls[0]!, /series_id=DGS2/);
  });

  it('healthCheck probes a single indicator', async () => {
    const { source, urls } = harness({
      GDP: () => jsonResponse(observations([['2026-04-01', '29975.1'], ['2026-01-01', '29500.0']])),
    });

    const health = await source.healthCheck();

    assert.equal(health.ok, true);
    assert.equal(urls.length, 1);
    assert.match(urls[0]!, /series_id=GDP/);
    assert.equal(health.detail, 'Fetched Gross Domestic Product: 29975.1 (2026-04-01)');
  });

  it('healthCheck degrades instead of throwing', async () => {
    const { source } = harness({ GDP: () => jsonResponse({}, 503) });

    const health = await source.healthCheck();

    assert.equal(health.ok, false);
    assert.equal(health.configured, true);
    assert.match(health.detail, /HTTP 503/);
  });
});
