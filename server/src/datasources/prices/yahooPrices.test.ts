import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { YahooPricesDataSource, normalizeSymbol, type YahooQuoteRaw } from "./yahooPrices.ts";
import { HttpClient } from "../http.ts";
import { SymbolNotFoundError, UpstreamError, ValidationError } from "../../lib/errors.ts";

/** No sleeping, no retries unless a test asks for them. */
function testHttp(retries = 0): HttpClient {
  return new HttpClient({
    name: "yahoo-prices-test",
    rateLimit: { capacity: 100, refillPerSecond: 1000 },
    retry: { retries, baseDelayMs: 1, jitter: false, sleep: async () => {} },
  });
}

/** Primary provider only; the chart fallback is covered separately. */
function source(quoteFn: (symbol: string) => Promise<YahooQuoteRaw | null | undefined>, retries = 0) {
  return new YahooPricesDataSource({ quoteFn, http: testHttp(retries), chartFallback: false });
}

const AAPL: YahooQuoteRaw = {
  symbol: "AAPL",
  shortName: "Apple Inc.",
  longName: "Apple Inc.",
  regularMarketPrice: 227.52,
  currency: "USD",
  regularMarketTime: new Date("2026-08-18T20:00:00Z"),
  fullExchangeName: "NasdaqGS",
  marketState: "CLOSED",
};

describe("normalizeSymbol", () => {
  it("trims and uppercases", () => {
    assert.equal(normalizeSymbol("  aapl "), "AAPL");
    assert.equal(normalizeSymbol("brk.b"), "BRK.B");
  });
});

