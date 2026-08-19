import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  YahooOptionsDataSource,
  type YahooOptionsFn,
  type YahooOptionsRaw,
} from './yahooOptions.ts';
import { HttpClient } from '../http.ts';
import { SymbolNotFoundError, UpstreamError, ValidationError } from '../../lib/errors.ts';

const NOW = Date.parse('2026-08-18T12:00:00Z');
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

function testHttp(): HttpClient {
  return new HttpClient({
    name: 'yahoo-options-test',
    rateLimit: { capacity: 100, refillPerSecond: 1000 },
    retry: { retries: 0, baseDelayMs: 1, jitter: false, sleep: async () => {} },
  });
}

/** Yahoo path only; the CBOE fallback is covered separately. */
function source(optionsFn: YahooOptionsFn, timeoutMs = 1000) {
  return new YahooOptionsDataSource({
    optionsFn,
    http: testHttp(),
    timeoutMs,
    now: () => NOW,
    cboeFallback: false,
  });
}

const CHAIN: YahooOptionsRaw = {
  underlyingSymbol: 'AAPL',
  expirationDates: [new Date(utc('2026-09-18')), new Date(utc('2026-08-21'))],
  strikes: [220, 225, 230],
  quote: { regularMarketPrice: 227.52 },
  options: [
    {
      expirationDate: new Date(utc('2026-08-21')),
      calls: [
        {
          contractSymbol: 'AAPL260821C00225000',
          strike: 225,
          lastPrice: 5.2,
          bid: 5.1,
          ask: 5.3,
          volume: 1200,
          openInterest: 400,
          impliedVolatility: 0.27,
          inTheMoney: true,
          expiration: new Date(utc('2026-08-21')),
        },
        {
          contractSymbol: 'AAPL260821C00230000',
          strike: 230,
          lastPrice: 2.1,
          bid: 2,
          ask: 2.2,
          volume: 300,
          openInterest: 600,
          impliedVolatility: 0.3,
          inTheMoney: false,
          expiration: new Date(utc('2026-08-21')),
        },
      ],
      puts: [
        {
          contractSymbol: 'AAPL260821P00225000',
          strike: 225,
          lastPrice: 3.4,
          bid: 3.3,
          ask: 3.5,
          volume: 800,
          openInterest: 900,
          impliedVolatility: 0.34,
          inTheMoney: false,
          expiration: new Date(utc('2026-08-21')),
        },
      ],
    },
  ],
};

