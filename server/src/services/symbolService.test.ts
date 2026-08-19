import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSymbolService, type PricesSource } from "./symbolService.ts";
import type { PriceQuote } from "../datasources/prices/yahooPrices.ts";
import { SymbolNotFoundError, UpstreamError, ValidationError } from "../lib/errors.ts";

const AAPL_QUOTE: PriceQuote = {
  symbol: "AAPL",
  name: "Apple Inc.",
  price: 227.52,
  currency: "USD",
  timestamp: 1_755_547_200_000,
  exchange: "NasdaqGS",
  marketState: "CLOSED",
};

function service(quote: PricesSource["quote"]) {
  return createSymbolService({ prices: { quote } });
}

describe("symbolService.normalize", () => {
  const svc = service(async () => AAPL_QUOTE);

  it("trims and uppercases", () => {
    assert.equal(svc.normalize("  aapl "), "AAPL");
  });

  it("accepts punctuation used by classes, indices and FX", () => {
    assert.equal(svc.normalize("brk.b"), "BRK.B");
    assert.equal(svc.normalize("^gspc"), "^GSPC");
    assert.equal(svc.normalize("eurusd=x"), "EURUSD=X");
    assert.equal(svc.normalize("rds-a"), "RDS-A");
  });

  it("rejects non-strings", () => {
    assert.throws(() => svc.normalize(42), ValidationError);
    assert.throws(() => svc.normalize(undefined), ValidationError);
    assert.throws(() => svc.normalize(null), ValidationError);
  });

  it("rejects empty input", () => {
    assert.throws(() => svc.normalize("   "), /Symbol is required/);
  });

  it("rejects illegal characters and overlong input", () => {
    assert.throws(() => svc.normalize("AA PL"), /Invalid symbol/);
    assert.throws(() => svc.normalize("A;DROP"), /Invalid symbol/);
    assert.throws(() => svc.normalize("A".repeat(21)), /Invalid symbol/);
  });
});

describe("symbolService.validateSymbol", () => {
  it("returns name, price and currency for a valid symbol", async () => {
    const result = await service(async () => AAPL_QUOTE).validateSymbol("aapl");

    assert.deepEqual(result, {
      symbol: "AAPL",
      name: "Apple Inc.",
      price: 227.52,
      currency: "USD",
      timestamp: 1_755_547_200_000,
    });
  });

  it("passes the normalized symbol to the data source", async () => {
    const seen: string[] = [];
    await service(async (s) => {
      seen.push(s);
      return AAPL_QUOTE;
    }).validateSymbol(" aapl ");
    assert.deepEqual(seen, ["AAPL"]);
  });

  it("converts SymbolNotFoundError into a 400 with a clear message", async () => {
    await assert.rejects(
      () =>
        service(async () => {
          throw new SymbolNotFoundError("FAKE");
        }).validateSymbol("fake"),
      (err: unknown) => {
        assert.ok(err instanceof ValidationError);
        assert.equal(err.statusCode, 400);
        assert.match(err.message, /Unknown symbol "FAKE"/);
        return true;
      }
    );
  });

  it("propagates upstream failures as 502", async () => {
    await assert.rejects(
      () =>
        service(async () => {
          throw new UpstreamError("yahoo down", "yahoo-prices");
        }).validateSymbol("AAPL"),
      (err: unknown) => {
        assert.ok(err instanceof UpstreamError);
        assert.equal(err.statusCode, 502);
        return true;
      }
    );
  });

  it("wraps unexpected errors as upstream failures", async () => {
    await assert.rejects(
      () =>
        service(async () => {
          throw new Error("kaboom");
        }).validateSymbol("AAPL"),
      (err: unknown) => {
        assert.ok(err instanceof UpstreamError);
        assert.match(err.message, /Could not validate symbol "AAPL"/);
        return true;
      }
    );
  });

  it("rejects bad input without calling the data source", async () => {
    let called = false;
    await assert.rejects(
      () =>
        service(async () => {
          called = true;
          return AAPL_QUOTE;
        }).validateSymbol("not a symbol"),
      ValidationError
    );
    assert.equal(called, false);
  });
});
