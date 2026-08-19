import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TokenBucket,
  HttpClient,
  HttpError,
  withRetry,
  computeBackoffDelay,
  isRetryableError,
} from "./http.ts";
import { ValidationError } from "../lib/errors.ts";

/** Controllable clock: `sleep` advances virtual time instead of waiting. */
function fakeClock(startAt = 1_000_000) {
  let now = startAt;
  const slept: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      slept.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
    slept,
  };
}

describe("TokenBucket", () => {
  it("allows a burst up to capacity without waiting", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 3, refillPerSecond: 1, now: clock.now, sleep: clock.sleep });

    await bucket.take();
    await bucket.take();
    await bucket.take();

    assert.deepEqual(clock.slept, [], "burst within capacity should not sleep");
    assert.equal(bucket.available, 0);
  });

  it("waits for refill once the bucket is empty", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 2, now: clock.now, sleep: clock.sleep });

    await bucket.take();
    await bucket.take();
    await bucket.take();

    assert.equal(clock.slept.length, 1);
    assert.equal(clock.slept[0], 500, "1 token at 2/sec = 500ms");
  });

  it("refills over elapsed time up to capacity", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 5, refillPerSecond: 10, now: clock.now, sleep: clock.sleep });

    await bucket.take(5);
    assert.equal(bucket.available, 0);

    clock.advance(200); // 2 tokens
    assert.equal(Math.round(bucket.available), 2);

    clock.advance(10_000);
    assert.equal(bucket.available, 5, "never exceeds capacity");
  });

  it("serves concurrent waiters FIFO", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({ capacity: 1, refillPerSecond: 100, now: clock.now, sleep: clock.sleep });
    const order: number[] = [];

    await Promise.all(
      [1, 2, 3].map(async (id) => {
        await bucket.take();
        order.push(id);
      })
    );

    assert.deepEqual(order, [1, 2, 3]);
  });

  it("rejects a request larger than capacity", async () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerSecond: 1 });
    await assert.rejects(() => bucket.take(3), /capacity/);
  });

  it("rejects invalid configuration", () => {
    assert.throws(() => new TokenBucket({ capacity: 0, refillPerSecond: 1 }), /capacity/);
    assert.throws(() => new TokenBucket({ capacity: 1, refillPerSecond: 0 }), /refillPerSecond/);
  });
});

describe("isRetryableError", () => {
  it("retries 429 and 5xx HTTP errors", () => {
    assert.equal(isRetryableError(new HttpError(429, "http://x")), true);
    assert.equal(isRetryableError(new HttpError(503, "http://x")), true);
    assert.equal(isRetryableError(new HttpError(408, "http://x")), true);
  });

  it("does not retry deterministic 4xx", () => {
    assert.equal(isRetryableError(new HttpError(404, "http://x")), false);
    assert.equal(isRetryableError(new HttpError(400, "http://x")), false);
    assert.equal(isRetryableError(new ValidationError("bad")), false);
  });

  it("retries transport failures", () => {
    const econn = Object.assign(new Error("boom"), { code: "ECONNRESET" });
    assert.equal(isRetryableError(econn), true);
    assert.equal(isRetryableError(new Error("Too Many Requests")), true);
    assert.equal(isRetryableError(new Error("fetch failed")), true);
  });

  it("does not retry unrecognised errors", () => {
    assert.equal(isRetryableError(new Error("bad ticker")), false);
    assert.equal(isRetryableError("nope"), false);
  });
});

describe("computeBackoffDelay", () => {
  it("grows exponentially and is capped", () => {
    const opts = { baseDelayMs: 100, factor: 2, maxDelayMs: 500, jitter: false };
    assert.equal(computeBackoffDelay(1, opts), 100);
    assert.equal(computeBackoffDelay(2, opts), 200);
    assert.equal(computeBackoffDelay(3, opts), 400);
    assert.equal(computeBackoffDelay(4, opts), 500);
  });

  it("applies full jitter within [50%, 100%] of the raw delay", () => {
    const raw = 1000;
    assert.equal(computeBackoffDelay(1, { baseDelayMs: raw, random: () => 0 }), 500);
    assert.equal(computeBackoffDelay(1, { baseDelayMs: raw, random: () => 1 }), 1000);
  });
});