describe('YahooOptionsDataSource', () => {
  it('needs no API key', () => {
    const src = source(async () => CHAIN);
    assert.equal(src.isConfigured(), true);
    assert.equal(src.name, 'yahoo-options');
    assert.equal(src.kind, 'options');
    assert.equal(src.provider, 'yahoo');
  });

  it('normalizes the chain and derives metrics locally', async () => {
    const result = await source(async () => CHAIN).fetch({ symbol: 'aapl' });

    assert.equal(result.provider, 'yahoo');
    assert.equal(result.fetchedAt, NOW);
    assert.deepEqual(result.citations, [
      {
        title: 'Yahoo Finance — AAPL option chain',
        url: 'https://finance.yahoo.com/quote/AAPL/options',
      },
    ]);

    const { data } = result;
    assert.equal(data.symbol, 'AAPL');
    assert.equal(data.underlyingPrice, 227.52);
    assert.equal(data.expiration, utc('2026-08-21'));
    // Expirations come back sorted regardless of provider order.
    assert.deepEqual(data.expirationDates, [utc('2026-08-21'), utc('2026-09-18')]);

    assert.equal(data.calls.length, 2);
    assert.equal(data.puts.length, 1);
    assert.equal(data.calls[0]!.contractSymbol, 'AAPL260821C00225000');
    assert.equal(data.calls[0]!.volumeOpenInterestRatio, 3);
    assert.equal(data.calls[0]!.unusualVolume, true);
    assert.equal(data.calls[1]!.unusualVolume, false);

    assert.equal(data.metrics.callOpenInterest, 1000);
    assert.equal(data.metrics.putOpenInterest, 900);
    assert.equal(data.metrics.putCallOpenInterestRatio, 0.9);
    assert.deepEqual(data.metrics.unusualContracts, ['AAPL260821C00225000']);
    assert.equal(data.metrics.maxPainStrike, 225);
  });

  it('builds the OpEx calendar from listed expirations', async () => {
    const { data } = await source(async () => CHAIN).fetch({ symbol: 'AAPL' });

    assert.equal(data.calendar.nextExpiry, utc('2026-08-21'));
    assert.equal(data.calendar.daysToNextExpiry, 3);
    assert.equal(data.calendar.nextMonthlyOpEx, utc('2026-08-21'));
    assert.equal(data.calendar.nextMonthlyIsQuarterly, false);
    assert.equal(data.calendar.nextQuarterlyOpEx, utc('2026-09-18'));
  });

  it('passes an explicit expiration through to the provider', async () => {
    const seen: Array<{ symbol: string; date?: Date }> = [];
    await source(async (symbol, query) => {
      seen.push({ symbol, ...(query.date ? { date: query.date } : {}) });
      return CHAIN;
    }).fetch({ symbol: 'AAPL', expiration: utc('2026-09-18') });

    assert.equal(seen[0]!.symbol, 'AAPL');
    assert.equal(seen[0]!.date?.getTime(), utc('2026-09-18'));
  });

  it('rejects bad input before making a request', async () => {
    const src = source(async () => CHAIN);
    await assert.rejects(() => src.fetch({ symbol: '' }), ValidationError);
    await assert.rejects(
      () => src.fetch({ symbol: 'AAPL', expiration: Number.NaN }),
      ValidationError
    );
  });

  it('treats a chainless payload as an unknown symbol', async () => {
    await assert.rejects(
      () => source(async () => ({ underlyingSymbol: 'ZZZZ' })).fetch({ symbol: 'ZZZZ' }),
      SymbolNotFoundError
    );
    await assert.rejects(
      () => source(async () => null).fetch({ symbol: 'ZZZZ' }),
      SymbolNotFoundError
    );
  });

  it('maps a provider "no options" message to SymbolNotFoundError', async () => {
    await assert.rejects(
      () =>
        source(async () => {
          throw new Error('No options found for ZZZZ');
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
        assert.match(err.message, /Could not reach Yahoo Finance for "AAPL" options/);
        return true;
      }
    );
  });

  it('tolerates an empty chain without throwing', async () => {
    const { data } = await source(async () => ({
      underlyingSymbol: 'XYZ',
      expirationDates: [],
      options: [{ expirationDate: new Date(utc('2026-08-21')), calls: [], puts: [] }],
    })).fetch({ symbol: 'XYZ' });

    assert.deepEqual(data.calls, []);
    assert.deepEqual(data.puts, []);
    assert.equal(data.metrics.totalOpenInterest, 0);
    assert.equal(data.metrics.maxPainStrike, null);
    assert.equal(data.calendar.nextExpiry, null);
  });

  it('bounds a hanging provider call with a timeout', async () => {
    await assert.rejects(
      () => source(() => new Promise(() => {}), 10).fetch({ symbol: 'AAPL' }),
      /timed out after 10ms/
    );
  });

  it('healthCheck reports ok with a chain summary', async () => {
    const health = await source(async () => CHAIN).healthCheck();

    assert.equal(health.ok, true);
    assert.equal(health.configured, true);
    assert.match(
      health.detail,
      /Fetched AAPL chain via yahoo: 2 calls \/ 1 puts, P\/C OI 0\.90, next expiry in 3d/
    );
  });

  it('healthCheck degrades instead of throwing', async () => {
    const health = await source(async () => {
      throw new Error('network down');
    }).healthCheck();

    assert.equal(health.ok, false);
    assert.match(health.detail, /network down/);
  });
});

describe('YahooOptionsDataSource CBOE fallback', () => {
  const CBOE_CHAIN: YahooOptionsRaw = {
    underlyingSymbol: 'AAPL',
    expirationDates: [utc('2026-08-21')],
    quote: { regularMarketPrice: 310.22 },
    options: [
      {
        expirationDate: utc('2026-08-21'),
        calls: [
          {
            contractSymbol: 'AAPL260821C00310000',
            strike: 310,
            volume: 100,
            openInterest: 50,
            impliedVolatility: 0.29,
            expiration: utc('2026-08-21'),
          },
        ],
        puts: [],
      },
    ],
  };

  function fallbackSource(
    optionsFn: YahooOptionsFn,
    cboeFn: (symbol: string, query: { expiration?: number }) => Promise<YahooOptionsRaw>
  ) {
    return new YahooOptionsDataSource({
      optionsFn,
      cboeFn,
      http: testHttp(),
      timeoutMs: 1000,
      now: () => NOW,
    });
  }

  it('falls back to CBOE when Yahoo is throttled', async () => {
    const src = fallbackSource(
      async () => {
        // What Yahoo's crumb flow actually produces when throttled.
        throw new Error(`Unexpected token 'T', "Too Many Requests" is not valid JSON`);
      },
      async () => CBOE_CHAIN
    );

    const result = await src.fetch({ symbol: 'AAPL' });

    assert.equal(result.provider, 'cboe');
    assert.equal(result.data.servedBy, 'cboe');
    assert.equal(result.data.underlyingPrice, 310.22);
    assert.equal(result.data.calls.length, 1);
    assert.deepEqual(result.citations, [
      {
        title: 'CBOE delayed quotes — AAPL option chain',
        url: 'https://www.cboe.com/delayed_quotes/aapl/quote_table',
      },
    ]);
  });

  it('forwards the requested expiration to the fallback', async () => {
    const seen: Array<{ symbol: string; expiration?: number }> = [];
    const src = fallbackSource(
      async () => {
        throw new Error('socket hang up');
      },
      async (symbol, query) => {
        seen.push({ symbol, ...query });
        return CBOE_CHAIN;
      }
    );

    await src.fetch({ symbol: 'AAPL', expiration: utc('2026-09-18') });

    assert.deepEqual(seen, [{ symbol: 'AAPL', expiration: utc('2026-09-18') }]);
  });

  it('does not fall back for a definitively unknown symbol', async () => {
    let fallbackCalls = 0;
    const src = fallbackSource(
      async () => null,
      async () => {
        fallbackCalls += 1;
        return CBOE_CHAIN;
      }
    );

    await assert.rejects(() => src.fetch({ symbol: 'ZZZZ' }), SymbolNotFoundError);
    assert.equal(fallbackCalls, 0);
  });

  it('surfaces the fallback failure when both upstreams are down', async () => {
    const src = fallbackSource(
      async () => {
        throw new Error('yahoo down');
      },
      async () => {
        throw new UpstreamError('Could not reach CBOE for "AAPL" options: offline', 'cboe-options');
      }
    );

    await assert.rejects(() => src.fetch({ symbol: 'AAPL' }), /Could not reach CBOE/);
  });

  it('healthCheck reports which upstream served the chain', async () => {
    const health = await fallbackSource(
      async () => {
        throw new Error('yahoo down');
      },
      async () => CBOE_CHAIN
    ).healthCheck();

    assert.equal(health.ok, true);
    assert.match(health.detail, /Fetched AAPL chain via cboe/);
  });
});
