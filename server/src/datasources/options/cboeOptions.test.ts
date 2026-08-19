import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchCboeChain,
  parseOsiSymbol,
  toChain,
  type CboeOptionsResponse,
} from './cboeOptions.ts';
import { HttpClient } from '../http.ts';
import { SymbolNotFoundError, UpstreamError } from '../../lib/errors.ts';

const NOW = Date.parse('2026-08-18T12:00:00Z');
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

const BODY: CboeOptionsResponse = {
  timestamp: '2026-08-18 16:00:00',
  symbol: 'AAPL',
  data: {
    symbol: 'AAPL',
    current_price: 310.22,
    close: 310.03,
    options: [
      {
        option: 'AAPL260821C00305000',
        bid: 7.1,
        ask: 7.3,
        iv: 0.26,
        open_interest: 1200,
        volume: 400,
        last_trade_price: 7.2,
      },
      {
        option: 'AAPL260821P00305000',
        bid: 2.1,
        ask: 2.3,
        iv: 0.31,
        open_interest: 800,
        volume: 1900,
        last_trade_price: 2.2,
      },
      // A later expiry: listed, but not part of the returned chain.
      { option: 'AAPL260918C00310000', open_interest: 10, volume: 5, iv: 0.28 },
      // Unparseable rows are skipped rather than throwing.
      { option: 'not-an-osi-symbol', volume: 1 },
    ],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function client(respond: () => Response, urls: string[] = []): HttpClient {
  return new HttpClient({
    name: 'cboe-test',
    baseUrl: 'https://cdn.cboe.com/api/global/delayed_quotes/options/',
    rateLimit: { capacity: 100, refillPerSecond: 1000 },
    retry: { retries: 0, sleep: async () => {} },
    fetchImpl: async (input) => {
      urls.push(String(input));
      return respond();
    },
  });
}

describe('parseOsiSymbol', () => {
  it('splits root, expiry, type and strike', () => {
    assert.deepEqual(parseOsiSymbol('AAPL260821C00225000'), {
      root: 'AAPL',
      expiration: utc('2026-08-21'),
      type: 'call',
      strike: 225,
    });
  });

  it('handles puts, fractional strikes and long roots', () => {
    assert.equal(parseOsiSymbol('SPY260918P00612500')!.type, 'put');
    assert.equal(parseOsiSymbol('SPY260918P00612500')!.strike, 612.5);
    assert.equal(parseOsiSymbol('BRKB261218C00500000')!.root, 'BRKB');
  });

  it('rejects malformed symbols', () => {
    assert.equal(parseOsiSymbol('AAPL'), null);
    assert.equal(parseOsiSymbol('AAPL261332C00225000'), null); // month 13
    assert.equal(parseOsiSymbol('AAPL260821X00225000'), null); // bad type
  });
});

describe('toChain', () => {
  it('selects the nearest upcoming expiry and lists them all', () => {
    const chain = toChain(BODY, 'AAPL', { now: NOW });

    assert.deepEqual(chain.expirationDates, [utc('2026-08-21'), utc('2026-09-18')]);
    assert.equal(chain.options![0]!.expirationDate, utc('2026-08-21'));
    assert.equal(chain.options![0]!.calls!.length, 1);
    assert.equal(chain.options![0]!.puts!.length, 1);
    assert.equal(chain.quote!.regularMarketPrice, 310.22);
    assert.equal(chain.underlyingSymbol, 'AAPL');
  });

  it('maps CBOE field names onto the shared chain shape', () => {
    const call = toChain(BODY, 'AAPL', { now: NOW }).options![0]!.calls![0]!;

    assert.deepEqual(call, {
      contractSymbol: 'AAPL260821C00305000',
      strike: 305,
      lastPrice: 7.2,
      bid: 7.1,
      ask: 7.3,
      volume: 400,
      openInterest: 1200,
      impliedVolatility: 0.26,
      // Derived: CBOE does not publish moneyness.
      inTheMoney: true,
      expiration: utc('2026-08-21'),
    });
  });

  it('derives moneyness per side', () => {
    const put = toChain(BODY, 'AAPL', { now: NOW }).options![0]!.puts![0]!;
    assert.equal(put.inTheMoney, false);
  });

  it('snaps a requested expiration to the closest listed one', () => {
    const chain = toChain(BODY, 'AAPL', { now: NOW, expiration: utc('2026-09-20') });

    assert.equal(chain.options![0]!.expirationDate, utc('2026-09-18'));
    assert.equal(chain.options![0]!.calls!.length, 1);
  });

  it('tolerates an empty document', () => {
    const chain = toChain({ data: { options: [] } }, 'XYZ', { now: NOW });

    assert.deepEqual(chain.expirationDates, []);
    assert.deepEqual(chain.options![0]!.calls, []);
    assert.equal(chain.underlyingSymbol, 'XYZ');
  });
});

describe('fetchCboeChain', () => {
  it('requests the per-symbol document and reshapes it', async () => {
    const urls: string[] = [];
    const chain = await fetchCboeChain(client(() => jsonResponse(BODY), urls), 'AAPL', { now: NOW });

    assert.deepEqual(urls, ['https://cdn.cboe.com/api/global/delayed_quotes/options/AAPL.json']);
    assert.equal(chain.options![0]!.calls!.length, 1);
  });

  it('maps a missing document to SymbolNotFoundError', async () => {
    await assert.rejects(
      () => fetchCboeChain(client(() => jsonResponse({}, 404)), 'ZZZZ', { now: NOW }),
      SymbolNotFoundError
    );
  });

  it('maps a payload without an options array to SymbolNotFoundError', async () => {
    await assert.rejects(
      () => fetchCboeChain(client(() => jsonResponse({ data: {} })), 'ZZZZ', { now: NOW }),
      SymbolNotFoundError
    );
  });

  it('maps transport failures to UpstreamError', async () => {
    await assert.rejects(
      () => fetchCboeChain(client(() => jsonResponse({}, 503)), 'AAPL', { now: NOW }),
      (err: unknown) => {
        assert.ok(err instanceof UpstreamError);
        assert.match(err.message, /Could not reach CBOE for "AAPL" options/);
        return true;
      }
    );
  });
});