describe("withRetry", () => {
  it("returns the first successful result without sleeping", async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        return "ok";
      },
      { sleep: clock.sleep }
    );

    assert.equal(result, "ok");
    assert.equal(calls, 1);
    assert.deepEqual(clock.slept, []);
  });

  it("retries retryable failures then succeeds", async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new HttpError(503, "http://x");
        return "ok";
      },
      { retries: 3, baseDelayMs: 10, jitter: false, sleep: clock.sleep }
    );

    assert.equal(result, "ok");
    assert.equal(calls, 3);
    assert.deepEqual(clock.slept, [10, 20]);
  });

  it("gives up after the retry budget and rethrows the last error", async () => {
    const clock = fakeClock();
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls += 1;
            throw new HttpError(500, "http://x");
          },
          { retries: 2, baseDelayMs: 5, jitter: false, sleep: clock.sleep }
        ),
      /HTTP 500/
    );
    assert.equal(calls, 3, "1 initial attempt + 2 retries");
  });

  it("does not retry non-retryable errors", async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        withRetry(
          async () => {
            calls += 1;
            throw new ValidationError("nope");
          },
          { retries: 5, sleep: async () => {} }
        ),
      /nope/
    );
    assert.equal(calls, 1);
  });

  it("reports retries through onRetry", async () => {
    const attempts: number[] = [];
    await withRetry(
      async (attempt) => {
        if (attempt < 2) throw new HttpError(502, "http://x");
        return attempt;
      },
      {
        retries: 2,
        baseDelayMs: 1,
        jitter: false,
        sleep: async () => {},
        onRetry: (info) => attempts.push(info.attempt),
      }
    );
    assert.deepEqual(attempts, [1]);
  });
});

describe("HttpClient", () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  it("fetches JSON against a base URL", async () => {
    const seen: string[] = [];
    const client = new HttpClient({
      name: "test",
      baseUrl: "https://api.example.com/v1",
      fetchImpl: async (url) => {
        seen.push(String(url));
        return jsonResponse({ hello: "world" });
      },
    });

    const data = await client.json<{ hello: string }>("/things");
    assert.deepEqual(data, { hello: "world" });
    assert.deepEqual(seen, ["https://api.example.com/v1/things"]);
  });

  it("throws HttpError with the status on non-2xx", async () => {
    const client = new HttpClient({
      name: "test",
      retry: { retries: 0 },
      fetchImpl: async () => new Response("nope", { status: 404 }),
    });

    await assert.rejects(
      () => client.request("https://api.example.com/missing"),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.status, 404);
        assert.equal(err.statusCode, 502, "surfaces to callers as an upstream failure");
        return true;
      }
    );
  });

  it("retries 5xx responses", async () => {
    let calls = 0;
    const client = new HttpClient({
      name: "test",
      retry: { retries: 2, baseDelayMs: 1, jitter: false, sleep: async () => {} },
      fetchImpl: async () => {
        calls += 1;
        return calls < 3 ? new Response("boom", { status: 500 }) : jsonResponse({ ok: true });
      },
    });

    const data = await client.json<{ ok: boolean }>("https://api.example.com/x");
    assert.deepEqual(data, { ok: true });
    assert.equal(calls, 3);
  });

  it("run() rate-limits arbitrary work through the shared bucket", async () => {
    const clock = fakeClock();
    const bucket = new TokenBucket({
      capacity: 1,
      refillPerSecond: 1,
      now: clock.now,
      sleep: clock.sleep,
    });
    const client = new HttpClient({ name: "test", rateLimit: bucket });

    await client.run(async () => "a");
    await client.run(async () => "b");

    assert.equal(clock.slept.length, 1, "second call waits for a token");
  });

  it("run() applies the retry policy", async () => {
    let calls = 0;
    const client = new HttpClient({
      name: "test",
      retry: { retries: 2, baseDelayMs: 1, jitter: false, sleep: async () => {} },
    });

    const out = await client.run(async () => {
      calls += 1;
      if (calls < 2) throw new Error("ETIMEDOUT socket");
      return "done";
    });

    assert.equal(out, "done");
    assert.equal(calls, 2);
  });
});
