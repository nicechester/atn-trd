import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrate.ts";
import { SettingsRepo } from "./settingsRepo.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, "../db/migrations");

describe("SettingsRepo", () => {
  let db: Database.Database;
  let repo: SettingsRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db, migrationsDir);
    repo = new SettingsRepo(db);
  });

  it("read() returns undefined when no settings exist", () => {
    const result = repo.read();
    assert.equal(result, undefined);
  });

  it("write() and read() round-trip", () => {
    const doc = JSON.stringify({ test: "data" });
    const now = Date.now();

    repo.write(doc, now);
    const result = repo.read();

    assert.ok(result, "should have read a result");
    assert.equal(result.doc, doc);
    assert.equal(result.updatedAt, now);
  });

  it("write() updates existing settings (upsert)", () => {
    const doc1 = JSON.stringify({ version: 1 });
    const doc2 = JSON.stringify({ version: 2 });
    const now = Date.now();

    repo.write(doc1, now);
    repo.write(doc2, now + 1000);

    const result = repo.read();
    assert.ok(result);
    assert.equal(result.doc, doc2);
    assert.equal(result.updatedAt, now + 1000);
  });

  it("persists across database reconnections (same in-memory DB)", () => {
    const doc = JSON.stringify({ persistent: true });
    const now = Date.now();

    repo.write(doc, now);

    // Create a new repo instance with same DB
    const repo2 = new SettingsRepo(db);
    const result = repo2.read();

    assert.ok(result);
    assert.equal(result.doc, doc);
  });

  it("handles large JSON documents", () => {
    const largeObj = {
      nested: {
        deep: {
          data: Array(1000).fill({ key: "value" }),
        },
      },
    };
    const doc = JSON.stringify(largeObj);
    const now = Date.now();

    repo.write(doc, now);
    const result = repo.read();

    assert.ok(result);
    assert.equal(result.doc, doc);
    assert.deepEqual(JSON.parse(result.doc), largeObj);
  });
});
