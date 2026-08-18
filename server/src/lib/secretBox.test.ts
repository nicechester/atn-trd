// Set the environment variable BEFORE importing the module
process.env.ATN_ENC_KEY = "test-encryption-key-12345";

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { secretBoxAvailable, seal, open } from "./secretBox.ts";

describe("secretBox", () => {
  describe("with ATN_ENC_KEY set", () => {
    it("secretBoxAvailable() returns true", () => {
      assert.equal(secretBoxAvailable(), true);
    });

    it("seal and open are inverses", () => {
      const plaintext = "test secret message";
      const sealed = seal(plaintext);
      const opened = open(sealed);
      assert.equal(opened, plaintext);
    });

    it("seal produces different output on each call", () => {
      const plaintext = "test";
      const sealed1 = seal(plaintext);
      const sealed2 = seal(plaintext);
      assert.notEqual(sealed1, sealed2, "sealed outputs should differ (different IVs)");
    });

    it("throws on corrupted sealed message (flipped byte)", () => {
      const plaintext = "test";
      const sealed = seal(plaintext);

      // Flip a byte in the base64url output
      const chars = sealed.split("");
      const charIdx = Math.floor(sealed.length / 2);
      const origChar = chars[charIdx];
      // Find a different character
      chars[charIdx] = origChar === "a" ? "b" : "a";
      const corrupted = chars.join("");

      assert.throws(
        () => open(corrupted),
        Error,
        "opening corrupted message should throw"
      );
    });
  });

  describe("without ATN_ENC_KEY", () => {
    it("secretBoxAvailable() returns false when key is missing", async () => {
      // Delete the env var
      const originalKey = process.env.ATN_ENC_KEY;
      delete process.env.ATN_ENC_KEY;

      try {
        // Use dynamic import with cache-busting to reload the module fresh
        const v = Date.now();
        const reloaded = await import(`./secretBox.ts?v=${v}`);
        assert.equal(
          reloaded.secretBoxAvailable(),
          false,
          "secretBoxAvailable should be false when key is missing"
        );

        // seal() should throw
        assert.throws(
          () => reloaded.seal("test"),
          Error,
          "seal should throw when key is missing"
        );
      } finally {
        // Restore the key for other tests
        process.env.ATN_ENC_KEY = originalKey;
      }
    });
  });
});
