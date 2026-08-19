import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrate.ts";
import { WatchlistRepo } from "./watchlistRepo.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "../db/migrations");

describe("WatchlistRepo", () => {
  let db: Database.Database;
  let repo: WatchlistRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db, migrationsDir);
    repo = new WatchlistRepo(db);
  });

  it("list() returns empty array when no watchlist items exist", () => {
    const result = repo.list();
    assert.deepEqual(result, []);
  });

  it("get() returns undefined when symbol doesn't exist", () => {
    const result = repo.get("AAPL");
    assert.equal(result, undefined);
  });

  it("upsert() and get() round-trip", () => {
    const now = Date.now();
    const row = {
      symbol: "AAPL",
      enabled: true,
      note: "Tech stock",
      addedAt: now,
    };

    repo.upsert(row);
    const result = repo.get("AAPL");

    assert.ok(result);
    assert.deepEqual(result, row);
  });

  it("upsert() converts enabled boolean to/from integer", () => {
    const now = Date.now();

    repo.upsert({ symbol: "AAPL", enabled: false, note: null, addedAt: now });
    const result = repo.get("AAPL");

    assert.ok(result);
    assert.equal(result.enabled, false);
    assert.equal(typeof result.enabled, "boolean");
  });

  it("upsert() updates enabled and note on conflict, preserves addedAt", () => {
    const now = Date.now();

    repo.upsert({ symbol: "AAPL", enabled: true, note: "Original", addedAt: now });
    repo.upsert({ symbol: "AAPL", enabled: false, note: "Updated", addedAt: now + 10000 });

    const result = repo.get("AAPL");
    assert.ok(result);
    assert.equal(result.enabled, false);
    assert.equal(result.note, "Updated");
    assert.equal(result.addedAt, now, "addedAt should not change on upsert");
  });

  it("remove() deletes a symbol", () => {
    const now = Date.now();
    repo.upsert({ symbol: "AAPL", enabled: true, note: null, addedAt: now });
    assert.ok(repo.get("AAPL"), "symbol should exist");

    repo.remove("AAPL");
    assert.equal(repo.get("AAPL"), undefined, "symbol should be deleted");
  });

  it("remove() is idempotent (no error if symbol doesn't exist)", () => {
    assert.doesNotThrow(() => {
      repo.remove("NONEXISTENT");
    });
  });

  it("list() returns all symbols sorted alphabetically", () => {
    const now = Date.now();

    repo.upsert({ symbol: "ZEBRA", enabled: true, note: null, addedAt: now });
    repo.upsert({ symbol: "APPLE", enabled: true, note: null, addedAt: now + 100 });
    repo.upsert({ symbol: "BANANA", enabled: true, note: null, addedAt: now + 200 });

    const result = repo.list();

    assert.equal(result.length, 3);
    assert.equal(result[0].symbol, "APPLE");
    assert.equal(result[1].symbol, "BANANA");
    assert.equal(result[2].symbol, "ZEBRA");
  });

  it("list() includes all fields correctly", () => {
    const now = Date.now();
    repo.upsert({
      symbol: "AAPL",
      enabled: false,
      note: "Tech stock",
      addedAt: now,
    });

    const result = repo.list();

    assert.equal(result.length, 1);
    const item = result[0];
    assert.equal(item.symbol, "AAPL");
    assert.equal(item.enabled, false);
    assert.equal(item.note, "Tech stock");
    assert.equal(item.addedAt, now);
  });

  it("handles null note correctly", () => {
    const now = Date.now();
    repo.upsert({ symbol: "AAPL", enabled: true, note: null, addedAt: now });

    const result = repo.get("AAPL");
    assert.ok(result);
    assert.equal(result.note, null);
  });

  it("can update note to/from null", () => {
    const now = Date.now();

    repo.upsert({ symbol: "AAPL", enabled: true, note: "Original", addedAt: now });
    repo.upsert({ symbol: "AAPL", enabled: true, note: null, addedAt: now });

    const result = repo.get("AAPL");
    assert.ok(result);
    assert.equal(result.note, null);

    repo.upsert({ symbol: "AAPL", enabled: true, note: "Updated", addedAt: now });
    const updated = repo.get("AAPL");
    assert.ok(updated);
    assert.equal(updated.note, "Updated");
  });

  it("addSymbol() inserts a new symbol enabled by default", () => {
    const row = repo.addSymbol("AAPL");

    assert.equal(row.symbol, "AAPL");
    assert.equal(row.enabled, true);
    assert.equal(row.note, null);
    assert.ok(row.addedAt > 0);
    assert.deepEqual(repo.get("AAPL"), row);
  });

  it("addSymbol() normalizes case and whitespace", () => {
    const row = repo.addSymbol("  aapl  ");
    assert.equal(row.symbol, "AAPL");
    assert.ok(repo.get("AAPL"));
  });

  it("addSymbol() stores an optional note", () => {
    const row = repo.addSymbol("AAPL", "Tech stock");
    assert.equal(row.note, "Tech stock");
  });

  it("addSymbol() is idempotent and preserves existing state", () => {
    const first = repo.addSymbol("AAPL", "Original");
    repo.disableSymbol("AAPL");

    const second = repo.addSymbol("AAPL", "Ignored");

    assert.equal(repo.list().length, 1);
    assert.equal(second.addedAt, first.addedAt, "addedAt preserved");
    assert.equal(second.note, "Original", "note preserved");
    assert.equal(second.enabled, false, "enabled preserved");
  });

  it("removeSymbol() returns true when a row was deleted, false otherwise", () => {
    repo.addSymbol("AAPL");

    assert.equal(repo.removeSymbol("aapl"), true);
    assert.equal(repo.get("AAPL"), undefined);
    assert.equal(repo.removeSymbol("AAPL"), false);
  });

  it("enableSymbol() / disableSymbol() toggle the flag", () => {
    repo.addSymbol("AAPL");

    assert.equal(repo.disableSymbol("AAPL"), true);
    assert.equal(repo.get("AAPL")?.enabled, false);

    assert.equal(repo.enableSymbol("AAPL"), true);
    assert.equal(repo.get("AAPL")?.enabled, true);
  });

  it("enableSymbol() / disableSymbol() normalize the symbol", () => {
    repo.addSymbol("AAPL");
    assert.equal(repo.disableSymbol(" aapl "), true);
    assert.equal(repo.get("AAPL")?.enabled, false);
  });

  it("enableSymbol() / disableSymbol() return false for unknown symbols", () => {
    assert.equal(repo.enableSymbol("NOPE"), false);
    assert.equal(repo.disableSymbol("NOPE"), false);
  });

  it("persists across repo instances backed by the same database", () => {
    repo.addSymbol("AAPL", "Tech stock");
    repo.disableSymbol("AAPL");

    const reopened = new WatchlistRepo(db);
    const row = reopened.get("AAPL");

    assert.ok(row);
    assert.equal(row.note, "Tech stock");
    assert.equal(row.enabled, false);
  });

  it("handles multiple symbols", () => {
    const now = Date.now();
    const symbols = ["AAPL", "GOOGL", "MSFT", "TSLA"];

    symbols.forEach((sym, i) => {
      repo.upsert({
        symbol: sym,
        enabled: i % 2 === 0,
        note: `Note for ${sym}`,
        addedAt: now + i * 100,
      });
    });

    assert.equal(repo.list().length, symbols.length);
    symbols.forEach((sym) => {
      const result = repo.get(sym);
      assert.ok(result, `should find ${sym}`);
      assert.equal(result.symbol, sym);
    });
  });
});
