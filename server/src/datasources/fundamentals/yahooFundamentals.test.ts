import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  YahooFundamentalsDataSource,
  QUOTE_SUMMARY_MODULES,
  type QuoteSummaryRaw,
  type QuoteSummaryFn,
} from './yahooFundamentals.ts';
import { HttpClient } from '../http.ts';
import { SymbolNotFoundError, UpstreamError, ValidationError } from '../../lib/errors.ts';

const NOW = Date.parse('2026-08-18T12:00:00Z');

function testHttp(retries = 0): HttpClient {
  return new HttpClient({
    name: 'yahoo-fundamentals-test',
    rateLimit: { capacity: 100, refillPerSecond: 1000 },
    retry: { retries, baseDelayMs: 1, jitter: false, sleep: async () => {} },
  });
}

function source(quoteSummaryFn: QuoteSummaryFn, timeoutMs = 1000) {
  return new YahooFundamentalsDataSource({
    quoteSummaryFn,
    http: testHttp(),
    timeoutMs,
    now: () => NOW,
  });
}

const AAPL: QuoteSummaryRaw = {
  price: {
    longName: 'Apple Inc.',
    shortName: 'Apple',
    currency: 'USD',
    regularMarketPrice: 227.52,
  },
  summaryDetail: {
    trailingPE: 34.5,
    forwardPE: 29.1,
    marketCap: 3_400_000_000_000,
    beta: 1.24,
    dividendYield: 0.0044,
  },
  defaultKeyStatistics: {
    enterpriseValue: 3_450_000_000_000,
    pegRatio: 2.1,
    priceToBook: 51.2,
    trailingEps: 6.6,
    forwardEps: 7.8,
  },
  financialData: {
    currentPrice: 227.52,
    targetMeanPrice: 245.3,
    recommendationKey: 'buy',
    returnOnEquity: 1.47,
    returnOnAssets: 0.22,
    debtToEquity: 151.9,
    revenueGrowth: 0.049,
    earningsGrowth: 0.11,
    grossMargins: 0.462,
    operatingMargins: 0.315,
    profitMargins: 0.263,
    currentRatio: 0.87,
    quickRatio: 0.75,
    totalRevenue: 391_000_000_000,
    totalCash: 61_800_000_000,
    totalDebt: 106_600_000_000,
    freeCashflow: 108_800_000_000,
    financialCurrency: 'USD',
  },
  earnings: {
    earningsChart: {
      quarterly: [
        { date: '2Q2026', actual: 1.4, estimate: 1.35 },
        { date: '3Q2026', actual: { raw: 1.64 }, estimate: 1.6 },
      ],
    },
  },
  calendarEvents: {
    earnings: {
      earningsDate: [
        new Date('2026-05-01T00:00:00Z'),
        new Date('2026-10-30T00:00:00Z'),
        new Date('2026-11-03T00:00:00Z'),
      ],
      earningsAverage: 1.72,
      earningsLow: 1.6,
      earningsHigh: 1.85,
    },
    exDividendDate: new Date('2026-08-08T00:00:00Z'),
    dividendDate: '2026-08-15T00:00:00Z',
  },
};

