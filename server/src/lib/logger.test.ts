import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { logger } from "./logger.ts";

describe("logger", () => {
  let capturedLogs: string[] = [];
  let capturedErrors: string[] = [];

  beforeEach(() => {
    capturedLogs = [];
    capturedErrors = [];

    // Stub console.log
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      if (typeof args[0] === "string") {
        capturedLogs.push(args[0]);
      }
    };

    // Stub console.error
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      if (typeof args[0] === "string") {
        capturedErrors.push(args[0]);
      }
    };

    return () => {
      console.log = originalLog;
      console.error = originalError;
    };
  });

  afterEach(() => {
    capturedLogs = [];
    capturedErrors = [];
  });

  describe("logger.info", () => {
    it("writes JSON to stdout with ts, level, and msg", () => {
      logger.info("msg", { foo: "bar" });

      assert.equal(capturedLogs.length, 1, "should log once");
      const parsed = JSON.parse(capturedLogs[0]);
      assert.ok(parsed.ts, "should have ts");
      assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/, "ts should be ISO string");
      assert.equal(parsed.level, "info", "should have level info");
      assert.equal(parsed.msg, "msg", "should have msg");
      assert.equal(parsed.foo, "bar", "should have meta fields");
    });

    it("uses console.log for info", () => {
      logger.info("test");
      assert.equal(capturedLogs.length, 1, "should use console.log");
      assert.equal(capturedErrors.length, 0, "should not use console.error");
    });
  });

  describe("redaction", () => {
    it("redacts secret values", () => {
      logger.info("x", { apiKey: "shh" });

      const parsed = JSON.parse(capturedLogs[0]);
      assert.equal(parsed.apiKey, "[REDACTED]", "apiKey should be redacted");
    });

    it("redacts nested secret values", () => {
      logger.info("x", {
        nested: { secretToken: "shh" },
      });

      const parsed = JSON.parse(capturedLogs[0]);
      assert.equal(
        parsed.nested.secretToken,
        "[REDACTED]",
        "nested secretToken should be redacted"
      );
    });

    it("redacts multiple secret keys", () => {
      logger.info("x", {
        apiKey: "secret1",
        authorization: "secret2",
        token: "secret3",
        secretValue: "secret4",
        value_enc: "secret5",
      });

      const parsed = JSON.parse(capturedLogs[0]);
      assert.equal(parsed.apiKey, "[REDACTED]");
      assert.equal(parsed.authorization, "[REDACTED]");
      assert.equal(parsed.token, "[REDACTED]");
      assert.equal(parsed.secretValue, "[REDACTED]");
      assert.equal(parsed.value_enc, "[REDACTED]");
    });

    it("does not redact non-secret keys", () => {
      logger.info("x", { name: "John", userId: "123" });

      const parsed = JSON.parse(capturedLogs[0]);
      assert.equal(parsed.name, "John", "name should not be redacted");
      assert.equal(parsed.userId, "123", "userId should not be redacted");
    });
  });

  describe("logger.warn", () => {
    it("uses console.error for warn", () => {
      logger.warn("warning");
      assert.equal(capturedErrors.length, 1, "should use console.error");
      assert.equal(capturedLogs.length, 0, "should not use console.log");
    });
  });

  describe("logger.error", () => {
    it("uses console.error for error", () => {
      logger.error("error");
      assert.equal(capturedErrors.length, 1, "should use console.error");
      assert.equal(capturedLogs.length, 0, "should not use console.log");
    });
  });

  describe("logger.debug", () => {
    it("uses console.log for debug", () => {
      logger.debug("debug");
      assert.equal(capturedLogs.length, 1, "should use console.log");
      assert.equal(capturedErrors.length, 0, "should not use console.error");
    });
  });

  describe("logger.child", () => {
    it("includes bindings in subsequent logs", () => {
      const child = logger.child({ runId: "abc" });
      child.info("test");

      const parsed = JSON.parse(capturedLogs[0]);
      assert.equal(parsed.runId, "abc", "should include runId binding");
      assert.equal(parsed.msg, "test", "should include msg");
    });

    it("merges bindings with call meta", () => {
      const child = logger.child({ requestId: "req1" });
      child.info("test", { userId: "user1" });

      const parsed = JSON.parse(capturedLogs[0]);
      assert.equal(parsed.requestId, "req1", "should include requestId binding");
      assert.equal(parsed.userId, "user1", "should include userId meta");
    });

    it("child bindings override parent in case of conflict", () => {
      const child = logger.child({ a: "parent" });
      const grandchild = child.child({ a: "child" });
      grandchild.info("test");

      const parsed = JSON.parse(capturedLogs[0]);
      assert.equal(parsed.a, "child", "child binding should override parent");
    });

    it("call meta overrides child bindings", () => {
      const child = logger.child({ a: "binding" });
      child.info("test", { a: "meta" });

      const parsed = JSON.parse(capturedLogs[0]);
      assert.equal(parsed.a, "meta", "call meta should override binding");
    });
  });
});