describe("YahooPricesDataSource", () => {
  it("is always configured (no API key needed)", () => {
    assert.equal(source(async () => AAPL).isConfigured(), true);
  });

  it("exposes name and kind", () => {
    const src = source(async () => AAPL);
    assert.equal(src.name, "yahoo-prices");
    assert.equal(src.kind, "prices");
  });

  it("maps a quote payload to PriceQuote", async () => {
    const quote = await source(async () => AAPL).quote("aapl");

    assert.equal(quote.symbol, "AAPL");
    assert.equal(quote.name, "Apple Inc.");
    assert.equal(quote.price, 227.52);
    assert.equal(quote.currency, "USD");
    assert.equal(quote.timestamp, Date.parse("2026-08-18T20:00:00Z"));
    assert.equal(quote.exchange, "NasdaqGS");
    assert.equal(quote.marketState, "CLOSED");
  });

  it("normalizes the symbol before calling the provider", async () => {
    const seen: string[] = [];
    await source(async (s) => {
      seen.push(s);
      return AAPL;
    }).quote("  aapl  ");
    assert.deepEqual(seen, ["AAPL"]);
  });

  it("falls back through name fields and defaults currency to USD", async () => {
    const quote = await source(async () => ({
      symbol: "XYZ",
      displayName: "Xyz Corp",
      regularMarketPrice: 10,
    })).quote("XYZ");

    assert.equal(quote.name, "Xyz Corp");
    assert.equal(quote.currency, "USD");
  });

  it("uses the raw symbol as the name when the provider gives none", async () => {
    const quote = await source(async () => ({ regularMarketPrice: 1 })).quote("ZZZ");
    assert.equal(quote.name, "ZZZ");
    assert.equal(quote.symbol, "ZZZ");
  });

  it("converts second-precision timestamps to milliseconds", async () => {
    const quote = await source(async () => ({
      regularMarketPrice: 1,
      regularMarketTime: 1_700_000_000,
    })).quote("ZZZ");
    assert.equal(quote.timestamp, 1_700_000_000_000);
  });

  it("throws SymbolNotFoundError when the provider returns nothing", async () => {
    await assert.rejects(
      () => source(async () => undefined).quote("NOPE"),
      (err: unknown) => {
        assert.ok(err instanceof SymbolNotFoundError);
        assert.equal(err.symbol, "NOPE");
        assert.equal(err.statusCode, 404);
        return true;
      }
    );
  });

  it("throws SymbolNotFoundError when the payload has no price", async () => {
    await assert.rejects(
      () => source(async () => ({ symbol: "NOPE" })).quote("NOPE"),
      SymbolNotFoundError
    );
  });

  it("maps provider not-found messages to SymbolNotFoundError", async () => {
    await assert.rejects(
      () =>
        source(async () => {
          throw new Error("Quote not found for symbol: FAKE");
        }).quote("FAKE"),
      SymbolNotFoundError
    );
  });

  it("maps transport failures to UpstreamError", async () => {
    await assert.rejects(
      () =>
        source(async () => {
          throw new Error("fetch failed");
        }).quote("AAPL"),
      (err: unknown) => {
        assert.ok(err instanceof UpstreamError);
        assert.equal(err.statusCode, 502);
        return true;
      }
    );
  });

  it("rejects blank input before hitting the network", async () => {
    let called = false;
    const src = source(async () => {
      called = true;
      return AAPL;
    });

    await assert.rejects(() => src.quote("   "), ValidationError);
    assert.equal(called, false);
  });

  it("retries transient provider failures", async () => {
    let calls = 0;
    const quote = await source(async () => {
      calls += 1;
      if (calls < 3) throw new Error("Too Many Requests");
      return AAPL;
    }, 3).quote("AAPL");

    assert.equal(calls, 3);
    assert.equal(quote.price, 227.52);
  });

  it("does not retry a missing symbol", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        source(async () => {
          calls += 1;
          return undefined;
        }, 3).quote("NOPE"),
      SymbolNotFoundError
    );
    assert.equal(calls, 1);
  });

  it("fetch() delegates to quote()", async () => {
    const quote = await source(async () => AAPL).fetch({ symbol: "AAPL" });
    assert.equal(quote.symbol, "AAPL");
  });

  it("healthCheck() reports ok when the probe symbol resolves", async () => {
    const seen: string[] = [];
    const health = await source(async (s) => {
      seen.push(s);
      return AAPL;
    }).healthCheck();

    assert.equal(health.ok, true);
    assert.equal(health.configured, true);
    assert.equal(health.name, "yahoo-prices");
    assert.equal(health.kind, "prices");
    assert.ok(typeof health.latencyMs === "number");
    assert.deepEqual(seen, ["AAPL"], "probes with a common symbol");
  });

  it("falls back to the chart provider when the primary is throttled", async () => {
    let chartCalls = 0;
    const src = new YahooPricesDataSource({
      quoteFn: async () => {
        throw new Error("Too Many Requests");
      },
      chartFn: async () => {
        chartCalls += 1;
        return AAPL;
      },
      http: testHttp(),
    });

    const quote = await src.quote("AAPL");
    assert.equal(chartCalls, 1);
    assert.equal(quote.price, 227.52);
  });

  it("does not fall back when the primary confirms the symbol is unknown", async () => {
    let chartCalls = 0;
    const src = new YahooPricesDataSource({
      quoteFn: async () => undefined,
      chartFn: async () => {
        chartCalls += 1;
        return AAPL;
      },
      http: testHttp(),
    });

    await assert.rejects(() => src.quote("NOPE"), SymbolNotFoundError);
    assert.equal(chartCalls, 0);
  });

  it("surfaces the fallback failure when both providers fail", async () => {
    const src = new YahooPricesDataSource({
      quoteFn: async () => {
        throw new Error("Too Many Requests");
      },
      chartFn: async () => {
        throw new Error("fetch failed");
      },
      http: testHttp(),
    });

    await assert.rejects(() => src.quote("AAPL"), UpstreamError);
  });

  it("reads a price from the live chart endpoint payload", async () => {
    const http = new HttpClient({
      name: "yahoo-prices-test",
      baseUrl: "https://query1.finance.yahoo.com/",
      rateLimit: { capacity: 100, refillPerSecond: 1000 },
      retry: { retries: 0 },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            chart: {
              result: [
                {
                  meta: {
                    symbol: "AAPL",
                    shortName: "Apple Inc.",
                    regularMarketPrice: 310.03,
                    currency: "USD",
                    regularMarketTime: 1_787_083_202,
                    fullExchangeName: "NasdaqGS",
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        ),
    });
    const src = new YahooPricesDataSource({
      quoteFn: async () => {
        throw new Error("Too Many Requests");
      },
      http,
    });

    const quote = await src.quote("AAPL");
    assert.equal(quote.price, 310.03);
    assert.equal(quote.name, "Apple Inc.");
    assert.equal(quote.currency, "USD");
    assert.equal(quote.timestamp, 1_787_083_202_000);
  });

  it("maps a chart 404 to SymbolNotFoundError", async () => {
    const http = new HttpClient({
      name: "yahoo-prices-test",
      baseUrl: "https://query1.finance.yahoo.com/",
      rateLimit: { capacity: 100, refillPerSecond: 1000 },
      retry: { retries: 0 },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ chart: { result: null, error: { code: "Not Found" } } }),
          { status: 404 }
        ),
    });
    const src = new YahooPricesDataSource({
      quoteFn: async () => {
        throw new Error("Too Many Requests");
      },
      http,
    });

    await assert.rejects(() => src.quote("ZZZZQQ"), SymbolNotFoundError);
  });

  it("healthCheck() reports the failure instead of throwing", async () => {
    const health = await source(async () => {
      throw new Error("fetch failed");
    }).healthCheck();

    assert.equal(health.ok, false);
    assert.equal(health.configured, true);
    assert.match(String(health.error), /Yahoo Finance/);
  });
});
