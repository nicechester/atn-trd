import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrate.ts";
import { PortfolioRepo } from "./portfolioRepo.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "../db/migrations");

describe("PortfolioRepo", () => {
  let db: Database.Database;
  let repo: PortfolioRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db, migrationsDir);
    repo = new PortfolioRepo(db);
  });

  it("read() returns undefined when no portfolio exists", () => {
    const result = repo.read();
    assert.equal(result, undefined);
  });

  it("write() and read() round-trip", () => {
    const now = Date.now();
    const row = {
      cashCents: 100000,
      startingCashCents: 100000,
      startedAt: now,
      resetAt: null,
      baseCurrency: "USD",
    };

    repo.write(row);
    const result = repo.read();

    assert.ok(result);
    assert.deepEqual(result, row);
  });

  it("write() updates existing portfolio (upsert)", () => {
    const now = Date.now();

    repo.write({
      cashCents: 100000,
      startingCashCents: 100000,
      startedAt: now,
      resetAt: null,
      baseCurrency: "USD",
    });

    repo.write({
      cashCents: 95000,
      startingCashCents: 100000,
      startedAt: now,
      resetAt: now + 1000,
      baseCurrency: "USD",
    });

    const result = repo.read();
    assert.ok(result);
    assert.equal(result.cashCents, 95000);
    assert.equal(result.resetAt, now + 1000);
  });

  it("handles all fields correctly", () => {
    const now = Date.now();
    const row = {
      cashCents: 500000,
      startingCashCents: 1000000,
      startedAt: now - 86400000, // 1 day ago
      resetAt: now,
      baseCurrency: "EUR",
    };

    repo.write(row);
    const result = repo.read();

    assert.ok(result);
    assert.equal(result.cashCents, 500000);
    assert.equal(result.startingCashCents, 1000000);
    assert.equal(result.startedAt, now - 86400000);
    assert.equal(result.resetAt, now);
    assert.equal(result.baseCurrency, "EUR");
  });

  it("handles null resetAt", () => {
    const now = Date.now();
    const row = {
      cashCents: 100000,
      startingCashCents: 100000,
      startedAt: now,
      resetAt: null,
      baseCurrency: "USD",
    };

    repo.write(row);
    const result = repo.read();

    assert.ok(result);
    assert.equal(result.resetAt, null);
  });

  it("handles resetAt transition from null to value and back", () => {
    const now = Date.now();

    repo.write({
      cashCents: 100000,
      startingCashCents: 100000,
      startedAt: now,
      resetAt: null,
      baseCurrency: "USD",
    });

    let result = repo.read();
    assert.ok(result);
    assert.equal(result.resetAt, null);

    repo.write({
      cashCents: 100000,
      startingCashCents: 100000,
      startedAt: now,
      resetAt: now + 1000,
      baseCurrency: "USD",
    });

    result = repo.read();
    assert.ok(result);
    assert.equal(result.resetAt, now + 1000);

    repo.write({
      cashCents: 100000,
      startingCashCents: 100000,
      startedAt: now,
      resetAt: null,
      baseCurrency: "USD",
    });

    result = repo.read();
    assert.ok(result);
    assert.equal(result.resetAt, null);
  });

  it("persists across database instances", () => {
    const now = Date.now();
    const row = {
      cashCents: 100000,
      startingCashCents: 100000,
      startedAt: now,
      resetAt: null,
      baseCurrency: "USD",
    };

    repo.write(row);

    const repo2 = new PortfolioRepo(db);
    const result = repo2.read();

    assert.ok(result);
    assert.deepEqual(result, row);
  });

  it("handles large cent values", () => {
    const now = Date.now();
    const largeValue = 9999999999;

    repo.write({
      cashCents: largeValue,
      startingCashCents: largeValue,
      startedAt: now,
      resetAt: null,
      baseCurrency: "USD",
    });

    const result = repo.read();
    assert.ok(result);
    assert.equal(result.cashCents, largeValue);
  });

  it("handles different currencies", () => {
    const now = Date.now();
    const currencies = ["USD", "EUR", "GBP", "JPY"];

    for (const currency of currencies) {
      repo.write({
        cashCents: 100000,
        startingCashCents: 100000,
        startedAt: now,
        resetAt: null,
        baseCurrency: currency,
      });

      const result = repo.read();
      assert.ok(result);
      assert.equal(result.baseCurrency, currency);
    }
  });
});
