import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrate.ts";
import { SecretsRepo } from "./secretsRepo.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "../db/migrations");

describe("SecretsRepo", () => {
  let db: Database.Database;
  let repo: SecretsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db, migrationsDir);
    repo = new SecretsRepo(db);
  });

  it("getEncrypted() returns undefined when secret doesn't exist", () => {
    const result = repo.getEncrypted("MISSING_KEY");
    assert.equal(result, undefined);
  });

  it("upsert() and getEncrypted() round-trip", () => {
    const name = "API_KEY";
    const valueEnc = "encrypted-value-xyz";
    const now = Date.now();

    repo.upsert(name, valueEnc, now);
    const result = repo.getEncrypted(name);

    assert.ok(result);
    assert.equal(result.name, name);
    assert.equal(result.valueEnc, valueEnc);
    assert.equal(result.updatedAt, now);
  });

  it("upsert() overwrites existing secret", () => {
    const name = "API_KEY";
    const now = Date.now();

    repo.upsert(name, "value1", now);
    repo.upsert(name, "value2", now + 1000);

    const result = repo.getEncrypted(name);
    assert.ok(result);
    assert.equal(result.valueEnc, "value2");
    assert.equal(result.updatedAt, now + 1000);
  });

  it("delete() removes a secret", () => {
    const name = "API_KEY";
    repo.upsert(name, "secret", Date.now());
    assert.ok(repo.getEncrypted(name), "secret should exist");

    repo.delete(name);
    assert.equal(repo.getEncrypted(name), undefined, "secret should be deleted");
  });

  it("delete() is idempotent (no error if secret doesn't exist)", () => {
    assert.doesNotThrow(() => {
      repo.delete("NONEXISTENT");
    });
  });

  it("listMeta() returns empty array when no secrets exist", () => {
    const result = repo.listMeta();
    assert.deepEqual(result, []);
  });

  it("listMeta() returns all secret names in order", () => {
    const now = Date.now();
    repo.upsert("ZEBRA_KEY", "z-value", now);
    repo.upsert("ALPHA_KEY", "a-value", now + 100);
    repo.upsert("BETA_KEY", "b-value", now + 200);

    const result = repo.listMeta();

    assert.equal(result.length, 3);
    assert.equal(result[0].name, "ALPHA_KEY");
    assert.equal(result[1].name, "BETA_KEY");
    assert.equal(result[2].name, "ZEBRA_KEY");
  });

  it("listMeta() does NOT include valueEnc column", () => {
    const now = Date.now();
    repo.upsert("SECRET_KEY", "secret-value", now);

    const result = repo.listMeta();

    assert.equal(result.length, 1);
    assert.ok("name" in result[0]);
    assert.ok("updatedAt" in result[0]);
    assert.equal(Object.keys(result[0]).length, 2, "should only have name and updatedAt");
    assert.ok(!("valueEnc" in result[0]), "should not include valueEnc");
    assert.ok(!("value" in result[0]), "should not include value");
  });

  it("upsert() does not update name on conflict (read-only)", () => {
    const now = Date.now();
    repo.upsert("KEY1", "value1", now);
    repo.upsert("KEY1", "value2", now + 1000);

    const result = repo.getEncrypted("KEY1");
    assert.ok(result);
    assert.equal(result.name, "KEY1");
    assert.equal(result.valueEnc, "value2");
  });

  it("handles multiple secrets concurrently", () => {
    const now = Date.now();
    const keys = ["KEY1", "KEY2", "KEY3", "KEY4", "KEY5"];

    for (let i = 0; i < keys.length; i++) {
      repo.upsert(keys[i], `value-${i}`, now + i * 100);
    }

    for (let i = 0; i < keys.length; i++) {
      const result = repo.getEncrypted(keys[i]);
      assert.ok(result);
      assert.equal(result.valueEnc, `value-${i}`);
    }

    assert.equal(repo.listMeta().length, keys.length);
  });
});
