process.env.ATN_ENC_KEY = "test-encryption-key-12345";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runMigrations } from "../db/migrate.ts";
import {
  getSettings,
  updateSettings,
  invalidateSettingsCache,
  settingsEvents,
  getSecret,
  setSecret,
  clearSecret,
  listSecretStatus,
  resolveSecret,
} from "./settingsService.ts";
import { initializeDatabase, closeDatabase, getDatabase } from "../db/index.ts";
import { DEFAULT_SETTINGS, type PatchSettingsRequest } from "@atn-trd/shared";

describe("settingsService", () => {
  let tmpDir: string;
  const migrationsDir = path.join(path.dirname(import.meta.url.replace("file://", "")), "../db/migrations");

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join("/tmp", "settings-test-"));
    initializeDatabase(tmpDir);
    const db = getDatabase();
    runMigrations(db, migrationsDir);
    invalidateSettingsCache();
  });

  afterEach(() => {
    try {
      closeDatabase();
    } catch {
      // OK if already closed
    }
    invalidateSettingsCache();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("getSettings()", () => {
    it("returns default settings when no settings exist", () => {
      const settings = getSettings();
      assert.deepEqual(settings, DEFAULT_SETTINGS);
    });

    it("returns defensive clone (mutating returned object doesn't affect cache)", () => {
      const settings1 = getSettings();
      settings1.trading.enabled = true;

      const settings2 = getSettings();
      assert.equal(settings2.trading.enabled, false, "cache should not have been mutated");
    });

    it("caches settings on first read", () => {
      getSettings();
      closeDatabase();

      // After closing DB, a real read should fail, but cache should still work
      assert.doesNotThrow(() => {
        const settings = getSettings();
        assert.ok(settings);
      });
    });
  });

  describe("updateSettings()", () => {
    it("round-trip: write and read reflects changes", () => {
      updateSettings({ trading: { enabled: true } } as PatchSettingsRequest);
      const settings = getSettings();
      assert.equal(settings.trading.enabled, true);
    });

    it("persists to database (survives invalidation)", () => {
      updateSettings({ trading: { enabled: true } } as PatchSettingsRequest);
      invalidateSettingsCache();

      const settings = getSettings();
      assert.equal(settings.trading.enabled, true);
    });

    it("bumps updatedAt on write", () => {
      const before = getSettings().updatedAt;
      updateSettings({ trading: { enabled: true } } as PatchSettingsRequest);
      const after = getSettings().updatedAt;

      assert.ok(after, "updatedAt should be set");
      assert.ok(after > (before || 0), "updatedAt should increase");
    });

    it("deep merge preserves untouched sections", () => {
      updateSettings({
        trading: { enabled: true },
        // Intentionally not patching risk, llm, etc.
      } as PatchSettingsRequest);

      const settings = getSettings();
      assert.equal(settings.trading.enabled, true);
      assert.deepEqual(settings.risk, DEFAULT_SETTINGS.risk);
      assert.deepEqual(settings.llm, DEFAULT_SETTINGS.llm);
    });

    it("array replace-not-merge: replaces entire array", () => {
      updateSettings({
        risk: { symbolBlocklist: ["OLD_SYMBOL"] },
      } as PatchSettingsRequest);

      updateSettings({
        risk: { symbolBlocklist: ["NEW_SYMBOL"] },
      } as PatchSettingsRequest);

      const settings = getSettings();
      assert.deepEqual(settings.risk.symbolBlocklist, ["NEW_SYMBOL"]);
    });

    it("silently ignores unknown keys in patch", () => {
      // Zod silently strips unknown keys, so invalid_key is ignored
      const result = updateSettings({ invalid_key: true, trading: { enabled: true } } as any);
      assert.equal(result.trading.enabled, true);
      assert.ok(!("invalid_key" in result));
    });

    it("validates merged result", () => {
      assert.throws(
        () =>
          updateSettings({
            risk: { maxPositionWeightPercent: 999 }, // Out of range (0-100)
          } as PatchSettingsRequest),
        Error,
        "should reject out-of-range value"
      );

      // Settings should be unchanged
      invalidateSettingsCache();
      const settings = getSettings();
      assert.deepEqual(settings, DEFAULT_SETTINGS);
    });

    it("no-op patch {} still bumps updatedAt and fires event", () => {
      const before = getSettings().updatedAt || 0;
      let eventFired = false;

      const listener = () => {
        eventFired = true;
      };
      settingsEvents.once("change", listener);

      updateSettings({} as PatchSettingsRequest);

      assert.ok(eventFired, "change event should fire");
      assert.ok(getSettings().updatedAt! > before, "updatedAt should bump");
    });
  });

  describe("invalidateSettingsCache()", () => {
    it("forces next getSettings() to read from DB", () => {
      updateSettings({ trading: { enabled: true } } as PatchSettingsRequest);
      invalidateSettingsCache();

      const settings = getSettings();
      assert.equal(settings.trading.enabled, true);
    });
  });

  describe("settingsEvents", () => {
    it("fires 'change' event after successful updateSettings()", async () => {
      const events: any[] = [];
      settingsEvents.on("change", (newSettings) => {
        events.push(newSettings);
      });

      updateSettings({ trading: { enabled: true } } as PatchSettingsRequest);

      assert.equal(events.length, 1);
      assert.equal(events[0].trading.enabled, true);
    });

    it("event payload contains the new settings", () => {
      let capturedSettings: any = null;
      settingsEvents.once("change", (newSettings) => {
        capturedSettings = newSettings;
      });

      updateSettings({ risk: { maxConcurrentPositions: 5 } } as PatchSettingsRequest);

      assert.ok(capturedSettings);
      assert.equal(capturedSettings.risk.maxConcurrentPositions, 5);
    });

    it("does not fire on validation failure", () => {
      let eventFired = false;
      settingsEvents.once("change", () => {
        eventFired = true;
      });

      assert.throws(() => {
        updateSettings({ risk: { maxPositionWeightPercent: 999 } } as PatchSettingsRequest);
      });

      assert.equal(eventFired, false, "event should not fire on validation failure");
    });
  });

  describe("Secret management", () => {
    describe("setSecret()", () => {
      it("stores and encrypts a secret", () => {
        setSecret("API_KEY", "secret-value");
        const retrieved = getSecret("API_KEY");
        assert.equal(retrieved, "secret-value");
      });

      it("upserts (overwrites) existing secret", () => {
        setSecret("API_KEY", "value1");
        assert.equal(getSecret("API_KEY"), "value1");

        setSecret("API_KEY", "value2");
        assert.equal(getSecret("API_KEY"), "value2");
      });
    });

    describe("getSecret()", () => {
      it("returns undefined when secret doesn't exist", () => {
        const result = getSecret("MISSING");
        assert.equal(result, undefined);
      });

      it("decrypts and returns the secret", () => {
        setSecret("TEST", "test-value");
        const result = getSecret("TEST");
        assert.equal(result, "test-value");
      });
    });

    describe("clearSecret()", () => {
      it("removes a secret", () => {
        setSecret("API_KEY", "value");
        assert.ok(getSecret("API_KEY"));

        clearSecret("API_KEY");
        assert.equal(getSecret("API_KEY"), undefined);
      });

      it("is idempotent (no error if secret doesn't exist)", () => {
        assert.doesNotThrow(() => {
          clearSecret("NONEXISTENT");
        });
      });
    });

    describe("listSecretStatus()", () => {
      it("returns empty array when no secrets exist", () => {
        const result = listSecretStatus();
        assert.deepEqual(result, []);
      });

      it("returns secret names without values", () => {
        setSecret("KEY1", "secret1");
        setSecret("KEY2", "secret2");

        const result = listSecretStatus();

        assert.equal(result.length, 2);
        assert.ok(result.some((s) => s.name === "KEY1"));
        assert.ok(result.some((s) => s.name === "KEY2"));
      });

      it("never leaks secret values in status", () => {
        setSecret("API_KEY", "super-secret-value");

        const result = listSecretStatus();
        const json = JSON.stringify(result);

        assert.ok(!json.includes("super-secret-value"), "value should not leak in JSON");
        assert.ok(!json.includes("secret"), "value should not leak in JSON");
      });

      it("returns isSet and updatedAt", () => {
        setSecret("KEY1", "value");
        const result = listSecretStatus();

        assert.equal(result.length, 1);
        assert.ok("isSet" in result[0]);
        assert.ok("updatedAt" in result[0]);
        assert.equal(result[0].isSet, true);
        assert.ok(typeof result[0].updatedAt === "number");
      });
    });

    describe("resolveSecret()", () => {
      it("returns DB value when secret exists", () => {
        setSecret("KEY", "db-value");
        const result = resolveSecret("KEY");
        assert.equal(result, "db-value");
      });

      it("falls back to environment variable when DB value doesn't exist", () => {
        process.env.TEST_KEY = "env-value";
        const result = resolveSecret("TEST_KEY");
        assert.equal(result, "env-value");
        delete process.env.TEST_KEY;
      });

      it("prefers DB value over environment variable", () => {
        process.env.KEY = "env-value";
        setSecret("KEY", "db-value");

        const result = resolveSecret("KEY");
        assert.equal(result, "db-value", "DB value should take precedence");

        clearSecret("KEY");
        delete process.env.KEY;
      });

      it("returns undefined when neither DB nor env has value", () => {
        const result = resolveSecret("NONEXISTENT_KEY_XYZ");
        assert.equal(result, undefined);
      });
    });

    describe("Secret confidentiality", () => {
      it("secrets never included in public getSettings() response", () => {
        setSecret("DATABASE_PASSWORD", "super-secret");

        const settings = getSettings();
        const json = JSON.stringify(settings);

        assert.ok(!json.includes("super-secret"));
        assert.ok(!json.includes("DATABASE_PASSWORD"));
      });

      it("encrypted value differs on each setSecret() call", () => {
        const originalKey = process.env.ATN_ENC_KEY;
        process.env.ATN_ENC_KEY = originalKey;

        const values = new Set<string>();

        // Get the raw encrypted values from DB
        const db = getDatabase();
        for (let i = 0; i < 3; i++) {
          setSecret("KEY", "same-plaintext-value");
          const row = db
            .prepare("SELECT value_enc FROM secrets WHERE name = 'KEY'")
            .get() as any;
          values.add(row.value_enc);
        }

        assert.ok(values.size > 1, "encrypted values should differ (different IVs)");
      });
    });
  });

  describe("Error handling", () => {
    it("propagates decryption error on corrupted secret", () => {
      setSecret("KEY", "plaintext");

      // Corrupt the encrypted value in the DB
      const db = getDatabase();
      db.prepare("UPDATE secrets SET value_enc = 'corrupted-base64' WHERE name = 'KEY'").run();

      invalidateSettingsCache();

      assert.throws(
        () => getSecret("KEY"),
        Error,
        "should throw on decryption failure"
      );
    });
  });

  describe("Corruption and edge cases", () => {
    it("propagates error on corrupted JSON in app_settings.doc", () => {
      const db = getDatabase();
      db.prepare("INSERT INTO app_settings (id, doc, updated_at) VALUES (1, 'not-json', ?)")
        .run(Date.now());

      invalidateSettingsCache();

      assert.throws(
        () => getSettings(),
        Error,
        "should throw SyntaxError on JSON parse"
      );
    });

    it("propagates error on doc failing zod validation", () => {
      const db = getDatabase();
      db.prepare(
        "INSERT INTO app_settings (id, doc, updated_at) VALUES (1, ?, ?)"
      ).run(JSON.stringify({ trading: { mode: "invalid_mode" } }), Date.now());

      invalidateSettingsCache();

      assert.throws(
        () => getSettings(),
        Error,
        "should throw on zod validation failure"
      );
    });
  });

  describe("Integration scenarios", () => {
    it("applies patches with valid values successfully", () => {
      const result = updateSettings({
        trading: { startingCashCents: 500000 },
        risk: { maxPositionWeightPercent: 30 },
      } as PatchSettingsRequest);
      assert.equal(result.trading.startingCashCents, 500000);
      assert.equal(result.risk.maxPositionWeightPercent, 30);
    });

    it("preserves other settings when patching specific fields", () => {
      updateSettings({ risk: { maxPositionWeightPercent: 25 } } as PatchSettingsRequest);

      const settings = getSettings();
      assert.equal(settings.risk.maxPositionWeightPercent, 25);
      assert.equal(settings.trading.enabled, false, "unpatched trading.enabled should remain");
      assert.equal(settings.risk.maxConcurrentPositions, 10, "unpatched risk field should remain");
    });

    it("encryption is available in test environment (key set at startup)", () => {
      // The test file sets ATN_ENC_KEY at module load time, so encryption is always available.
      // This test just verifies that secrets can be encrypted/decrypted.
      setSecret("TEST_KEY", "test-value");
      const value = getSecret("TEST_KEY");
      assert.equal(value, "test-value");
      clearSecret("TEST_KEY");
    });
  });
});