describe('YahooFundamentalsDataSource', () => {
  it('needs no API key', () => {
    const src = source(async () => AAPL);
    assert.equal(src.isConfigured(), true);
    assert.equal(src.name, 'yahoo-fundamentals');
    assert.equal(src.kind, 'fundamentals');
    assert.equal(src.provider, 'yahoo');
  });

  it('requests exactly the modules doc 02 specifies', async () => {
    const seen: Array<{ symbol: string; modules: readonly string[] }> = [];
    await source(async (symbol, modules) => {
      seen.push({ symbol, modules });
      return AAPL;
    }).fetch({ symbol: ' aapl ' });

    assert.equal(seen[0]!.symbol, 'AAPL');
    assert.deepEqual([...seen[0]!.modules], [...QUOTE_SUMMARY_MODULES]);
  });

  it('normalizes valuation, margin and balance-sheet fields', async () => {
    const { data, provider, fetchedAt, citations } = await source(async () => AAPL).fetch({
      symbol: 'AAPL',
    });

    assert.equal(provider, 'yahoo');
    assert.equal(fetchedAt, NOW);
    assert.deepEqual(citations, [
      {
        title: 'Yahoo Finance — AAPL key statistics',
        url: 'https://finance.yahoo.com/quote/AAPL/key-statistics',
      },
    ]);

    assert.equal(data.name, 'Apple Inc.');
    assert.equal(data.currency, 'USD');
    assert.equal(data.price, 227.52);
    assert.equal(data.trailingPE, 34.5);
    assert.equal(data.forwardPE, 29.1);
    assert.equal(data.priceToBook, 51.2);
    assert.equal(data.profitMargins, 0.263);
    assert.equal(data.revenueGrowth, 0.049);
    assert.equal(data.debtToEquity, 151.9);
    assert.equal(data.freeCashflow, 108_800_000_000);
    assert.equal(data.recommendationKey, 'buy');
  });

  it('picks the next upcoming earnings date for the blackout rule', async () => {
    const { data } = await source(async () => AAPL).fetch({ symbol: 'AAPL' });

    assert.equal(data.earnings.nextEarningsDate, Date.parse('2026-10-30T00:00:00Z'));
    assert.deepEqual(data.earnings.earningsDates, [
      Date.parse('2026-05-01T00:00:00Z'),
      Date.parse('2026-10-30T00:00:00Z'),
      Date.parse('2026-11-03T00:00:00Z'),
    ]);
    assert.equal(data.earnings.estimateAverage, 1.72);
    assert.equal(data.earnings.exDividendDate, Date.parse('2026-08-08T00:00:00Z'));
    assert.equal(data.earnings.dividendDate, Date.parse('2026-08-15T00:00:00Z'));
    assert.deepEqual(data.earnings.recentQuarters, [
      { period: '2Q2026', actual: 1.4, estimate: 1.35 },
      { period: '3Q2026', actual: 1.64, estimate: 1.6 },
    ]);
  });

  it('falls back to the most recent date when every earnings date is past', async () => {
    const { data } = await source(async () => ({
      ...AAPL,
      calendarEvents: { earnings: { earningsDate: [new Date('2026-01-30T00:00:00Z')] } },
    })).fetch({ symbol: 'AAPL' });

    assert.equal(data.earnings.nextEarningsDate, Date.parse('2026-01-30T00:00:00Z'));
  });

  it('coerces {raw} wrappers and drops non-finite numbers', async () => {
    const { data } = await source(async () => ({
      price: { shortName: 'Xyz' },
      summaryDetail: { trailingPE: { raw: 12.5 }, marketCap: { raw: Number.NaN } },
    })).fetch({ symbol: 'XYZ' });

    assert.equal(data.trailingPE, 12.5);
    assert.equal(data.marketCap, null);
    assert.equal(data.price, null);
    assert.equal(data.earnings.nextEarningsDate, null);
    assert.deepEqual(data.earnings.earningsDates, []);
  });

  it('rejects a missing symbol before making a request', async () => {
    let called = false;
    const src = source(async () => {
      called = true;
      return AAPL;
    });
    await assert.rejects(() => src.fetch({ symbol: '  ' }), ValidationError);
    assert.equal(called, false);
  });

  it('maps an empty payload to SymbolNotFoundError', async () => {
    await assert.rejects(() => source(async () => ({})).fetch({ symbol: 'NOPE' }), SymbolNotFoundError);
    await assert.rejects(
      () => source(async () => null).fetch({ symbol: 'NOPE' }),
      SymbolNotFoundError
    );
  });

  it('maps a provider "not found" message to SymbolNotFoundError', async () => {
    await assert.rejects(
      () =>
        source(async () => {
          throw new Error('Quote not found for ticker symbol: ZZZZ');
        }).fetch({ symbol: 'ZZZZ' }),
      SymbolNotFoundError
    );
  });

  it('maps transport failures to UpstreamError', async () => {
    await assert.rejects(
      () =>
        source(async () => {
          throw new Error('socket hang up');
        }).fetch({ symbol: 'AAPL' }),
      (err: unknown) => {
        assert.ok(err instanceof UpstreamError);
        assert.match(err.message, /Could not reach Yahoo Finance for "AAPL" fundamentals/);
        return true;
      }
    );
  });

  it('explains a Yahoo throttle instead of leaking a parser error', async () => {
    await assert.rejects(
      () =>
        source(async () => {
          throw new Error(`Unexpected token 'T', "Too Many Requests" is not valid JSON`);
        }).fetch({ symbol: 'AAPL' }),
      /Yahoo Finance is throttling this host \(Too Many Requests\)/
    );
  });

  it('bounds a hanging provider call with a timeout', async () => {
    const src = source(() => new Promise(() => {}), 10);

    await assert.rejects(() => src.fetch({ symbol: 'AAPL' }), /timed out after 10ms/);
  });

  it('healthCheck reports ok with a fundamentals summary', async () => {
    const health = await source(async () => AAPL).healthCheck();

    assert.equal(health.ok, true);
    assert.equal(health.configured, true);
    assert.match(health.detail, /Fetched AAPL fundamentals \(trailing P\/E 34\.50, market cap 3400\.0B\)/);
  });

  it('healthCheck degrades instead of throwing', async () => {
    const health = await source(async () => {
      throw new Error('network down');
    }).healthCheck();

    assert.equal(health.ok, false);
    assert.match(health.detail, /network down/);
    assert.ok((health.latencyMs ?? 0) >= 0);
  });
});
