var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/lib/errors.ts
var AppError, ValidationError, EncryptionUnavailableError, NotFoundError, UpstreamError, DataSourceNotConfiguredError, SymbolNotFoundError;
var init_errors = __esm({
  "src/lib/errors.ts"() {
    "use strict";
    AppError = class extends Error {
      statusCode;
      code;
      constructor(message, statusCode, code) {
        super(message);
        this.name = new.target.name;
        this.statusCode = statusCode;
        this.code = code;
      }
    };
    ValidationError = class extends AppError {
      issues;
      constructor(message, issues) {
        super(message, 400, "VALIDATION_ERROR");
        this.issues = issues;
      }
    };
    EncryptionUnavailableError = class extends AppError {
      constructor() {
        super("ATN_ENC_KEY is not set; secret storage is unavailable", 503, "ENCRYPTION_UNAVAILABLE");
      }
    };
    NotFoundError = class extends AppError {
      constructor(message) {
        super(message, 404, "NOT_FOUND");
      }
    };
    UpstreamError = class extends AppError {
      source;
      constructor(message, source) {
        super(message, 502, "UPSTREAM_ERROR");
        this.source = source;
      }
    };
    DataSourceNotConfiguredError = class extends AppError {
      source;
      secretName;
      constructor(source, secretName) {
        super(
          `${source} is not configured. Add ${secretName} under Settings -> Secrets, or set the ${secretName} environment variable.`,
          503,
          "DATASOURCE_NOT_CONFIGURED"
        );
        this.source = source;
        this.secretName = secretName;
      }
    };
    SymbolNotFoundError = class extends AppError {
      symbol;
      constructor(symbol) {
        super(`Unknown symbol: ${symbol}`, 404, "SYMBOL_NOT_FOUND");
        this.symbol = symbol;
      }
    };
  }
});

// src/lib/logger.ts
function redact(obj) {
  if (obj === null || obj === void 0) {
    return obj;
  }
  if (typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item));
  }
  const redacted = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("secret") || lowerKey.includes("token") || lowerKey.includes("apikey") || lowerKey.includes("authorization") || lowerKey.includes("value_enc")) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = redact(value);
    }
  }
  return redacted;
}
function log(level, msg, meta) {
  const output = {
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    level,
    msg,
    ...meta ? redact(meta) : {}
  };
  const line = JSON.stringify(output);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}
var logger, Logger;
var init_logger = __esm({
  "src/lib/logger.ts"() {
    "use strict";
    logger = {
      info(msg, meta) {
        log("info", msg, meta);
      },
      warn(msg, meta) {
        log("warn", msg, meta);
      },
      error(msg, meta) {
        log("error", msg, meta);
      },
      debug(msg, meta) {
        log("debug", msg, meta);
      },
      child(bindings) {
        return new Logger(bindings);
      }
    };
    Logger = class _Logger {
      constructor(bindings) {
        this.bindings = bindings;
      }
      bindings;
      info(msg, meta) {
        log("info", msg, { ...this.bindings, ...meta });
      }
      warn(msg, meta) {
        log("warn", msg, { ...this.bindings, ...meta });
      }
      error(msg, meta) {
        log("error", msg, { ...this.bindings, ...meta });
      }
      debug(msg, meta) {
        log("debug", msg, { ...this.bindings, ...meta });
      }
      child(bindings) {
        return new _Logger({ ...this.bindings, ...bindings });
      }
    };
  }
});

// src/datasources/http.ts
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });
}
async function withTimeout(fn, timeoutMs, label, externalSignal) {
  const controller = new AbortController();
  const abortExternal = () => controller.abort();
  externalSignal?.addEventListener("abort", abortExternal, { once: true });
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      const err = new Error(`${label} timed out after ${timeoutMs}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(controller.signal), expiry]);
  } finally {
    if (timer) clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortExternal);
  }
}
function isRetryableError(err) {
  if (err instanceof HttpError) {
    return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
  }
  if (err instanceof AppError) {
    return err.statusCode >= 500;
  }
  if (err instanceof Error) {
    if (err.name === "AbortError" || err.name === "TimeoutError") return true;
    const code = err.code;
    if (code && /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)$/.test(code)) {
      return true;
    }
    return RETRYABLE_MESSAGE.test(err.message);
  }
  return false;
}
function computeBackoffDelay(attempt, options = {}) {
  const base = options.baseDelayMs ?? 250;
  const max = options.maxDelayMs ?? 4e3;
  const factor = options.factor ?? 2;
  const raw = Math.min(max, base * Math.pow(factor, Math.max(0, attempt - 1)));
  if (options.jitter === false) return raw;
  const random = options.random ?? Math.random;
  return Math.round(raw * (0.5 + random() * 0.5));
}
async function withRetry(fn, options = {}) {
  const retries = options.retries ?? 2;
  const retryable = options.isRetryable ?? isRetryableError;
  const sleepFn = options.sleep ?? sleep;
  let lastError;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt > retries || !retryable(err)) break;
      const delayMs = computeBackoffDelay(attempt, options);
      options.onRetry?.({ attempt, delayMs, error: err });
      await sleepFn(delayMs);
    }
  }
  throw lastError;
}
var TokenBucket, HttpError, RETRYABLE_MESSAGE, HttpClient;
var init_http = __esm({
  "src/datasources/http.ts"() {
    "use strict";
    init_errors();
    init_logger();
    TokenBucket = class {
      capacity;
      refillPerSecond;
      tokens;
      lastRefillAt;
      tail = Promise.resolve();
      nowFn;
      sleepFn;
      constructor(options) {
        if (options.capacity <= 0) {
          throw new Error("TokenBucket capacity must be > 0");
        }
        if (options.refillPerSecond <= 0) {
          throw new Error("TokenBucket refillPerSecond must be > 0");
        }
        this.capacity = options.capacity;
        this.refillPerSecond = options.refillPerSecond;
        this.nowFn = options.now ?? Date.now;
        this.sleepFn = options.sleep ?? sleep;
        this.tokens = options.initialTokens ?? options.capacity;
        this.lastRefillAt = this.nowFn();
      }
      /** Tokens currently available (after accounting for elapsed refill time). */
      get available() {
        this.refill();
        return this.tokens;
      }
      async take(count2 = 1) {
        if (count2 > this.capacity) {
          throw new Error(`Requested ${count2} tokens but bucket capacity is ${this.capacity}`);
        }
        const run = this.tail.then(() => this.acquire(count2));
        this.tail = run.catch(() => void 0);
        return run;
      }
      async acquire(count2) {
        for (; ; ) {
          this.refill();
          if (this.tokens >= count2) {
            this.tokens -= count2;
            return;
          }
          const deficit = count2 - this.tokens;
          const waitMs = Math.ceil(deficit / this.refillPerSecond * 1e3);
          await this.sleepFn(waitMs);
        }
      }
      refill() {
        const now = this.nowFn();
        const elapsedMs = now - this.lastRefillAt;
        if (elapsedMs <= 0) return;
        this.lastRefillAt = now;
        this.tokens = Math.min(this.capacity, this.tokens + elapsedMs / 1e3 * this.refillPerSecond);
      }
    };
    HttpError = class extends UpstreamError {
      status;
      url;
      body;
      constructor(status, url, source, body) {
        super(`HTTP ${status} from ${url}`, source);
        this.status = status;
        this.url = url;
        this.body = body;
      }
    };
    RETRYABLE_MESSAGE = /(too many requests|rate limit|timeout|timed out|socket|network|econn|eai_again|enotfound|fetch failed)/i;
    HttpClient = class {
      name;
      bucket;
      baseUrl;
      timeoutMs;
      defaultHeaders;
      retryOptions;
      fetchImpl;
      log = logger.child({ component: "http" });
      constructor(options) {
        this.name = options.name;
        this.baseUrl = options.baseUrl;
        this.timeoutMs = options.timeoutMs ?? 1e4;
        this.defaultHeaders = options.defaultHeaders ?? {};
        this.retryOptions = options.retry ?? {};
        this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
        this.bucket = options.rateLimit instanceof TokenBucket ? options.rateLimit : new TokenBucket(options.rateLimit ?? { capacity: 5, refillPerSecond: 2 });
      }
      /**
       * Run an arbitrary async operation under this client's rate limit and retry
       * policy. Used by SDK-backed data sources (e.g. yahoo-finance2) so they share
       * the same throttling budget as raw fetch calls.
       */
      async run(fn, overrides = {}) {
        const retryOptions = {
          ...this.retryOptions,
          ...overrides,
          onRetry: (info) => {
            this.log.warn("retrying upstream call", {
              source: this.name,
              attempt: info.attempt,
              delayMs: info.delayMs,
              error: info.error instanceof Error ? info.error.message : String(info.error)
            });
            this.retryOptions.onRetry?.(info);
            overrides.onRetry?.(info);
          }
        };
        return withRetry(async (attempt) => {
          await this.bucket.take();
          return fn(attempt);
        }, retryOptions);
      }
      async request(path8, init = {}, retryOverrides = {}) {
        const url = this.resolveUrl(path8);
        return this.run(async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), this.timeoutMs);
          const startedAt = Date.now();
          try {
            const res = await this.fetchImpl(url, {
              ...init,
              headers: { ...this.defaultHeaders, ...init.headers },
              signal: controller.signal
            });
            if (!res.ok) {
              const body = await res.text().catch(() => void 0);
              throw new HttpError(res.status, url, this.name, body?.slice(0, 512));
            }
            this.log.debug("upstream request ok", {
              source: this.name,
              url,
              status: res.status,
              durationMs: Date.now() - startedAt
            });
            return res;
          } finally {
            clearTimeout(timer);
          }
        }, retryOverrides);
      }
      async json(path8, init = {}, retryOverrides = {}) {
        const res = await this.request(path8, init, retryOverrides);
        return await res.json();
      }
      resolveUrl(path8) {
        if (!this.baseUrl) return path8;
        if (/^https?:\/\//i.test(path8)) return path8;
        return new URL(path8.replace(/^\//, ""), this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`).toString();
      }
    };
  }
});

// src/datasources/options/optionsCalendar.ts
function startOfUtcDay(epochMs2) {
  const d = new Date(epochMs2);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
function daysBetween(from, to) {
  return Math.round((startOfUtcDay(to) - startOfUtcDay(from)) / DAY_MS3);
}
function thirdFriday(year, monthIndex) {
  const firstOfMonth = Date.UTC(year, monthIndex, 1);
  const firstDow = new Date(firstOfMonth).getUTCDay();
  const daysToFirstFriday = (5 - firstDow + 7) % 7;
  return Date.UTC(year, monthIndex, 1 + daysToFirstFriday + 14);
}
function isThirdFriday(epochMs2) {
  const d = new Date(epochMs2);
  return startOfUtcDay(epochMs2) === thirdFriday(d.getUTCFullYear(), d.getUTCMonth());
}
function isQuarterlyOpEx(epochMs2) {
  const month = new Date(epochMs2).getUTCMonth();
  return isThirdFriday(epochMs2) && (month === 2 || month === 5 || month === 8 || month === 11);
}
function nextMonthlyOpEx(nowMs) {
  const today = startOfUtcDay(nowMs);
  const d = new Date(today);
  const thisMonth = thirdFriday(d.getUTCFullYear(), d.getUTCMonth());
  if (thisMonth >= today) return thisMonth;
  return thirdFriday(d.getUTCFullYear(), d.getUTCMonth() + 1);
}
function nextQuarterlyOpEx(nowMs) {
  const today = startOfUtcDay(nowMs);
  const d = new Date(today);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  for (let i = 0; i < 5; i += 1) {
    const candidateMonth = month + i;
    const normalized = (candidateMonth % 12 + 12) % 12;
    if (normalized !== 2 && normalized !== 5 && normalized !== 8 && normalized !== 11) continue;
    const opEx = thirdFriday(year, candidateMonth);
    if (opEx >= today) return opEx;
  }
  return thirdFriday(year + 1, 2);
}
function buildExpiryCalendar(nowMs, expirationDates) {
  const upcoming = expirationDates.filter((d) => Number.isFinite(d) && startOfUtcDay(d) >= startOfUtcDay(nowMs)).sort((a, b) => a - b);
  const nextExpiry = upcoming[0] ?? null;
  const monthly = nextMonthlyOpEx(nowMs);
  const quarterly = nextQuarterlyOpEx(nowMs);
  return {
    nextExpiry,
    daysToNextExpiry: nextExpiry === null ? null : daysBetween(nowMs, nextExpiry),
    nextMonthlyOpEx: monthly,
    daysToNextMonthlyOpEx: daysBetween(nowMs, monthly),
    nextMonthlyIsQuarterly: isQuarterlyOpEx(monthly),
    nextQuarterlyOpEx: quarterly,
    daysToNextQuarterlyOpEx: daysBetween(nowMs, quarterly)
  };
}
function sum(contracts, pick) {
  return contracts.reduce((total, c) => total + (Number.isFinite(pick(c)) ? pick(c) : 0), 0);
}
function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}
function maxPainStrike(calls, puts) {
  const strikes = [...new Set([...calls, ...puts].map((c) => c.strike))].filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
  if (strikes.length === 0) return null;
  let best = null;
  let bestPain = Number.POSITIVE_INFINITY;
  for (const candidate of strikes) {
    let pain = 0;
    for (const call of calls) {
      if (candidate > call.strike) pain += (candidate - call.strike) * call.openInterest;
    }
    for (const put of puts) {
      if (candidate < put.strike) pain += (put.strike - candidate) * put.openInterest;
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = candidate;
    }
  }
  return best;
}
function nearestOtmIv(contracts, underlyingPrice, side) {
  if (underlyingPrice === null || !Number.isFinite(underlyingPrice)) return null;
  const otm = contracts.filter(
    (c) => side === "call" ? c.strike >= underlyingPrice : c.strike <= underlyingPrice
  );
  const withIv = otm.filter((c) => typeof c.impliedVolatility === "number");
  if (withIv.length === 0) return null;
  const nearest = withIv.reduce(
    (closest, c) => Math.abs(c.strike - underlyingPrice) < Math.abs(closest.strike - underlyingPrice) ? c : closest
  );
  return nearest.impliedVolatility;
}
function computeOptionsMetrics(calls, puts, underlyingPrice) {
  const callOpenInterest = sum(calls, (c) => c.openInterest);
  const putOpenInterest = sum(puts, (c) => c.openInterest);
  const callVolume = sum(calls, (c) => c.volume);
  const putVolume = sum(puts, (c) => c.volume);
  const nearestOtmCallIv = nearestOtmIv(calls, underlyingPrice, "call");
  const nearestOtmPutIv = nearestOtmIv(puts, underlyingPrice, "put");
  return {
    callOpenInterest,
    putOpenInterest,
    totalOpenInterest: callOpenInterest + putOpenInterest,
    putCallOpenInterestRatio: ratio(putOpenInterest, callOpenInterest),
    callVolume,
    putVolume,
    totalVolume: callVolume + putVolume,
    putCallVolumeRatio: ratio(putVolume, callVolume),
    maxPainStrike: maxPainStrike(calls, puts),
    ivSkew: nearestOtmPutIv !== null && nearestOtmCallIv !== null ? nearestOtmPutIv - nearestOtmCallIv : null,
    nearestOtmPutIv,
    nearestOtmCallIv,
    unusualContracts: [...calls, ...puts].filter((c) => c.unusualVolume).map((c) => c.contractSymbol)
  };
}
function withVolumeFlags(contract, threshold = UNUSUAL_VOLUME_RATIO) {
  const volumeOpenInterestRatio = contract.openInterest > 0 ? contract.volume / contract.openInterest : null;
  return {
    ...contract,
    volumeOpenInterestRatio,
    unusualVolume: volumeOpenInterestRatio !== null && volumeOpenInterestRatio >= threshold
  };
}
var DAY_MS3, UNUSUAL_VOLUME_RATIO;
var init_optionsCalendar = __esm({
  "src/datasources/options/optionsCalendar.ts"() {
    "use strict";
    DAY_MS3 = 24 * 60 * 60 * 1e3;
    UNUSUAL_VOLUME_RATIO = 2;
  }
});

// src/datasources/options/cboeOptions.ts
var cboeOptions_exports = {};
__export(cboeOptions_exports, {
  CBOE_BASE_URL: () => CBOE_BASE_URL,
  CBOE_OPTIONS_SOURCE: () => CBOE_OPTIONS_SOURCE,
  createCboeHttpClient: () => createCboeHttpClient,
  fetchCboeChain: () => fetchCboeChain,
  parseOsiSymbol: () => parseOsiSymbol,
  toChain: () => toChain
});
function parseOsiSymbol(symbol) {
  const match = OSI_PATTERN.exec(symbol.trim().toUpperCase());
  if (!match) return null;
  const [, root, yymmdd, type, strikeDigits] = match;
  const year = 2e3 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const strike = Number(strikeDigits) / 1e3;
  if (!Number.isFinite(strike)) return null;
  return {
    root,
    expiration: Date.UTC(year, month - 1, day),
    type: type === "C" ? "call" : "put",
    strike
  };
}
function toContract(raw, parsed, underlyingPrice) {
  const inTheMoney = underlyingPrice === null ? void 0 : parsed.type === "call" ? parsed.strike < underlyingPrice : parsed.strike > underlyingPrice;
  return {
    contractSymbol: raw.option ?? "",
    strike: parsed.strike,
    lastPrice: raw.last_trade_price,
    bid: raw.bid,
    ask: raw.ask,
    volume: raw.volume,
    openInterest: raw.open_interest,
    impliedVolatility: raw.iv,
    ...inTheMoney === void 0 ? {} : { inTheMoney },
    expiration: parsed.expiration
  };
}
function toChain(body, symbol, options) {
  const contracts = Array.isArray(body.data?.options) ? body.data.options : [];
  const underlyingPrice = body.data?.current_price ?? body.data?.close ?? null;
  const parsed = contracts.map((raw) => {
    const osi = raw.option ? parseOsiSymbol(raw.option) : null;
    return osi ? { raw, osi } : null;
  }).filter((entry) => entry !== null);
  const expirationDates = [...new Set(parsed.map((entry) => entry.osi.expiration))].sort(
    (a, b) => a - b
  );
  const today = startOfUtcDay(options.now);
  const target = options.expiration !== void 0 ? (
    // Snap to the closest listed expiry so callers need not match exactly.
    expirationDates.reduce(
      (best, date) => best === null || Math.abs(date - options.expiration) < Math.abs(best - options.expiration) ? date : best,
      null
    )
  ) : expirationDates.find((date) => date >= today) ?? expirationDates[0] ?? null;
  const selected = parsed.filter((entry) => entry.osi.expiration === target);
  return {
    underlyingSymbol: body.data?.symbol ?? body.symbol ?? symbol,
    expirationDates,
    ...underlyingPrice === null ? {} : { quote: { regularMarketPrice: underlyingPrice } },
    options: [
      {
        ...target === null ? {} : { expirationDate: target },
        calls: selected.filter((entry) => entry.osi.type === "call").map((entry) => toContract(entry.raw, entry.osi, underlyingPrice)),
        puts: selected.filter((entry) => entry.osi.type === "put").map((entry) => toContract(entry.raw, entry.osi, underlyingPrice))
      }
    ]
  };
}
function createCboeHttpClient() {
  return new HttpClient({
    name: CBOE_OPTIONS_SOURCE,
    baseUrl: CBOE_BASE_URL,
    defaultHeaders: { "user-agent": "atn-trd/0.1.0", accept: "application/json" },
    rateLimit: { capacity: 2, refillPerSecond: 0.5 },
    // The payload is multi-megabyte; give it room beyond the default 10s.
    timeoutMs: 2e4,
    retry: { retries: 1, baseDelayMs: 500, maxDelayMs: 4e3 }
  });
}
async function fetchCboeChain(http, symbol, options) {
  let body;
  try {
    body = await http.json(`${encodeURIComponent(symbol)}.json`, {
      ...options.signal ? { signal: options.signal } : {}
    });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 404 || err.status === 403)) {
      throw new SymbolNotFoundError(symbol);
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new UpstreamError(`Could not reach CBOE for "${symbol}" options: ${message}`, CBOE_OPTIONS_SOURCE);
  }
  if (!Array.isArray(body.data?.options)) {
    throw new SymbolNotFoundError(symbol);
  }
  return toChain(body, symbol, {
    ...options.expiration === void 0 ? {} : { expiration: options.expiration },
    now: options.now
  });
}
var CBOE_OPTIONS_SOURCE, CBOE_BASE_URL, OSI_PATTERN;
var init_cboeOptions = __esm({
  "src/datasources/options/cboeOptions.ts"() {
    "use strict";
    init_http();
    init_errors();
    init_optionsCalendar();
    CBOE_OPTIONS_SOURCE = "cboe-options";
    CBOE_BASE_URL = "https://cdn.cboe.com/api/global/delayed_quotes/options/";
    OSI_PATTERN = /^(.+?)(\d{6})([CP])(\d{8})$/;
  }
});

// src/main.ts
import path7 from "path";
import { fileURLToPath as fileURLToPath6 } from "url";

// src/db/index.ts
import Database from "better-sqlite3";
import path from "path";
var db = null;
function initializeDatabase(dataDir) {
  const dbPath = path.join(dataDir, "atn.db");
  db = new Database(dbPath);
  try {
    let lastSql = "";
    let lastTime = 0;
    db.trace((sql) => {
      const now = Date.now();
      const duration = lastTime ? now - lastTime : 0;
      if (lastSql) {
        console.log(`[DB] SQL executed in ${duration}ms: ${lastSql.substring(0, 120)}`);
      }
      lastSql = sql;
      lastTime = now;
    });
  } catch (err) {
    console.log(`[DB] Warning: Could not enable SQL tracing:`, err instanceof Error ? err.message : String(err));
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  console.log(`[DB] Database initialized at ${dbPath}`);
  console.log(`[DB] Tracing enabled for SQL statements`);
  return db;
}
function getDatabase() {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase first.");
  }
  return db;
}
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

// src/db/migrate.ts
import fs from "fs";
import path2 from "path";
function runMigrations(db2, migrationsDir) {
  const isFreshDb = isFreshDatabase(db2);
  if (isFreshDb) {
    const schemaPath = path2.join(migrationsDir, "..", "schema.sql");
    if (fs.existsSync(schemaPath)) {
      console.log("Fresh database detected, applying complete schema...");
      const schemaSql = fs.readFileSync(schemaPath, "utf-8");
      db2.exec(schemaSql);
      console.log("\u2713 Schema applied");
      return;
    }
  }
  db2.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);
  const migrations = loadMigrations(migrationsDir);
  const appliedStmt = db2.prepare("SELECT version FROM schema_migrations ORDER BY version");
  const applied = new Set(
    appliedStmt.all().map((row) => row.version)
  );
  for (const migration of migrations) {
    if (!applied.has(migration.version)) {
      console.log(`Running migration ${migration.version}: ${migration.name}`);
      try {
        db2.exec(migration.sql);
        const insertStmt = db2.prepare(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)"
        );
        insertStmt.run(migration.version, Date.now());
        console.log(`\u2713 Migration ${migration.version} applied`);
      } catch (error) {
        console.error(`\u2717 Migration ${migration.version} failed:`, error);
        throw error;
      }
    }
  }
  console.log("Migrations complete");
}
function isFreshDatabase(db2) {
  try {
    const result = db2.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'"
    ).get();
    return !result;
  } catch {
    return true;
  }
}
function loadMigrations(migrationsDir) {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.match(/^\d+_.*\.sql$/)).sort();
  return files.map((file) => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) throw new Error(`Invalid migration filename: ${file}`);
    const [, versionStr, name] = match;
    const version = parseInt(versionStr, 10);
    const sql = fs.readFileSync(path2.join(migrationsDir, file), "utf-8");
    return { version, name, sql };
  });
}

// src/app.ts
init_errors();
init_logger();
import express from "express";
import cookieParser from "cookie-parser";
import path6 from "path";

// src/lib/auth.ts
init_logger();
import jwt from "jsonwebtoken";
var log2 = logger.child({ component: "auth" });
var JWT_SECRET = process.env.ATN_ENC_KEY || "dev-jwt-secret-change-me";
var JWT_EXPIRES_IN = "7d";
function getUsers() {
  const users = /* @__PURE__ */ new Map();
  const chesterPassword = process.env.AUTH_PASSWORD_CHESTER;
  const guestPassword = process.env.AUTH_PASSWORD_GUEST;
  if (chesterPassword) {
    users.set("chester", { password: chesterPassword, role: "chester" });
  }
  if (guestPassword) {
    users.set("guest", { password: guestPassword, role: "guest" });
  }
  if (users.size === 0 && process.env.NODE_ENV !== "production") {
    log2.warn("No auth passwords configured, using dev defaults");
    users.set("chester", { password: "chester", role: "chester" });
    users.set("guest", { password: "guest", role: "guest" });
  }
  return users;
}
function authenticate(username, password) {
  const users = getUsers();
  const user = users.get(username.toLowerCase());
  if (!user || user.password !== password) {
    return null;
  }
  return { username: username.toLowerCase(), role: user.role };
}
function generateToken(user) {
  return jwt.sign(
    { username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}
function canWrite(role) {
  return role === "chester";
}

// src/middleware/auth.ts
function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.user = payload;
  next();
}
function requireWrite(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (!canWrite(req.user.role)) {
    res.status(403).json({ error: "Write permission required" });
    return;
  }
  next();
}
function extractToken(req) {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const cookie = req.cookies?.token;
  if (cookie) {
    return cookie;
  }
  return null;
}

// src/routes/auth.ts
function loginHandler(req, res, next) {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "Username and password required" });
      return;
    }
    const user = authenticate(username, password);
    if (!user) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    const token = generateToken(user);
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1e3
      // 7 days
    });
    res.json({
      ok: true,
      user: { username: user.username, role: user.role },
      token
      // Also return token for API clients
    });
  } catch (err) {
    next(err);
  }
}
function logoutHandler(_req, res) {
  res.clearCookie("token");
  res.json({ ok: true });
}
function meHandler(req, res) {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({
    ok: true,
    user: { username: req.user.username, role: req.user.role }
  });
}

// src/routes/health.ts
import fs2 from "fs";
import path3 from "path";
import { fileURLToPath } from "url";

// src/services/finbertService.ts
init_logger();
import { pipeline, env } from "@huggingface/transformers";
var log3 = logger.child({ component: "finbert-service" });
var modelPath = process.env.FINBERT_MODEL_PATH;
if (modelPath) {
  env.localModelPath = modelPath;
  env.allowRemoteModels = false;
}
var modelName = modelPath ? "finbert-q8" : "nicechester/finbert-sentiment-onnx-quantized";
var pipelineOptions = modelPath ? { model_file_name: "model", dtype: "q8" } : {};
var classifier = null;
var finbertReady = false;
function isFinBERTReady() {
  return finbertReady;
}
function normalizeScore(label, score) {
  if (label === "positive") return score;
  if (label === "negative") return -score;
  return 0;
}
async function prewarmFinBERT() {
  log3.info(`Loading FinBERT model from ${modelPath || "HuggingFace"}...`);
  classifier = await pipeline("text-classification", modelName, pipelineOptions);
  finbertReady = true;
  log3.info("FinBERT model ready");
}
async function scoreFinBERT(text) {
  if (!classifier) throw new Error("FinBERT not initialized");
  const output = await classifier(text);
  const result = Array.isArray(output) ? output[0] : output;
  const r = {
    label: result.label,
    score: result.score,
    normalizedScore: normalizeScore(result.label, result.score)
  };
  log3.debug("FinBERT scored", { text: text.slice(0, 50), ...r });
  return r;
}

// src/routes/health.ts
var __dirname = path3.dirname(fileURLToPath(import.meta.url));
function getAppVersion() {
  try {
    const pkgPath = path3.join(__dirname, "..", "..", "..", "package.json");
    const pkg = JSON.parse(fs2.readFileSync(pkgPath, "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}
function getBuildInfo() {
  try {
    const buildPath = path3.join(__dirname, "..", "..", "build-info.json");
    const info = JSON.parse(fs2.readFileSync(buildPath, "utf-8"));
    return info;
  } catch {
    return null;
  }
}
function getMigrationVersion() {
  try {
    const db2 = getDatabase();
    const row = db2.prepare("SELECT MAX(version) as version FROM schema_migrations").get();
    return row?.version ?? null;
  } catch {
    return null;
  }
}
function getDbInfo() {
  try {
    const db2 = getDatabase();
    const dbPath = db2.name;
    const stats = fs2.statSync(dbPath);
    return { path: dbPath, size: stats.size };
  } catch {
    return null;
  }
}
function healthHandler(_req, res) {
  res.json({
    version: getAppVersion(),
    build: getBuildInfo(),
    migrationVersion: getMigrationVersion(),
    db: getDbInfo(),
    encKeyPresent: Boolean(process.env.ATN_ENC_KEY),
    finbertReady: isFinBERTReady(),
    uptime: process.uptime()
  });
}

// src/config/settingsService.ts
import { EventEmitter } from "node:events";
import { z } from "zod";
import {
  SettingsSchema,
  PatchSettingsRequestSchema
} from "@atn-trd/shared";

// src/repos/settingsRepo.ts
var SettingsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  read() {
    return this.db.prepare("SELECT doc, updated_at as updatedAt FROM app_settings WHERE id = 1").get();
  }
  write(doc, updatedAt) {
    this.db.prepare(
      `INSERT INTO app_settings (id, doc, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`
    ).run(doc, updatedAt);
  }
};

// src/repos/secretsRepo.ts
var SecretsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  getEncrypted(name) {
    return this.db.prepare("SELECT name, value_enc as valueEnc, updated_at as updatedAt FROM secrets WHERE name = ?").get(name);
  }
  upsert(name, valueEnc, updatedAt) {
    this.db.prepare(
      `INSERT INTO secrets (name, value_enc, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`
    ).run(name, valueEnc, updatedAt);
  }
  delete(name) {
    this.db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
  }
  listMeta() {
    return this.db.prepare("SELECT name, updated_at as updatedAt FROM secrets ORDER BY name").all();
  }
};

// src/lib/secretBox.ts
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync
} from "node:crypto";
var SALT = "atn-trd-secrets-v1";
var VERSION = 1;
var IV_LEN = 12;
var TAG_LEN = 16;
var KEY_LEN = 32;
var cachedKey = null;
var cachedKeySource;
function deriveKey() {
  const raw = process.env.ATN_ENC_KEY;
  if (!raw) {
    throw new Error(
      "ATN_ENC_KEY is not set; secret encryption is unavailable"
    );
  }
  if (cachedKey && cachedKeySource === raw) return cachedKey;
  cachedKey = scryptSync(raw, SALT, KEY_LEN);
  cachedKeySource = raw;
  return cachedKey;
}
function secretBoxAvailable() {
  const available = !!process.env.ATN_ENC_KEY?.trim();
  console.log(`[SECRETBOX] secretBoxAvailable() = ${available}, ATN_ENC_KEY set: ${!!process.env.ATN_ENC_KEY}`);
  return available;
}
function seal(plaintext) {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  const authTag = cipher.getAuthTag();
  const envelope = Buffer.concat([
    Buffer.from([VERSION]),
    iv,
    authTag,
    ciphertext
  ]);
  return envelope.toString("base64url");
}
function open(sealed) {
  const key = deriveKey();
  const envelope = Buffer.from(sealed, "base64url");
  if (envelope.length < 1 + IV_LEN + TAG_LEN) {
    throw new Error("Malformed sealed secret: too short");
  }
  const version = envelope[0];
  if (version !== VERSION) {
    throw new Error(`Unsupported sealed secret version: ${version}`);
  }
  const iv = envelope.subarray(1, 1 + IV_LEN);
  const authTag = envelope.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const ciphertext = envelope.subarray(1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

// src/config/settingsService.ts
init_errors();
var cache = null;
var settingsEvents = new EventEmitter();
function getRepos() {
  const db2 = getDatabase();
  return { settingsRepo: new SettingsRepo(db2), secretsRepo: new SecretsRepo(db2) };
}
function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge(base, patch) {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return patch === void 0 ? base : patch;
  }
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === void 0) continue;
    result[key] = deepMerge(base[key], value);
  }
  return result;
}
function loadFromDb() {
  const { settingsRepo } = getRepos();
  const row = settingsRepo.read();
  const raw = row ? JSON.parse(row.doc) : {};
  let needsMigration = false;
  if (raw.signals?.sellThreshold !== void 0 && raw.signals.sellThreshold < 0) {
    raw.signals.sellThreshold = (raw.signals.sellThreshold + 1) / 2;
    needsMigration = true;
  }
  const settings = SettingsSchema.parse(raw);
  if (needsMigration) {
    settings.updatedAt = Date.now();
    settingsRepo.write(JSON.stringify(settings), settings.updatedAt);
  }
  return settings;
}
function getSettings() {
  if (cache) return structuredClone(cache);
  const settings = loadFromDb();
  cache = settings;
  return structuredClone(settings);
}
function invalidateSettingsCache() {
  cache = null;
}
function updateSettings(patch) {
  let validatedPatch;
  try {
    validatedPatch = PatchSettingsRequestSchema.parse(patch);
  } catch (err) {
    if (err instanceof z.ZodError) throw new ValidationError("Invalid settings patch", err.issues);
    throw err;
  }
  const merged = deepMerge(getSettings(), validatedPatch);
  let validated;
  try {
    validated = SettingsSchema.parse(merged);
  } catch (err) {
    if (err instanceof z.ZodError) throw new ValidationError("Invalid settings patch", err.issues);
    throw err;
  }
  validated.updatedAt = Date.now();
  const { settingsRepo } = getRepos();
  settingsRepo.write(JSON.stringify(validated), validated.updatedAt);
  invalidateSettingsCache();
  settingsEvents.emit("change", validated);
  return structuredClone(validated);
}
function getSecret(name) {
  const { secretsRepo } = getRepos();
  const row = secretsRepo.getEncrypted(name);
  if (!row) return void 0;
  return open(row.valueEnc);
}
function setSecret(name, value) {
  if (!secretBoxAvailable()) throw new EncryptionUnavailableError();
  const { secretsRepo } = getRepos();
  secretsRepo.upsert(name, seal(value), Date.now());
}
function clearSecret(name) {
  const { secretsRepo } = getRepos();
  secretsRepo.delete(name);
}
var ENV_SECRET_NAMES = ["FINNHUB_API_KEY", "FRED_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY"];
function listSecretStatus() {
  const { secretsRepo } = getRepos();
  const dbSecrets = secretsRepo.listMeta();
  const dbNames = new Set(dbSecrets.map((m) => m.name));
  const result = dbSecrets.map((m) => ({ name: m.name, isSet: true, updatedAt: m.updatedAt }));
  for (const name of ENV_SECRET_NAMES) {
    if (!dbNames.has(name) && process.env[name]?.trim()) {
      result.push({ name, isSet: true });
    }
  }
  return result;
}
function resolveSecret(name) {
  return getSecret(name) ?? process.env[name];
}

// src/routes/settings.ts
function getSettingsHandler(_req, res, next) {
  try {
    res.json({ ok: true, data: getSettings() });
  } catch (err) {
    next(err);
  }
}
function patchSettingsHandler(req, res, next) {
  try {
    res.json({ ok: true, data: updateSettings(req.body) });
  } catch (err) {
    next(err);
  }
}

// src/routes/secrets.ts
import { z as z2 } from "zod";
import { SetSecretRequestSchema } from "@atn-trd/shared";
init_errors();
function requireName(req) {
  const { name } = req.params;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    throw new ValidationError("Secret name is required");
  }
  return name;
}
function getSecretsHandler(_req, res, next) {
  try {
    res.json({ ok: true, data: listSecretStatus() });
  } catch (err) {
    next(err);
  }
}
function putSecretHandler(req, res, next) {
  try {
    const name = requireName(req);
    let body;
    try {
      body = SetSecretRequestSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z2.ZodError) throw new ValidationError("Invalid secret value", err.issues);
      throw err;
    }
    setSecret(name, body.value);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
function deleteSecretHandler(req, res, next) {
  try {
    clearSecret(requireName(req));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// src/routes/llm.ts
init_errors();
init_logger();

// src/llm/openaiChatModel.ts
init_errors();
init_http();
init_logger();
import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
var LlmNotConfiguredError = class extends AppError {
  constructor(message = "No OpenAI API key is configured. Add one under Settings -> Secrets (OPENAI_API_KEY) or set the OPENAI_API_KEY environment variable.") {
    super(message, 503, "LLM_NOT_CONFIGURED");
  }
};
var LlmAuthError = class extends AppError {
  constructor(message = "The OpenAI API key was rejected. Check that the key is correct and still active.") {
    super(message, 401, "LLM_AUTH_FAILED");
  }
};
var LlmRateLimitError = class extends AppError {
  retryAfterMs;
  constructor(message, retryAfterMs) {
    super(message, 429, "LLM_RATE_LIMITED");
    this.retryAfterMs = retryAfterMs;
  }
};
var LlmTimeoutError = class extends AppError {
  timeoutMs;
  constructor(timeoutMs) {
    super(
      `The model did not respond within ${timeoutMs}ms. Try a shorter prompt or raise the LLM timeout in Settings.`,
      504,
      "LLM_TIMEOUT"
    );
    this.timeoutMs = timeoutMs;
  }
};
var LlmRequestError = class extends AppError {
  constructor(message) {
    super(message, 400, "LLM_BAD_REQUEST");
  }
};
var LlmUpstreamError = class extends AppError {
  constructor(message) {
    super(message, 502, "LLM_UPSTREAM_ERROR");
  }
};
var DEFAULT_MODEL = "gpt-4-turbo";
var DEFAULT_TEMPERATURE = 0.7;
var DEFAULT_TIMEOUT_MS = 3e4;
var DEFAULT_MAX_RETRIES = 2;
var MAX_RETRY_DELAY_MS = 1e4;
var log4 = logger.child({ component: "llm" });
function readLlmSettings() {
  try {
    return getSettings().llm;
  } catch (err) {
    log4.debug("settings unavailable, using LLM defaults", {
      error: err instanceof Error ? err.message : String(err)
    });
    return {};
  }
}
function resolveApiKey(explicit) {
  const fromConfig = explicit?.trim();
  if (fromConfig) return fromConfig;
  try {
    const fromStore = resolveSecret("LLM_API_KEY")?.trim();
    if (fromStore) return fromStore;
  } catch (err) {
    log4.debug("secret store unavailable for LLM_API_KEY", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
  const fromEnv = process.env.OPENAI_API_KEY?.trim() || process.env.LLM_API_KEY?.trim();
  return fromEnv || void 0;
}
function resolveBaseUrl(explicit, settingsBaseUrl) {
  const candidate = explicit?.trim() || settingsBaseUrl?.trim() || process.env.LLM_API_URL?.trim();
  return candidate || void 0;
}
function resolveConfig(config = {}) {
  const settings = readLlmSettings();
  return {
    model: config.model ?? settings.model ?? process.env.LLM_MODEL?.trim() ?? DEFAULT_MODEL,
    temperature: config.temperature ?? settings.temperature ?? DEFAULT_TEMPERATURE,
    timeoutMs: config.timeoutMs ?? settings.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    baseUrl: resolveBaseUrl(config.baseUrl, settings.baseUrl),
    hasApiKey: resolveApiKey(config.apiKey) !== void 0
  };
}
function resolveConfigForAgent(agent, config = {}) {
  const settings = readLlmSettings();
  const agentModel = settings.agents?.[agent]?.model?.trim();
  return {
    model: config.model ?? (agentModel || void 0) ?? settings.model ?? process.env.LLM_MODEL?.trim() ?? DEFAULT_MODEL,
    temperature: config.temperature ?? settings.temperature ?? DEFAULT_TEMPERATURE,
    timeoutMs: config.timeoutMs ?? settings.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
    baseUrl: resolveBaseUrl(config.baseUrl, settings.baseUrl),
    hasApiKey: resolveApiKey(config.apiKey) !== void 0
  };
}
function asProviderError(err) {
  if (typeof err !== "object" || err === null) return {};
  return err;
}
function causeChain(err, depth = 4) {
  const chain = [];
  let current = err;
  for (let i = 0; i <= depth && typeof current === "object" && current !== null; i += 1) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}
function isErrorNamed(err, className) {
  return causeChain(err).some(
    (e) => e.name === className || e.constructor?.name === className
  );
}
function anyMessageMatches(err, pattern) {
  return causeChain(err).some((e) => pattern.test(e.message ?? ""));
}
function anyCodeMatches(err, pattern) {
  return causeChain(err).some((e) => typeof e.code === "string" && pattern.test(e.code));
}
function statusOf(err) {
  for (const e of causeChain(err)) {
    if (typeof e.status === "number") return e.status;
  }
  const message = asProviderError(err).message ?? "";
  const match = /\b(?:status(?:\s*code)?|HTTP)\D{0,3}(\d{3})\b/i.exec(message);
  return match ? Number(match[1]) : void 0;
}
function isTimeoutError(err) {
  if (isErrorNamed(err, "AbortError") || isErrorNamed(err, "TimeoutError")) return true;
  if (isErrorNamed(err, "APIConnectionTimeoutError")) return true;
  if (anyCodeMatches(err, /^(ETIMEDOUT|ECONNABORTED)$/)) return true;
  return anyMessageMatches(err, /timed? ?out|timeout|aborted/i);
}
function isConnectionError(err) {
  if (isErrorNamed(err, "APIConnectionError")) return true;
  if (anyCodeMatches(err, /^(ECONNRESET|ECONNREFUSED|EPIPE|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)$/)) {
    return true;
  }
  return anyMessageMatches(err, /connection error|fetch failed|network|socket hang up/i);
}
function isRetryableLlmError(err) {
  if (err instanceof LlmNotConfiguredError || err instanceof LlmAuthError) return false;
  if (err instanceof LlmRequestError) return false;
  if (err instanceof LlmRateLimitError) return true;
  if (err instanceof LlmTimeoutError || err instanceof LlmUpstreamError) return true;
  const status = statusOf(err);
  if (status !== void 0) return status === 408 || status === 409 || status === 429 || status >= 500;
  return isTimeoutError(err) || isConnectionError(err);
}
function headerValue(headers, name) {
  if (!headers) return void 0;
  if (typeof headers.get === "function") {
    return headers.get(name) ?? void 0;
  }
  if (typeof headers === "object") {
    const record = headers;
    const hit = Object.entries(record).find(([k]) => k.toLowerCase() === name.toLowerCase());
    return typeof hit?.[1] === "string" ? hit[1] : void 0;
  }
  return void 0;
}
function parseRetryAfterMs(err) {
  if (err instanceof LlmRateLimitError) return err.retryAfterMs;
  const raw = headerValue(asProviderError(err).headers, "retry-after");
  if (!raw) return void 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1e3));
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return void 0;
}
function providerMessage(err) {
  const e = asProviderError(err);
  return e.error?.message ?? e.message ?? "Unknown error";
}
function mapLlmError(err, timeoutMs) {
  if (err instanceof AppError) return err;
  if (isTimeoutError(err)) return new LlmTimeoutError(timeoutMs);
  const status = statusOf(err);
  if (status === 401 || status === 403) return new LlmAuthError();
  if (status === 429) {
    const retryAfterMs = parseRetryAfterMs(err);
    const insufficientQuota = /quota|billing/i.test(providerMessage(err));
    return new LlmRateLimitError(
      insufficientQuota ? "The OpenAI account has no remaining quota. Check the billing plan for this API key." : "OpenAI is rate limiting this API key. Retries were exhausted; try again in a moment.",
      retryAfterMs
    );
  }
  if (status === 404) {
    return new LlmRequestError(
      `The configured model is not available to this API key: ${providerMessage(err)}`
    );
  }
  if (status === 400 || status === 413 || status === 422) {
    return new LlmRequestError(`OpenAI rejected the request: ${providerMessage(err)}`);
  }
  if (status !== void 0 && status >= 500) {
    return new LlmUpstreamError(
      "OpenAI is currently unavailable. Retries were exhausted; try again shortly."
    );
  }
  if (isConnectionError(err)) {
    return new LlmUpstreamError(
      "Could not reach OpenAI. Check network connectivity and the API base URL."
    );
  }
  return new LlmUpstreamError(`The model call failed: ${providerMessage(err)}`);
}
function toLangChainMessage(message) {
  switch (message.role) {
    case "system":
      return new SystemMessage(message.content);
    case "assistant":
      return new AIMessage(message.content);
    case "user":
      return new HumanMessage(message.content);
    default: {
      const exhaustive = message.role;
      throw new LlmRequestError(`Unsupported message role: ${String(exhaustive)}`);
    }
  }
}
function toTokenUsage(raw) {
  if (!raw) return void 0;
  const inputTokens = raw.promptTokens;
  const outputTokens = raw.completionTokens;
  if (typeof inputTokens !== "number" && typeof outputTokens !== "number") return void 0;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return {
    inputTokens: input,
    outputTokens: output,
    totalTokens: raw.totalTokens ?? input + output
  };
}
function createChatOpenAIClient(config, apiKey) {
  const chat = new ChatOpenAI({
    apiKey,
    model: config.model,
    temperature: config.temperature,
    timeout: config.timeoutMs,
    // This wrapper owns retries; don't let the SDK retry underneath us.
    maxRetries: 0,
    ...config.baseUrl ? { configuration: { baseURL: config.baseUrl } } : {}
  });
  return {
    async generate(messages, options) {
      const result = await chat.generate(
        [messages.map(toLangChainMessage)],
        options.signal ? { signal: options.signal } : void 0
      );
      const generation = result.generations[0]?.[0];
      if (!generation) {
        throw new LlmUpstreamError("OpenAI returned an empty response.");
      }
      const llmOutput = result.llmOutput;
      return {
        content: generation.text,
        model: config.model,
        tokens: toTokenUsage(llmOutput?.tokenUsage)
      };
    }
  };
}
function createOpenAIChatModel(config = {}, deps = {}) {
  const resolved = resolveConfig(config);
  const createClient = deps.createClient ?? createChatOpenAIClient;
  const sleepFn = deps.sleep ?? sleep;
  async function complete(messages, options = {}) {
    if (messages.length === 0) {
      throw new LlmRequestError("At least one message is required.");
    }
    const apiKey = resolveApiKey(config.apiKey);
    if (!apiKey) throw new LlmNotConfiguredError();
    log4.debug("starting model call", {
      model: resolved.model,
      baseUrl: resolved.baseUrl ?? "(openai default)"
    });
    const client = createClient(resolved, apiKey);
    let retryAfterMs;
    const retryOptions = {
      retries: resolved.maxRetries,
      isRetryable: isRetryableLlmError,
      onRetry: ({ attempt, delayMs, error }) => {
        retryAfterMs = parseRetryAfterMs(error);
        log4.warn("retrying model call", {
          model: resolved.model,
          baseUrl: resolved.baseUrl ?? "(openai default)",
          attempt,
          delayMs: retryAfterMs ?? delayMs,
          status: statusOf(error),
          error: error instanceof Error ? error.message : String(error)
        });
      },
      sleep: async (delayMs) => {
        const wait = Math.min(retryAfterMs ?? delayMs, MAX_RETRY_DELAY_MS);
        retryAfterMs = void 0;
        await sleepFn(wait);
      }
    };
    try {
      return await withRetry(() => client.generate(messages, options), retryOptions);
    } catch (err) {
      throw mapLlmError(err, resolved.timeoutMs);
    }
  }
  return { config: resolved, complete };
}
function promptMessages(prompt, system) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });
  return messages;
}

// src/routes/llm.ts
var DEFAULT_TEST_PROMPT = "Reply with the single word: pong";
var SYSTEM_PROMPT = "You are a connectivity probe. Answer in as few words as possible.";
var MAX_PROMPT_LENGTH = 4e3;
var log5 = logger.child({ component: "llm-route" });
function parsePrompt(body) {
  if (body === void 0 || body === null) return DEFAULT_TEST_PROMPT;
  if (typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const { prompt } = body;
  if (prompt === void 0 || prompt === null) return DEFAULT_TEST_PROMPT;
  if (typeof prompt !== "string") {
    throw new ValidationError('Field "prompt" must be a string');
  }
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return DEFAULT_TEST_PROMPT;
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new ValidationError(
      `Field "prompt" must be at most ${MAX_PROMPT_LENGTH} characters (received ${trimmed.length})`
    );
  }
  return trimmed;
}
function createTestLlmHandler(deps = {}) {
  const createModel = deps.createModel ?? (() => createOpenAIChatModel());
  const now = deps.now ?? (() => performance.now());
  return async function testLlmHandler2(req, res, next) {
    try {
      const prompt = parsePrompt(req.body);
      const model = createModel();
      const startedAt = now();
      const completion = await model.complete(promptMessages(prompt, SYSTEM_PROMPT));
      const latency = Math.round(now() - startedAt);
      const data = {
        model: completion.model,
        response: completion.content,
        latency,
        ...completion.tokens ? { tokens: completion.tokens } : {}
      };
      log5.info("llm test succeeded", {
        model: data.model,
        latency,
        // Not "totalTokens": the logger redacts any key containing "token".
        usageTotal: completion.tokens?.totalTokens
      });
      res.json({ ok: true, data });
    } catch (err) {
      next(err);
    }
  };
}
var testLlmHandler = createTestLlmHandler();

// src/datasources/types.ts
var DATA_SOURCE_IDS = ["news", "fundamentals", "macro", "options"];
function isDataSourceId(value) {
  return typeof value === "string" && DATA_SOURCE_IDS.includes(value);
}
var BaseDataSource = class {
  /** Sources that need no credentials can rely on this default. */
  isConfigured() {
    return true;
  }
  /** Overridden by sources that need a credential, to name the missing one. */
  notConfiguredDetail() {
    return "Data source is not configured";
  }
  /**
   * Never throws: a connector that cannot reach its provider must degrade to
   * `{ ok: false }` rather than fail the caller (doc 02).
   */
  async healthCheck() {
    const configured = this.isConfigured();
    const base = {
      name: this.name,
      kind: this.kind,
      provider: this.provider,
      configured,
      checkedAt: Date.now()
    };
    if (!configured) {
      const detail = this.notConfiguredDetail();
      return { ...base, ok: false, latencyMs: null, detail, error: detail };
    }
    const startedAt = Date.now();
    try {
      const detail = await this.probe();
      return {
        ...base,
        ok: true,
        latencyMs: Date.now() - startedAt,
        detail: detail ?? "ok"
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        ok: false,
        latencyMs: Date.now() - startedAt,
        detail: message,
        error: message
      };
    }
  }
};

// src/datasources/registry.ts
import { DEFAULT_SETTINGS } from "@atn-trd/shared";
init_logger();
init_errors();

// src/datasources/news/alpacaNews.ts
init_http();
init_errors();

// src/datasources/news/types.ts
var DEFAULT_NEWS_LIMIT = 20;
var NEWS_HEALTH_CHECK_SYMBOL = "AAPL";
var GENERAL_NEWS_QUERY = "stock market";
function normalizeNewsSymbol(symbol) {
  return symbol.trim().toUpperCase();
}
function toIsoDate(epochMs2) {
  return new Date(epochMs2).toISOString().slice(0, 10);
}
function clampLimit(limit, fallback = DEFAULT_NEWS_LIMIT) {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(100, Math.floor(limit));
}

// src/datasources/news/alpacaNews.ts
var ALPACA_NEWS_SOURCE = "alpaca-news";
var ALPACA_DATA_BASE_URL = "https://data.alpaca.markets/v1beta1/";
var DAY_MS = 24 * 60 * 60 * 1e3;
var DEFAULT_LOOKBACK_DAYS = 7;
var AlpacaNewsDataSource = class extends BaseDataSource {
  name = ALPACA_NEWS_SOURCE;
  kind = "news";
  provider = "alpaca";
  http;
  apiKey;
  apiSecret;
  now;
  constructor(options = {}) {
    super();
    this.apiKey = options.apiKey ?? process.env.ALPACA_API_KEY;
    this.apiSecret = options.apiSecret ?? process.env.ALPACA_API_SECRET;
    this.now = options.now ?? Date.now;
    this.http = options.http ?? new HttpClient({
      name: ALPACA_NEWS_SOURCE,
      baseUrl: ALPACA_DATA_BASE_URL,
      defaultHeaders: { accept: "application/json" },
      // 200 req/min = ~3.3/sec, use 3/sec to be safe
      rateLimit: { capacity: 10, refillPerSecond: 3 },
      retry: { retries: 2, baseDelayMs: 300, maxDelayMs: 2e3 }
    });
  }
  isConfigured() {
    return !!this.apiKey && !!this.apiSecret;
  }
  notConfiguredDetail() {
    return "Missing ALPACA_API_KEY or ALPACA_API_SECRET";
  }
  async fetch(query = {}, ctx) {
    if (!this.apiKey || !this.apiSecret) {
      throw new DataSourceNotConfiguredError("Alpaca news", "ALPACA_API_KEY");
    }
    const limit = clampLimit(query.limit);
    const symbol = query.symbol ? normalizeNewsSymbol(query.symbol) : null;
    const params = new URLSearchParams();
    if (symbol) params.set("symbols", symbol);
    params.set("limit", String(Math.min(limit, 50)));
    if (query.from) {
      params.set("start", new Date(query.from).toISOString());
    } else {
      params.set("start", new Date(this.now() - DEFAULT_LOOKBACK_DAYS * DAY_MS).toISOString());
    }
    if (query.to) {
      params.set("end", new Date(query.to).toISOString());
    }
    const path8 = `news?${params.toString()}`;
    try {
      const response = await this.http.json(path8, {
        headers: {
          "APCA-API-KEY-ID": this.apiKey,
          "APCA-API-SECRET-KEY": this.apiSecret
        },
        ...ctx?.signal ? { signal: ctx.signal } : {}
      });
      const articles = (response.news || []).slice(0, limit).map((item) => this.toArticle(item));
      return {
        data: { symbol, articles, sentiment: null, warnings: [] },
        provider: this.provider,
        fetchedAt: this.now(),
        citations: articles.map((a) => ({ title: a.headline, url: a.url })),
        raw: response
      };
    } catch (err) {
      throw this.toUpstreamError(err);
    }
  }
  toArticle(item) {
    return {
      id: String(item.id),
      headline: item.headline || "(untitled)",
      summary: item.summary || "",
      url: item.url || "",
      source: item.source || "Alpaca",
      publishedAt: new Date(item.created_at).getTime(),
      symbols: item.symbols || [],
      imageUrl: item.images?.[0]?.url || null
    };
  }
  toUpstreamError(err) {
    if (err instanceof HttpError) {
      if (err.status === 401 || err.status === 403) {
        return new UpstreamError(`Alpaca rejected API credentials (HTTP ${err.status})`, ALPACA_NEWS_SOURCE);
      }
      if (err.status === 429) {
        return new UpstreamError("Alpaca rate limit exceeded (HTTP 429)", ALPACA_NEWS_SOURCE);
      }
      return new UpstreamError(`Alpaca request failed (HTTP ${err.status})`, ALPACA_NEWS_SOURCE);
    }
    if (err instanceof UpstreamError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new UpstreamError(`Could not reach Alpaca: ${message}`, ALPACA_NEWS_SOURCE);
  }
  async probe() {
    const result = await this.fetch({ symbol: NEWS_HEALTH_CHECK_SYMBOL, limit: 5 });
    const count2 = result.data.articles.length;
    const latest = result.data.articles[0];
    return count2 === 0 ? `Reachable; no ${NEWS_HEALTH_CHECK_SYMBOL} headlines` : `Fetched ${count2} headline(s); latest: ${latest?.headline.slice(0, 80)}`;
  }
};

// src/datasources/news/finnhubNews.ts
init_http();

// src/datasources/apiKeys.ts
init_logger();
var log6 = logger.child({ component: "datasource-keys" });
function resolveApiKey2(name) {
  try {
    const fromStore = resolveSecret(name)?.trim();
    if (fromStore) return fromStore;
  } catch (err) {
    log6.debug("secret store unavailable", {
      name,
      error: err instanceof Error ? err.message : String(err)
    });
  }
  return process.env[name]?.trim() || void 0;
}
function apiKeyResolver(name) {
  return () => resolveApiKey2(name);
}

// src/datasources/news/finnhubNews.ts
init_errors();
init_logger();
var FINNHUB_NEWS_SOURCE = "finnhub-news";
var FINNHUB_API_KEY_SECRET = "FINNHUB_API_KEY";
var FINNHUB_BASE_URL = "https://finnhub.io/api/v1/";
var DEFAULT_LOOKBACK_DAYS2 = 7;
var DAY_MS2 = 24 * 60 * 60 * 1e3;
function toEpochMs(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return Date.now();
  return seconds > 1e12 ? seconds : seconds * 1e3;
}
function splitRelated(related) {
  if (!related) return [];
  return related.split(",").map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0);
}
function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
var FinnhubNewsDataSource = class extends BaseDataSource {
  name = FINNHUB_NEWS_SOURCE;
  kind = "news";
  provider = "finnhub";
  http;
  resolveKey;
  wantSentiment;
  now;
  log = logger.child({ component: "datasource", source: FINNHUB_NEWS_SOURCE });
  constructor(options = {}) {
    super();
    this.resolveKey = options.resolveKey ?? apiKeyResolver(FINNHUB_API_KEY_SECRET);
    this.wantSentiment = options.sentiment !== false;
    this.now = options.now ?? Date.now;
    this.http = options.http ?? new HttpClient({
      name: FINNHUB_NEWS_SOURCE,
      baseUrl: FINNHUB_BASE_URL,
      defaultHeaders: { accept: "application/json" },
      // Free tier allows 60 req/min; stay comfortably under it.
      rateLimit: { capacity: 5, refillPerSecond: 1 },
      retry: { retries: 2, baseDelayMs: 400, maxDelayMs: 4e3 }
    });
  }
  isConfigured() {
    return this.resolveKey() !== void 0;
  }
  notConfiguredDetail() {
    return `Missing ${FINNHUB_API_KEY_SECRET}`;
  }
  async fetch(query = {}, ctx) {
    const key = this.requireKey();
    const limit = clampLimit(query.limit);
    const symbol = query.symbol ? normalizeNewsSymbol(query.symbol) : null;
    const warnings = [];
    const raw = symbol ? await this.companyNews(key, symbol, query, ctx) : await this.generalNews(key, ctx);
    const articles = raw.slice(0, limit).map((item) => this.toArticle(item));
    let sentiment = null;
    if (symbol && this.wantSentiment) {
      try {
        sentiment = await this.newsSentiment(key, symbol, ctx);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Sentiment unavailable: ${message}`);
        this.log.warn("news sentiment unavailable", { symbol, error: message });
      }
    } else if (symbol) {
      warnings.push("Sentiment lookup disabled");
    }
    return {
      data: { symbol, articles, sentiment, warnings },
      provider: this.provider,
      fetchedAt: this.now(),
      citations: articles.map((a) => ({ title: a.headline, url: a.url })),
      raw
    };
  }
  requireKey() {
    const key = this.resolveKey();
    if (!key) throw new DataSourceNotConfiguredError("Finnhub news", FINNHUB_API_KEY_SECRET);
    return key;
  }
  async companyNews(key, symbol, query, ctx) {
    const to = query.to ?? toIsoDate(this.now());
    const from = query.from ?? toIsoDate(this.now() - DEFAULT_LOOKBACK_DAYS2 * DAY_MS2);
    const path8 = `company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`;
    return this.getArray(path8, key, ctx);
  }
  async generalNews(key, ctx) {
    return this.getArray("news?category=general", key, ctx);
  }
  async newsSentiment(key, symbol, ctx) {
    const body = await this.get(
      `news-sentiment?symbol=${encodeURIComponent(symbol)}`,
      key,
      ctx
    );
    if (!body || typeof body !== "object") return null;
    return {
      symbol,
      companyNewsScore: num(body.companyNewsScore),
      bullishPercent: num(body.sentiment?.bullishPercent),
      bearishPercent: num(body.sentiment?.bearishPercent),
      sectorAverageBullishPercent: num(body.sectorAverageBullishPercent),
      articlesInLastWeek: num(body.buzz?.articlesInLastWeek)
    };
  }
  async getArray(path8, key, ctx) {
    const body = await this.get(path8, key, ctx);
    if (Array.isArray(body)) return body;
    const message = body && typeof body === "object" && typeof body.error === "string" ? body.error : null;
    throw new UpstreamError(
      message ? `Finnhub rejected the request: ${message}` : "Finnhub returned an unexpected payload",
      FINNHUB_NEWS_SOURCE
    );
  }
  async get(path8, key, ctx) {
    try {
      return await this.http.json(path8, {
        // Header auth keeps the key out of URLs, logs and error messages.
        headers: { "X-Finnhub-Token": key },
        ...ctx?.signal ? { signal: ctx.signal } : {}
      });
    } catch (err) {
      throw this.toUpstreamError(err);
    }
  }
  toUpstreamError(err) {
    if (err instanceof HttpError) {
      if (err.status === 401 || err.status === 403) {
        return new UpstreamError(
          `Finnhub rejected the API key (HTTP ${err.status}). Check ${FINNHUB_API_KEY_SECRET}.`,
          FINNHUB_NEWS_SOURCE
        );
      }
      if (err.status === 429) {
        return new UpstreamError("Finnhub rate limit exceeded (HTTP 429)", FINNHUB_NEWS_SOURCE);
      }
      return new UpstreamError(`Finnhub request failed (HTTP ${err.status})`, FINNHUB_NEWS_SOURCE);
    }
    if (err instanceof UpstreamError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new UpstreamError(`Could not reach Finnhub: ${message}`, FINNHUB_NEWS_SOURCE);
  }
  toArticle(item) {
    const url = item.url ?? "";
    return {
      id: String(item.id ?? url),
      headline: item.headline ?? "(untitled)",
      summary: item.summary ?? "",
      url,
      source: item.source ?? "Finnhub",
      publishedAt: toEpochMs(item.datetime),
      symbols: splitRelated(item.related),
      imageUrl: item.image && item.image.length > 0 ? item.image : null
    };
  }
  async probe() {
    const result = await this.fetchWithoutSentiment(NEWS_HEALTH_CHECK_SYMBOL);
    const count2 = result.data.articles.length;
    const latest = result.data.articles[0];
    return count2 === 0 ? `Reachable; no ${NEWS_HEALTH_CHECK_SYMBOL} headlines in the last ${DEFAULT_LOOKBACK_DAYS2} days` : `Fetched ${count2} ${NEWS_HEALTH_CHECK_SYMBOL} headline(s); latest: ${latest?.headline.slice(0, 80)}`;
  }
  async fetchWithoutSentiment(symbol) {
    const key = this.requireKey();
    const raw = await this.companyNews(key, symbol, {});
    const articles = raw.slice(0, 5).map((item) => this.toArticle(item));
    return {
      data: { symbol, articles, sentiment: null, warnings: [] },
      provider: this.provider,
      fetchedAt: this.now(),
      citations: [],
      raw
    };
  }
};

// src/datasources/news/yahooNews.ts
init_http();
init_errors();
var YAHOO_NEWS_SOURCE = "yahoo-news";
var YAHOO_SEARCH_BASE_URL = "https://query1.finance.yahoo.com/";
var USER_AGENT = "atn-trd/0.1.0";
function toEpochMs2(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return Date.now();
  return seconds > 1e12 ? seconds : seconds * 1e3;
}
function pickThumbnail(item) {
  const resolutions = item.thumbnail?.resolutions;
  if (!Array.isArray(resolutions) || resolutions.length === 0) return null;
  return resolutions[0]?.url ?? null;
}
var YahooNewsDataSource = class extends BaseDataSource {
  name = YAHOO_NEWS_SOURCE;
  kind = "news";
  provider = "yahoo";
  http;
  now;
  constructor(options = {}) {
    super();
    this.now = options.now ?? Date.now;
    this.http = options.http ?? new HttpClient({
      name: YAHOO_NEWS_SOURCE,
      baseUrl: YAHOO_SEARCH_BASE_URL,
      defaultHeaders: { "user-agent": USER_AGENT, accept: "application/json" },
      rateLimit: { capacity: 5, refillPerSecond: 2 },
      retry: { retries: 2, baseDelayMs: 400, maxDelayMs: 4e3 }
    });
  }
  /** Public search feed: no credentials required. */
  isConfigured() {
    return true;
  }
  async fetch(query = {}, ctx) {
    const symbol = query.symbol ? normalizeNewsSymbol(query.symbol) : null;
    const limit = clampLimit(query.limit);
    const raw = await this.search(symbol ?? GENERAL_NEWS_QUERY, limit, ctx);
    const warnings = ["Yahoo news does not expose sentiment scores"];
    if (query.from || query.to) {
      warnings.push("Yahoo news ignores from/to date filters");
    }
    const articles = raw.slice(0, limit).map((item) => this.toArticle(item, symbol));
    return {
      data: { symbol, articles, sentiment: null, warnings },
      provider: this.provider,
      fetchedAt: this.now(),
      citations: articles.map((a) => ({ title: a.headline, url: a.url })),
      raw
    };
  }
  async search(term, limit, ctx) {
    const path8 = `v1/finance/search?q=${encodeURIComponent(term)}&newsCount=${limit}&quotesCount=0&enableFuzzyQuery=false&enableNavLinks=false`;
    let body;
    try {
      body = await this.http.json(path8, {
        ...ctx?.signal ? { signal: ctx.signal } : {}
      });
    } catch (err) {
      if (err instanceof HttpError) {
        throw new UpstreamError(
          `Yahoo news request failed (HTTP ${err.status})`,
          YAHOO_NEWS_SOURCE
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new UpstreamError(`Could not reach Yahoo news: ${message}`, YAHOO_NEWS_SOURCE);
    }
    if (body.error) {
      const description = typeof body.error === "string" ? body.error : body.error.description ?? "unknown error";
      throw new UpstreamError(`Yahoo news returned an error: ${description}`, YAHOO_NEWS_SOURCE);
    }
    return Array.isArray(body.news) ? body.news : [];
  }
  toArticle(item, symbol) {
    const url = item.link ?? "";
    const related = Array.isArray(item.relatedTickers) ? item.relatedTickers.map((t) => String(t).toUpperCase()) : [];
    return {
      id: item.uuid ?? url,
      headline: item.title ?? "(untitled)",
      // The search feed carries headlines only; summaries need the article page.
      summary: "",
      url,
      source: item.publisher ?? "Yahoo Finance",
      publishedAt: toEpochMs2(item.providerPublishTime),
      symbols: related.length > 0 ? related : symbol ? [symbol] : [],
      imageUrl: pickThumbnail(item)
    };
  }
  async probe() {
    const result = await this.fetch({ symbol: NEWS_HEALTH_CHECK_SYMBOL, limit: 5 });
    const count2 = result.data.articles.length;
    const latest = result.data.articles[0];
    return count2 === 0 ? `Reachable; no ${NEWS_HEALTH_CHECK_SYMBOL} headlines returned` : `Fetched ${count2} ${NEWS_HEALTH_CHECK_SYMBOL} headline(s); latest: ${latest?.headline.slice(0, 80)}`;
  }
};

// src/datasources/news/rssNews.ts
import Parser from "rss-parser";
init_errors();
init_logger();
var RSS_NEWS_SOURCE = "rss-news";
var RSS_FEEDS = [
  // Ticker feeds — query with {symbol}
  { id: "google-news", type: "ticker", urlTemplate: "https://news.google.com/rss/search?q={symbol}+stock&hl=en-US&gl=US&ceid=US:en" },
  { id: "yahoo-rss", type: "ticker", urlTemplate: "https://finance.yahoo.com/rss/headline?s={symbol}" },
  { id: "seeking-alpha", type: "ticker", urlTemplate: "https://seekingalpha.com/api/sa/combined/{symbol}.xml" },
  // Macro feeds — no symbol substitution
  { id: "federal-reserve", type: "macro", urlTemplate: "https://www.federalreserve.gov/feeds/press_all.xml" },
  { id: "cnbc", type: "macro", urlTemplate: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664" },
  // Filing feeds — no symbol substitution
  { id: "sec-8k", type: "filings", urlTemplate: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&output=atom" },
  { id: "sec-10q", type: "filings", urlTemplate: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-Q&output=atom" }
];
var USER_AGENT2 = "atn-trd/1.0 (Chester Kim almightyespanol@gmail.com)";
var defaultParser = new Parser({
  customFields: {
    item: [
      ["content:encoded", "content"],
      ["description", "summary"],
      ["media:content", "media"]
    ]
  },
  headers: {
    "User-Agent": USER_AGENT2
  }
});
function buildFeedUrl(feed, symbol) {
  if (feed.type === "ticker" && symbol) {
    return feed.urlTemplate.replace("{symbol}", encodeURIComponent(symbol));
  }
  return feed.urlTemplate;
}
function hashUrl(url) {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const char = url.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return String(Math.abs(hash));
}
function normalizeRssArticle(item, feedId, symbol) {
  const url = item.link ?? "";
  const publishedAt = item.pubDate ? new Date(item.pubDate).getTime() : Date.now();
  const symbols = [];
  if (symbol) {
    symbols.push(symbol);
  }
  const customFields = item;
  const summary = customFields.summary || customFields.content || "";
  return {
    id: hashUrl(url),
    headline: item.title ?? "(untitled)",
    summary,
    url,
    source: feedId,
    publishedAt,
    symbols,
    imageUrl: null
    // RSS feeds may have media, but the NewsArticle interface accepts null
  };
}
async function fetchRssFeed(feedUrl, parser) {
  try {
    const feed = await parser.parseURL(feedUrl);
    return feed.items ?? [];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new UpstreamError(
      `Failed to parse RSS feed from ${feedUrl}: ${message}`,
      RSS_NEWS_SOURCE
    );
  }
}
function deduplicateArticles(articles) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const article of articles) {
    if (!seen.has(article.id)) {
      seen.add(article.id);
      deduped.push(article);
    }
  }
  return deduped;
}
var RssNewsDataSource = class extends BaseDataSource {
  name = RSS_NEWS_SOURCE;
  kind = "news";
  provider = "rss";
  parser;
  now;
  log = logger.child({ component: "datasource", source: RSS_NEWS_SOURCE });
  constructor(options = {}) {
    super();
    this.parser = options.parser ?? defaultParser;
    this.now = options.now ?? Date.now;
  }
  async fetch(query = {}, _ctx) {
    const symbol = query.symbol ? normalizeNewsSymbol(query.symbol) : null;
    const limit = clampLimit(query.limit);
    try {
      const articles = await this.getRssNews(symbol);
      const deduplicated = deduplicateArticles(articles);
      const sliced = deduplicated.slice(0, limit);
      return {
        data: {
          symbol,
          articles: sliced,
          sentiment: null,
          warnings: ["RSS feeds do not expose sentiment scores"]
        },
        provider: this.provider,
        fetchedAt: this.now(),
        citations: sliced.map((a) => ({ title: a.headline, url: a.url })),
        raw: sliced
      };
    } catch (err) {
      throw this.toUpstreamError(err);
    }
  }
  /**
   * Fetch news from all relevant RSS feeds.
   */
  async getRssNews(symbol) {
    const articles = [];
    const errors = [];
    const feedPromises = [];
    if (symbol) {
      for (const feed of RSS_FEEDS.filter((f) => f.type === "ticker")) {
        const url = buildFeedUrl(feed, symbol);
        feedPromises.push({
          feed,
          promise: this.safelyFetchFeed(url)
        });
      }
    }
    for (const feed of RSS_FEEDS.filter((f) => f.type !== "ticker")) {
      feedPromises.push({
        feed,
        promise: this.safelyFetchFeed(feed.urlTemplate)
      });
    }
    const results = await Promise.allSettled(
      feedPromises.map(
        ({ feed, promise }) => promise.then((items) => ({ feed, items })).catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`${feed.id}: ${message}`);
          return { feed, items: [] };
        })
      )
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        const { feed, items } = result.value;
        for (const item of items) {
          try {
            const article = normalizeRssArticle(item, feed.id, symbol ?? void 0);
            articles.push(article);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.log.debug("failed to normalize RSS item", { feed: feed.id, error: message });
          }
        }
      }
    }
    if (errors.length > 0) {
      this.log.warn("RSS feed fetch errors", { errors });
    }
    return articles;
  }
  /**
   * Fetch a feed, returning empty array on error (graceful degradation).
   */
  async safelyFetchFeed(url) {
    try {
      return await fetchRssFeed(url, this.parser);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.debug("RSS feed fetch failed", { url, error: message });
      return [];
    }
  }
  toUpstreamError(err) {
    if (err instanceof UpstreamError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new UpstreamError(`RSS news fetch failed: ${message}`, RSS_NEWS_SOURCE);
  }
  async probe() {
    const result = await this.fetch({ symbol: NEWS_HEALTH_CHECK_SYMBOL, limit: 5 });
    const count2 = result.data.articles.length;
    return count2 === 0 ? "Reachable; no recent headlines found" : `Fetched ${count2} headline(s) from RSS feeds`;
  }
};

// src/datasources/news/index.ts
init_logger();
var log7 = logger.child({ component: "news-cache" });
var newsCache = /* @__PURE__ */ new Map();
var newsInflight = /* @__PURE__ */ new Map();
var NEWS_CACHE_TTL_MS = 5 * 60 * 1e3;
var CachedNewsDataSource = class {
  constructor(inner) {
    this.inner = inner;
  }
  inner;
  get name() {
    return this.inner.name;
  }
  get kind() {
    return this.inner.kind;
  }
  get provider() {
    return this.inner.provider;
  }
  isConfigured() {
    return this.inner.isConfigured();
  }
  healthCheck() {
    return this.inner.healthCheck();
  }
  async fetch(query, ctx) {
    const symbol = query?.symbol?.toUpperCase() ?? "general";
    const cacheKey = `news:${symbol}`;
    const now = Date.now();
    const requestedDays = this.getDaysFromQuery(query);
    const cached2 = newsCache.get(cacheKey);
    if (cached2 && cached2.expiresAt > now && cached2.days >= requestedDays) {
      log7.debug("news cache hit", { symbol, requestedDays, cachedDays: cached2.days });
      return cached2.data;
    }
    const inflight = newsInflight.get(cacheKey);
    if (inflight) {
      log7.debug("news cache inflight hit", { symbol });
      return inflight;
    }
    const maxDays = 90;
    const fromDate = new Date(now - maxDays * 864e5).toISOString().slice(0, 10);
    const toDate = new Date(now).toISOString().slice(0, 10);
    const promise = this.inner.fetch({ ...query, from: fromDate, to: toDate }, ctx).then((result) => {
      newsCache.set(cacheKey, { data: result, expiresAt: Date.now() + NEWS_CACHE_TTL_MS, days: maxDays });
      newsInflight.delete(cacheKey);
      log7.debug("news cache miss - fetched max range", { symbol, days: maxDays });
      return result;
    }).catch((err) => {
      newsInflight.delete(cacheKey);
      throw err;
    });
    newsInflight.set(cacheKey, promise);
    return promise;
  }
  getDaysFromQuery(query) {
    if (!query?.from) return 7;
    const from = new Date(query.from).getTime();
    const to = query.to ? new Date(query.to).getTime() : Date.now();
    return Math.ceil((to - from) / 864e5);
  }
};
var RssPrimaryDataSource = class {
  rss = new RssNewsDataSource();
  finnhub = new FinnhubNewsDataSource({ sentiment: false });
  get name() {
    return "rss-primary";
  }
  get kind() {
    return "news";
  }
  get provider() {
    return "rss";
  }
  isConfigured() {
    return this.rss.isConfigured() || this.finnhub.isConfigured();
  }
  async healthCheck() {
    const rssHealth = await this.rss.healthCheck();
    const finnhubHealth = await this.finnhub.healthCheck();
    const ok = rssHealth.ok || finnhubHealth.ok;
    return {
      name: "rss-primary",
      kind: "news",
      provider: "rss",
      configured: this.isConfigured(),
      ok,
      detail: ok ? "RSS + Finnhub fallback" : "Both unavailable",
      latencyMs: null,
      checkedAt: Date.now(),
      error: ok ? void 0 : "Both RSS and Finnhub down"
    };
  }
  async fetch(query, ctx) {
    try {
      const rssResult = await this.rss.fetch(query, ctx);
      if (rssResult.data.articles.length > 0) {
        log7.debug("rss-primary using rss source", { symbol: query?.symbol, count: rssResult.data.articles.length });
        return rssResult;
      }
    } catch (err) {
      log7.debug("rss-primary rss fetch failed, trying finnhub", { symbol: query?.symbol, error: err.message });
    }
    const finnhubResult = await this.finnhub.fetch(query, ctx);
    log7.debug("rss-primary using finnhub fallback", { symbol: query?.symbol, count: finnhubResult.data.articles.length });
    return finnhubResult;
  }
};
function createNewsDataSource(provider, options = {}) {
  let inner;
  switch (provider) {
    case "alpaca":
      inner = new AlpacaNewsDataSource();
      break;
    case "yahoo":
      inner = new YahooNewsDataSource();
      break;
    case "rss":
      inner = new RssPrimaryDataSource();
      break;
    default:
      inner = new FinnhubNewsDataSource({ sentiment: options.sentiment ?? false });
  }
  return new CachedNewsDataSource(inner);
}

// src/datasources/fundamentals/yahooFundamentals.ts
init_http();

// src/datasources/coerce.ts
function num2(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object" && typeof value.raw === "number") {
    return Number.isFinite(value.raw) ? value.raw : null;
  }
  return null;
}
function count(value) {
  return num2(value) ?? 0;
}
function epochMs(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return value > 1e12 ? value : value * 1e3;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === "object" && typeof value.raw === "number") {
    return epochMs(value.raw);
  }
  return null;
}

// src/datasources/fundamentals/yahooFundamentals.ts
init_errors();
init_logger();
var YAHOO_FUNDAMENTALS_SOURCE = "yahoo-fundamentals";
var FUNDAMENTALS_HEALTH_CHECK_SYMBOL = "AAPL";
var QUOTE_SUMMARY_MODULES = [
  "price",
  "summaryDetail",
  "defaultKeyStatistics",
  "financialData",
  "earnings",
  "calendarEvents",
  "assetProfile"
];
var DEFAULT_TIMEOUT_MS2 = 15e3;
var NOT_FOUND_MESSAGE = /(not found|no fundamentals data|no data found|invalid (?:symbol|crumb)|quote not found|symbol may be delisted)/i;
var THROTTLED_MESSAGE = /(too many requests|rate limit|status code 429)/i;
var cachedFn = null;
var defaultQuoteSummaryFn = async (symbol, modules) => {
  if (!cachedFn) {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
    cachedFn = async (s, mods) => (
      // validateResult:false keeps us resilient to Yahoo schema drift; only the
      // handful of fields used below are read, and each is coerced defensively.
      await yf.quoteSummary(s, { modules: mods }, { validateResult: false })
    );
  }
  return cachedFn(symbol, modules);
};
var YahooFundamentalsDataSource = class extends BaseDataSource {
  name = YAHOO_FUNDAMENTALS_SOURCE;
  kind = "fundamentals";
  provider = "yahoo";
  quoteSummaryFn;
  http;
  timeoutMs;
  now;
  log = logger.child({ component: "datasource", source: YAHOO_FUNDAMENTALS_SOURCE });
  constructor(options = {}) {
    super();
    this.quoteSummaryFn = options.quoteSummaryFn ?? defaultQuoteSummaryFn;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS2;
    this.now = options.now ?? Date.now;
    this.http = options.http ?? new HttpClient({
      name: YAHOO_FUNDAMENTALS_SOURCE,
      rateLimit: { capacity: 5, refillPerSecond: 2 },
      retry: { retries: 0, baseDelayMs: 400, maxDelayMs: 4e3 }
      // fail fast, fallback to Finnhub
    });
  }
  /** Public Yahoo data: no credentials required. */
  isConfigured() {
    return true;
  }
  async fetch(query, ctx) {
    const symbol = this.normalize(query?.symbol);
    const raw = await this.load(symbol, ctx);
    return {
      data: this.toPayload(symbol, raw),
      provider: this.provider,
      fetchedAt: this.now(),
      citations: [
        {
          title: `Yahoo Finance \u2014 ${symbol} key statistics`,
          url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/key-statistics`
        }
      ],
      raw
    };
  }
  normalize(symbol) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
      throw new ValidationError("Symbol is required");
    }
    return symbol.trim().toUpperCase();
  }
  async load(symbol, ctx) {
    let raw;
    try {
      raw = await this.http.run(
        () => withTimeout(
          () => this.quoteSummaryFn(symbol, QUOTE_SUMMARY_MODULES),
          this.timeoutMs,
          `${YAHOO_FUNDAMENTALS_SOURCE} quoteSummary(${symbol})`,
          ctx?.signal
        )
      );
    } catch (err) {
      if (err instanceof SymbolNotFoundError || err instanceof ValidationError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (NOT_FOUND_MESSAGE.test(message)) throw new SymbolNotFoundError(symbol);
      this.log.warn("fundamentals request failed", { symbol, error: message });
      if (THROTTLED_MESSAGE.test(message)) {
        throw new UpstreamError(
          "Yahoo Finance is throttling this host (Too Many Requests) and would not issue a session cookie. Try again in a few minutes.",
          YAHOO_FUNDAMENTALS_SOURCE
        );
      }
      throw new UpstreamError(
        `Could not reach Yahoo Finance for "${symbol}" fundamentals: ${message}`,
        YAHOO_FUNDAMENTALS_SOURCE
      );
    }
    if (!raw || typeof raw !== "object") throw new SymbolNotFoundError(symbol);
    const anyModule = raw.price || raw.summaryDetail || raw.defaultKeyStatistics || raw.financialData || raw.earnings;
    if (!anyModule) throw new SymbolNotFoundError(symbol);
    return raw;
  }
  toPayload(symbol, raw) {
    const price = raw.price ?? {};
    const detail = raw.summaryDetail ?? {};
    const stats = raw.defaultKeyStatistics ?? {};
    const financial = raw.financialData ?? {};
    const profile = raw.assetProfile ?? {};
    return {
      symbol,
      name: price.longName ?? price.shortName ?? null,
      currency: price.currency ?? financial.financialCurrency ?? null,
      price: num2(price.regularMarketPrice) ?? num2(financial.currentPrice),
      marketCap: num2(detail.marketCap),
      enterpriseValue: num2(stats.enterpriseValue),
      trailingPE: num2(detail.trailingPE),
      forwardPE: num2(detail.forwardPE),
      pegRatio: num2(stats.pegRatio),
      priceToBook: num2(stats.priceToBook),
      trailingEps: num2(stats.trailingEps),
      forwardEps: num2(stats.forwardEps),
      beta: num2(detail.beta) ?? num2(stats.beta),
      dividendYield: num2(detail.dividendYield),
      profitMargins: num2(financial.profitMargins) ?? num2(stats.profitMargins),
      grossMargins: num2(financial.grossMargins),
      operatingMargins: num2(financial.operatingMargins),
      revenueGrowth: num2(financial.revenueGrowth),
      earningsGrowth: num2(financial.earningsGrowth),
      returnOnEquity: num2(financial.returnOnEquity),
      returnOnAssets: num2(financial.returnOnAssets),
      debtToEquity: num2(financial.debtToEquity),
      currentRatio: num2(financial.currentRatio),
      quickRatio: num2(financial.quickRatio),
      totalRevenue: num2(financial.totalRevenue),
      totalCash: num2(financial.totalCash),
      totalDebt: num2(financial.totalDebt),
      freeCashflow: num2(financial.freeCashflow),
      targetMeanPrice: num2(financial.targetMeanPrice),
      recommendationKey: financial.recommendationKey ?? null,
      sector: profile.sector ?? null,
      industry: profile.industry ?? null,
      averageVolume: num2(detail.averageVolume),
      earnings: this.toEarnings(raw)
    };
  }
  toEarnings(raw) {
    const calendar = raw.calendarEvents?.earnings ?? {};
    const dates = (Array.isArray(calendar.earningsDate) ? calendar.earningsDate : []).map((d) => epochMs(d)).filter((d) => d !== null).sort((a, b) => a - b);
    const now = this.now();
    const nextEarningsDate = dates.find((d) => d >= now) ?? dates[dates.length - 1] ?? null;
    const quarterly = raw.earnings?.earningsChart?.quarterly ?? [];
    const recentQuarters = (Array.isArray(quarterly) ? quarterly : []).map((q) => ({
      period: String(q.date ?? ""),
      actual: num2(q.actual),
      estimate: num2(q.estimate)
    }));
    return {
      nextEarningsDate,
      earningsDates: dates,
      estimateAverage: num2(calendar.earningsAverage),
      estimateLow: num2(calendar.earningsLow),
      estimateHigh: num2(calendar.earningsHigh),
      exDividendDate: epochMs(raw.calendarEvents?.exDividendDate),
      dividendDate: epochMs(raw.calendarEvents?.dividendDate),
      recentQuarters
    };
  }
  async probe() {
    const result = await this.fetch({ symbol: FUNDAMENTALS_HEALTH_CHECK_SYMBOL });
    const { symbol, trailingPE, marketCap } = result.data;
    const pe = trailingPE === null ? "n/a" : trailingPE.toFixed(2);
    const cap = marketCap === null ? "n/a" : `${(marketCap / 1e9).toFixed(1)}B`;
    return `Fetched ${symbol} fundamentals (trailing P/E ${pe}, market cap ${cap})`;
  }
};

// src/datasources/fundamentals/finnhubFundamentals.ts
init_http();
init_errors();
init_logger();
var FINNHUB_FUNDAMENTALS_SOURCE = "finnhub-fundamentals";
var FINNHUB_API_KEY_SECRET2 = "FINNHUB_API_KEY";
var FINNHUB_BASE_URL2 = "https://finnhub.io/api/v1/";
var FinnhubFundamentalsDataSource = class extends BaseDataSource {
  name = FINNHUB_FUNDAMENTALS_SOURCE;
  kind = "fundamentals";
  provider = "finnhub";
  http;
  resolveKey;
  now;
  log = logger.child({ component: "datasource", source: FINNHUB_FUNDAMENTALS_SOURCE });
  constructor(options = {}) {
    super();
    this.resolveKey = options.resolveKey ?? apiKeyResolver(FINNHUB_API_KEY_SECRET2);
    this.now = options.now ?? Date.now;
    this.http = options.http ?? new HttpClient({
      name: FINNHUB_FUNDAMENTALS_SOURCE,
      baseUrl: FINNHUB_BASE_URL2,
      defaultHeaders: { accept: "application/json" },
      rateLimit: { capacity: 5, refillPerSecond: 1 },
      retry: { retries: 1, baseDelayMs: 300, maxDelayMs: 2e3 }
    });
  }
  isConfigured() {
    return this.resolveKey() !== void 0;
  }
  notConfiguredDetail() {
    return `Missing ${FINNHUB_API_KEY_SECRET2}`;
  }
  async fetch(query, ctx) {
    const key = this.requireKey();
    const symbol = query.symbol.trim().toUpperCase();
    const [metrics, quote] = await Promise.all([
      this.loadMetrics(key, symbol, ctx),
      this.loadQuote(key, symbol, ctx)
    ]);
    return {
      data: this.toPayload(symbol, metrics, quote),
      provider: this.provider,
      fetchedAt: this.now(),
      citations: [
        {
          title: `Finnhub \u2014 ${symbol} metrics`,
          url: `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`
        }
      ],
      raw: { metrics, quote }
    };
  }
  requireKey() {
    const key = this.resolveKey();
    if (!key) throw new DataSourceNotConfiguredError("Finnhub fundamentals", FINNHUB_API_KEY_SECRET2);
    return key;
  }
  async loadMetrics(key, symbol, ctx) {
    try {
      const raw = await this.http.json(
        `stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`,
        {
          headers: { "X-Finnhub-Token": key },
          ...ctx?.signal ? { signal: ctx.signal } : {}
        }
      );
      if (!raw?.metric || Object.keys(raw.metric).length === 0) {
        throw new SymbolNotFoundError(symbol);
      }
      return raw;
    } catch (err) {
      if (err instanceof SymbolNotFoundError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn("finnhub fundamentals request failed", { symbol, error: message });
      throw new UpstreamError(
        `Could not fetch Finnhub fundamentals for "${symbol}": ${message}`,
        FINNHUB_FUNDAMENTALS_SOURCE
      );
    }
  }
  async loadQuote(key, symbol, ctx) {
    try {
      return await this.http.json(
        `quote?symbol=${encodeURIComponent(symbol)}`,
        {
          headers: { "X-Finnhub-Token": key },
          ...ctx?.signal ? { signal: ctx.signal } : {}
        }
      );
    } catch {
      return null;
    }
  }
  toPayload(symbol, raw, quote) {
    const m = raw.metric ?? {};
    const price = quote?.c ?? null;
    const emptyEarnings = {
      nextEarningsDate: null,
      earningsDates: [],
      estimateAverage: null,
      estimateLow: null,
      estimateHigh: null,
      exDividendDate: null,
      dividendDate: null,
      recentQuarters: []
    };
    return {
      symbol,
      name: null,
      // Finnhub metric endpoint doesn't include name
      currency: null,
      price,
      marketCap: m["marketCapitalization"] ? m["marketCapitalization"] * 1e6 : null,
      enterpriseValue: m["enterpriseValue"] ? m["enterpriseValue"] * 1e6 : null,
      trailingPE: m["peBasicExclExtraTTM"] ?? m["peTTM"] ?? null,
      forwardPE: m["peExclExtraAnnual"] ?? null,
      pegRatio: m["pegRatioTTM"] ?? null,
      priceToBook: m["pbAnnual"] ?? m["pbQuarterly"] ?? null,
      trailingEps: m["epsBasicExclExtraItemsTTM"] ?? m["epsTTM"] ?? null,
      forwardEps: m["epsEstimateNextYear"] ?? null,
      beta: m["beta"] ?? null,
      dividendYield: m["dividendYieldIndicatedAnnual"] ?? null,
      profitMargins: m["netProfitMarginTTM"] ? m["netProfitMarginTTM"] / 100 : null,
      grossMargins: m["grossMarginTTM"] ? m["grossMarginTTM"] / 100 : null,
      operatingMargins: m["operatingMarginTTM"] ? m["operatingMarginTTM"] / 100 : null,
      revenueGrowth: m["revenueGrowthTTMYoy"] ? m["revenueGrowthTTMYoy"] / 100 : null,
      earningsGrowth: m["epsGrowthTTMYoy"] ? m["epsGrowthTTMYoy"] / 100 : null,
      returnOnEquity: m["roeTTM"] ? m["roeTTM"] / 100 : null,
      returnOnAssets: m["roaTTM"] ? m["roaTTM"] / 100 : null,
      debtToEquity: m["totalDebt/totalEquityAnnual"] ?? m["totalDebt/totalEquityQuarterly"] ?? null,
      currentRatio: m["currentRatioAnnual"] ?? m["currentRatioQuarterly"] ?? null,
      quickRatio: m["quickRatioAnnual"] ?? m["quickRatioQuarterly"] ?? null,
      totalRevenue: m["revenuePerShareTTM"] ? null : null,
      // Not directly available
      totalCash: m["cashPerSharePerShareAnnual"] ? null : null,
      totalDebt: null,
      freeCashflow: m["freeCashFlowTTM"] ? m["freeCashFlowTTM"] * 1e6 : null,
      targetMeanPrice: m["targetMeanPrice"] ?? null,
      recommendationKey: null,
      sector: null,
      // Finnhub metric endpoint doesn't include sector
      industry: null,
      // Finnhub metric endpoint doesn't include industry
      averageVolume: m["10DayAverageTradingVolume"] ? m["10DayAverageTradingVolume"] * 1e6 : null,
      earnings: emptyEarnings
    };
  }
  async probe() {
    const result = await this.fetch({ symbol: "AAPL" });
    const { symbol, trailingPE, marketCap } = result.data;
    const pe = trailingPE === null ? "n/a" : trailingPE.toFixed(2);
    const cap = marketCap === null ? "n/a" : `${(marketCap / 1e9).toFixed(1)}B`;
    return `Fetched ${symbol} fundamentals (trailing P/E ${pe}, market cap ${cap})`;
  }
};

// src/datasources/fundamentals/index.ts
init_logger();
var log8 = logger.child({ component: "fundamentals-datasource" });
function createFundamentalsDataSource(_provider = "finnhub") {
  const finnhub = new FinnhubFundamentalsDataSource();
  const yahoo = new YahooFundamentalsDataSource();
  return {
    name: "fundamentals-fallback",
    kind: "fundamentals",
    provider: "finnhub+yahoo",
    isConfigured: () => finnhub.isConfigured() || yahoo.isConfigured(),
    healthCheck: () => finnhub.isConfigured() ? finnhub.healthCheck() : yahoo.healthCheck(),
    async fetch(query, ctx) {
      if (finnhub.isConfigured()) {
        try {
          return await finnhub.fetch(query, ctx);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log8.debug("finnhub fundamentals failed, falling back to yahoo", {
            symbol: query.symbol,
            error: message
          });
        }
      }
      return await yahoo.fetch(query, ctx);
    }
  };
}

// src/datasources/macro/fredMacro.ts
init_http();
init_errors();
init_logger();
var FRED_MACRO_SOURCE = "fred-macro";
var FRED_API_KEY_SECRET = "FRED_API_KEY";
var FRED_BASE_URL = "https://api.stlouisfed.org/fred/";
var HEALTH_CHECK_SERIES = "GDP";
var DEFAULT_SERIES_IDS = [
  "DGS10",
  "DGS2",
  "T10Y2Y",
  "CPIAUCSL",
  "UNRATE",
  "FEDFUNDS",
  "VIXCLS",
  "UMCSENT"
];
var SERIES_LABELS = {
  DGS10: "10-Year Treasury Yield",
  DGS2: "2-Year Treasury Yield",
  T10Y2Y: "10Y-2Y Treasury Spread",
  CPIAUCSL: "CPI (All Urban Consumers)",
  UNRATE: "Unemployment Rate",
  FEDFUNDS: "Federal Funds Effective Rate",
  VIXCLS: "CBOE Volatility Index",
  UMCSENT: "Consumer Sentiment (U. Michigan)",
  GDP: "Gross Domestic Product"
};
var OBSERVATION_LIMIT = 8;
var SERIES_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
var FredMacroDataSource = class extends BaseDataSource {
  name = FRED_MACRO_SOURCE;
  kind = "macro";
  provider = "fred";
  http;
  resolveKey;
  defaultSeriesIds;
  now;
  log = logger.child({ component: "datasource", source: FRED_MACRO_SOURCE });
  constructor(options = {}) {
    super();
    this.resolveKey = options.resolveKey ?? apiKeyResolver(FRED_API_KEY_SECRET);
    this.defaultSeriesIds = options.defaultSeriesIds ?? [...DEFAULT_SERIES_IDS];
    this.now = options.now ?? Date.now;
    this.http = options.http ?? new HttpClient({
      name: FRED_MACRO_SOURCE,
      baseUrl: FRED_BASE_URL,
      defaultHeaders: { accept: "application/json" },
      // FRED allows 120 req/min; a small burst then ~2/s keeps us clear.
      rateLimit: { capacity: 5, refillPerSecond: 2 },
      retry: { retries: 2, baseDelayMs: 400, maxDelayMs: 4e3 }
    });
  }
  isConfigured() {
    return this.resolveKey() !== void 0;
  }
  notConfiguredDetail() {
    return `Missing ${FRED_API_KEY_SECRET}`;
  }
  async fetch(query = {}, ctx) {
    const key = this.requireKey();
    const seriesIds = this.resolveSeriesIds(query.seriesIds);
    const settled = await Promise.allSettled(
      seriesIds.map((id) => this.fetchSeries(key, id, ctx, query.asOfDate))
    );
    const series = [];
    const errors = [];
    const raw = {};
    settled.forEach((outcome, index) => {
      const seriesId = seriesIds[index];
      if (outcome.status === "fulfilled") {
        series.push(outcome.value.series);
        raw[seriesId] = outcome.value.raw;
      } else {
        const message = outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        errors.push({ seriesId, error: message });
        this.log.warn("macro series failed", { seriesId, error: message });
      }
    });
    if (series.length === 0 && errors.length > 0) {
      throw new UpstreamError(
        `FRED returned no usable series: ${errors[0].error}`,
        FRED_MACRO_SOURCE
      );
    }
    return {
      data: { series, errors },
      provider: this.provider,
      fetchedAt: this.now(),
      citations: series.map((s) => ({
        title: `FRED \u2014 ${s.label ?? s.seriesId}`,
        url: `https://fred.stlouisfed.org/series/${encodeURIComponent(s.seriesId)}`
      })),
      raw
    };
  }
  requireKey() {
    const key = this.resolveKey();
    if (!key) throw new DataSourceNotConfiguredError("FRED macro", FRED_API_KEY_SECRET);
    return key;
  }
  resolveSeriesIds(requested) {
    if (!requested) return this.defaultSeriesIds;
    if (!Array.isArray(requested) || requested.length === 0) {
      throw new ValidationError('Field "seriesIds" must be a non-empty array of FRED series ids');
    }
    return requested.map((id) => {
      if (typeof id !== "string" || !SERIES_ID_PATTERN.test(id.trim())) {
        throw new ValidationError(`Invalid FRED series id: ${String(id)}`);
      }
      return id.trim().toUpperCase();
    });
  }
  async fetchSeries(key, seriesId, ctx, asOfDate) {
    let path8 = `series/observations?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=${OBSERVATION_LIMIT}`;
    if (asOfDate) {
      path8 += `&realtime_start=${asOfDate}&realtime_end=${asOfDate}`;
    }
    let body;
    try {
      body = await this.http.json(path8, {
        ...ctx?.signal ? { signal: ctx.signal } : {}
      });
    } catch (err) {
      throw this.toUpstreamError(err, seriesId);
    }
    if (body.error_message) {
      throw new UpstreamError(`FRED error for ${seriesId}: ${body.error_message}`, FRED_MACRO_SOURCE);
    }
    const observations = Array.isArray(body.observations) ? body.observations : [];
    const usable = observations.map((o) => this.toObservation(o)).filter((o) => o !== null);
    if (usable.length === 0) {
      throw new UpstreamError(`FRED returned no observations for ${seriesId}`, FRED_MACRO_SOURCE);
    }
    const latest = usable[0];
    const prior = usable[1] ?? null;
    const change = prior ? latest.value - prior.value : null;
    const changePercent = prior && prior.value !== 0 ? (latest.value - prior.value) / Math.abs(prior.value) * 100 : null;
    const releasedAt = observations.find((o) => o.date === latest.date)?.realtime_start ?? null;
    return {
      series: {
        seriesId,
        label: SERIES_LABELS[seriesId] ?? null,
        latest,
        prior,
        change,
        changePercent,
        releasedAt
      },
      raw: body
    };
  }
  /** FRED writes missing prints as "."; skip them rather than emitting NaN. */
  toObservation(raw) {
    if (!raw?.date || typeof raw.value !== "string") return null;
    const value = Number(raw.value);
    if (raw.value.trim() === "." || !Number.isFinite(value)) return null;
    return { date: raw.date, value };
  }
  toUpstreamError(err, seriesId) {
    if (err instanceof HttpError) {
      const message2 = this.extractFredMessage(err.body);
      if (err.status === 400 || err.status === 401 || err.status === 403) {
        return new UpstreamError(
          message2 ? `FRED rejected the request (HTTP ${err.status}): ${message2}` : `FRED rejected the API key (HTTP ${err.status}). Check ${FRED_API_KEY_SECRET}.`,
          FRED_MACRO_SOURCE
        );
      }
      if (err.status === 429) {
        return new UpstreamError("FRED rate limit exceeded (HTTP 429)", FRED_MACRO_SOURCE);
      }
      return new UpstreamError(
        `FRED request for ${seriesId} failed (HTTP ${err.status})`,
        FRED_MACRO_SOURCE
      );
    }
    if (err instanceof UpstreamError) return err;
    const message = err instanceof Error ? err.message : String(err);
    return new UpstreamError(`Could not reach FRED: ${message}`, FRED_MACRO_SOURCE);
  }
  /** FRED puts a human-readable reason in the error body; surface it. */
  extractFredMessage(body) {
    if (!body) return null;
    try {
      const parsed = JSON.parse(body);
      return typeof parsed.error_message === "string" ? parsed.error_message : null;
    } catch {
      return null;
    }
  }
  async probe() {
    const key = this.requireKey();
    const { series } = await this.fetchSeries(key, HEALTH_CHECK_SERIES);
    const latest = series.latest;
    return latest ? `Fetched ${series.label ?? series.seriesId}: ${latest.value} (${latest.date})` : `Fetched ${series.seriesId}`;
  }
  /**
   * Get a single observation as it was known on a specific date (ALFRED vintage).
   * Useful for backtesting to avoid look-ahead bias.
   *
   * @param seriesId - FRED series ID (e.g., 'UNRATE', 'CPIAUCSL')
   * @param asOfDate - Date to query vintage data for (YYYY-MM-DD)
   * @returns The most recent observation available as of that date, or null
   */
  async getVintageObservation(seriesId, asOfDate, ctx) {
    const result = await this.fetch({ seriesIds: [seriesId], asOfDate }, ctx);
    const series = result.data.series.find((s) => s.seriesId === seriesId);
    return series?.latest ?? null;
  }
};

// src/datasources/macro/index.ts
function createMacroDataSource(_provider = "fred") {
  return new FredMacroDataSource();
}

// src/datasources/options/yahooOptions.ts
init_http();
init_errors();
init_logger();
init_optionsCalendar();
var YAHOO_OPTIONS_SOURCE = "yahoo-options";
var OPTIONS_HEALTH_CHECK_SYMBOL = "AAPL";
var DEFAULT_TIMEOUT_MS3 = 15e3;
var NOT_FOUND_MESSAGE2 = /(not found|no data found|invalid (?:symbol|crumb)|quote not found|symbol may be delisted|no options)/i;
var cachedFn2 = null;
var defaultOptionsFn = async (symbol, query) => {
  if (!cachedFn2) {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
    cachedFn2 = async (s, q) => (
      // validateResult:false keeps us resilient to Yahoo schema drift.
      await yf.options(
        s,
        q.date ? { date: q.date } : {},
        { validateResult: false }
      )
    );
  }
  return cachedFn2(symbol, query);
};
var YahooOptionsDataSource = class extends BaseDataSource {
  name = YAHOO_OPTIONS_SOURCE;
  kind = "options";
  provider = "yahoo";
  optionsFn;
  cboeFn;
  http;
  timeoutMs;
  now;
  cboeHttp = null;
  log = logger.child({ component: "datasource", source: YAHOO_OPTIONS_SOURCE });
  constructor(options = {}) {
    super();
    this.optionsFn = options.optionsFn ?? defaultOptionsFn;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS3;
    this.now = options.now ?? Date.now;
    this.http = options.http ?? new HttpClient({
      name: YAHOO_OPTIONS_SOURCE,
      rateLimit: { capacity: 5, refillPerSecond: 2 },
      retry: { retries: 0, baseDelayMs: 400, maxDelayMs: 4e3 }
      // fail fast, fallback to CBOE
    });
    this.cboeFn = options.cboeFn ?? (options.cboeFallback === false ? null : (symbol, query) => this.cboeChain(symbol, query));
  }
  /** Public Yahoo data: no credentials required. */
  isConfigured() {
    return true;
  }
  async fetch(query, ctx) {
    const symbol = this.normalize(query?.symbol);
    const expiration = this.normalizeExpiration(query?.expiration);
    let raw;
    let servedBy = "yahoo";
    try {
      raw = await this.load(symbol, expiration, ctx);
    } catch (err) {
      if (err instanceof SymbolNotFoundError || !this.cboeFn) throw err;
      this.log.warn("falling back to CBOE delayed quotes", {
        symbol,
        error: err instanceof Error ? err.message : String(err)
      });
      raw = await this.cboeFn(symbol, {
        ...expiration ? { expiration: expiration.getTime() } : {},
        ...ctx?.signal ? { signal: ctx.signal } : {}
      });
      servedBy = "cboe";
    }
    return {
      data: this.toPayload(symbol, raw, servedBy),
      provider: servedBy,
      fetchedAt: this.now(),
      citations: [
        servedBy === "cboe" ? {
          title: `CBOE delayed quotes \u2014 ${symbol} option chain`,
          url: `https://www.cboe.com/delayed_quotes/${encodeURIComponent(symbol.toLowerCase())}/quote_table`
        } : {
          title: `Yahoo Finance \u2014 ${symbol} option chain`,
          url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/options`
        }
      ],
      raw
    };
  }
  /** Lazily built so the CBOE client only exists once the fallback is used. */
  async cboeChain(symbol, query) {
    const { createCboeHttpClient: createCboeHttpClient2, fetchCboeChain: fetchCboeChain2 } = await Promise.resolve().then(() => (init_cboeOptions(), cboeOptions_exports));
    if (!this.cboeHttp) this.cboeHttp = createCboeHttpClient2();
    return fetchCboeChain2(this.cboeHttp, symbol, { ...query, now: this.now() });
  }
  normalize(symbol) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
      throw new ValidationError("Symbol is required");
    }
    return symbol.trim().toUpperCase();
  }
  normalizeExpiration(expiration) {
    if (expiration === void 0 || expiration === null) return void 0;
    if (typeof expiration !== "number" || !Number.isFinite(expiration)) {
      throw new ValidationError('Field "expiration" must be an epoch-millisecond number');
    }
    return new Date(expiration);
  }
  async load(symbol, expiration, ctx) {
    let raw;
    try {
      raw = await this.http.run(
        () => withTimeout(
          () => this.optionsFn(symbol, expiration ? { date: expiration } : {}),
          this.timeoutMs,
          `${YAHOO_OPTIONS_SOURCE} options(${symbol})`,
          ctx?.signal
        )
      );
    } catch (err) {
      if (err instanceof SymbolNotFoundError || err instanceof ValidationError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (NOT_FOUND_MESSAGE2.test(message)) throw new SymbolNotFoundError(symbol);
      this.log.warn("option chain request failed", { symbol, error: message });
      throw new UpstreamError(
        `Could not reach Yahoo Finance for "${symbol}" options: ${message}`,
        YAHOO_OPTIONS_SOURCE
      );
    }
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.options)) {
      throw new SymbolNotFoundError(symbol);
    }
    return raw;
  }
  toPayload(symbol, raw, servedBy) {
    const chain = raw.options?.[0];
    const expiration = epochMs(chain?.expirationDate);
    const calls = this.toContracts(chain?.calls, expiration);
    const puts = this.toContracts(chain?.puts, expiration);
    const underlyingPrice = num2(raw.quote?.regularMarketPrice);
    const expirationDates = (Array.isArray(raw.expirationDates) ? raw.expirationDates : []).map((d) => epochMs(d)).filter((d) => d !== null).sort((a, b) => a - b);
    return {
      symbol: (raw.underlyingSymbol ?? symbol).toUpperCase(),
      underlyingPrice,
      expiration,
      expirationDates,
      calls,
      puts,
      metrics: computeOptionsMetrics(calls, puts, underlyingPrice),
      calendar: buildExpiryCalendar(this.now(), expirationDates),
      servedBy
    };
  }
  toContracts(contracts, fallbackExpiration) {
    if (!Array.isArray(contracts)) return [];
    return contracts.filter((c) => num2(c.strike) !== null).map(
      (c) => withVolumeFlags({
        contractSymbol: c.contractSymbol ?? "",
        strike: num2(c.strike),
        lastPrice: num2(c.lastPrice),
        bid: num2(c.bid),
        ask: num2(c.ask),
        volume: count(c.volume),
        openInterest: count(c.openInterest),
        impliedVolatility: num2(c.impliedVolatility),
        inTheMoney: typeof c.inTheMoney === "boolean" ? c.inTheMoney : null,
        expiration: epochMs(c.expiration) ?? fallbackExpiration
      })
    );
  }
  async probe() {
    const { data } = await this.fetch({ symbol: OPTIONS_HEALTH_CHECK_SYMBOL });
    const pcr = data.metrics.putCallOpenInterestRatio;
    const days = data.calendar.daysToNextExpiry;
    return `Fetched ${data.symbol} chain via ${data.servedBy}: ${data.calls.length} calls / ${data.puts.length} puts, P/C OI ${pcr === null ? "n/a" : pcr.toFixed(2)}, next expiry ${days === null ? "unknown" : `in ${days}d`}`;
  }
  /** Public method to normalize a raw chain (used by index fallback). */
  normalizeChain(raw, symbol, fetchedAt) {
    return {
      data: this.toPayload(symbol, raw, "cboe"),
      provider: "cboe",
      fetchedAt,
      citations: [
        {
          title: `CBOE delayed quotes \u2014 ${symbol} option chain`,
          url: `https://www.cboe.com/delayed_quotes/${encodeURIComponent(symbol.toLowerCase())}/quote_table`
        }
      ],
      raw
    };
  }
};

// src/datasources/options/index.ts
init_cboeOptions();
init_logger();
init_optionsCalendar();
init_cboeOptions();
var log9 = logger.child({ component: "options-datasource" });
function createOptionsDataSource(_provider = "cboe") {
  const yahoo = new YahooOptionsDataSource();
  const cboeHttp = createCboeHttpClient();
  return {
    name: "options-fallback",
    kind: "options",
    provider: "cboe+yahoo",
    isConfigured: () => true,
    healthCheck: () => yahoo.healthCheck(),
    async fetch(query, ctx) {
      const symbol = query.symbol.trim().toUpperCase();
      const now = Date.now();
      try {
        const chain = await fetchCboeChain(cboeHttp, symbol, {
          expiration: query.expiration,
          now,
          signal: ctx?.signal
        });
        return yahoo.normalizeChain(chain, symbol, now);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log9.debug("cboe options failed, falling back to yahoo", {
          symbol,
          error: message
        });
      }
      return await yahoo.fetch(query, ctx);
    }
  };
}

// src/datasources/registry.ts
var REQUIRED_SECRETS = {
  "finnhub-news": FINNHUB_API_KEY_SECRET,
  "fred-macro": FRED_API_KEY_SECRET
};
var log10 = logger.child({ component: "datasource-registry" });
function defaultReadSettings() {
  try {
    return getSettings().dataSources;
  } catch (err) {
    log10.warn("falling back to default data source settings", {
      error: err instanceof Error ? err.message : String(err)
    });
    return DEFAULT_SETTINGS.dataSources;
  }
}
function defaultCreateSource(id, provider) {
  switch (id) {
    case "news":
      return createNewsDataSource(provider, { sentiment: false });
    case "fundamentals":
      return createFundamentalsDataSource(provider);
    case "macro":
      return createMacroDataSource(provider);
    case "options":
      return createOptionsDataSource(provider);
    default:
      throw new NotFoundError(`Unknown data source: ${String(id)}`);
  }
}
function createDataSourceRegistry(deps = {}) {
  const readSettings = deps.readSettings ?? defaultReadSettings;
  const createSource = deps.createSource ?? defaultCreateSource;
  const cache2 = /* @__PURE__ */ new Map();
  function settingsFor(id) {
    const configured = readSettings()[id];
    return {
      provider: configured?.provider ?? DEFAULT_SETTINGS.dataSources[id].provider,
      enabled: configured?.enabled ?? DEFAULT_SETTINGS.dataSources[id].enabled
    };
  }
  function get(id) {
    const { provider } = settingsFor(id);
    const key = `${id}:${provider}`;
    let source = cache2.get(key);
    if (!source) {
      source = createSource(id, provider);
      cache2.set(key, source);
    }
    return source;
  }
  function describe(id) {
    const { provider, enabled } = settingsFor(id);
    const source = get(id);
    const secretName = REQUIRED_SECRETS[source.name] ?? null;
    const configured = source.isConfigured();
    return {
      id,
      provider,
      name: source.name,
      // `isConfigured` reads the secret store, so this reflects live state.
      configured,
      enabled,
      requiresKey: secretName !== null,
      secretName
    };
  }
  return {
    ids: () => DATA_SOURCE_IDS,
    get,
    describe,
    list: () => DATA_SOURCE_IDS.map((id) => describe(id)),
    // `healthCheck` never throws: a dead provider yields `{ ok: false }`.
    test: (id) => get(id).healthCheck()
  };
}
var dataSourceRegistry = createDataSourceRegistry();

// src/routes/datasources.ts
init_errors();
init_logger();
var log11 = logger.child({ component: "datasources-route" });
function parseId(req) {
  const { id } = req.params;
  if (!isDataSourceId(id)) {
    throw new NotFoundError(
      `Unknown data source "${String(id)}". Expected one of: ${DATA_SOURCE_IDS.join(", ")}`
    );
  }
  return id;
}
function createListDataSourcesHandler(deps = {}) {
  const registry = deps.registry ?? dataSourceRegistry;
  return function listDataSourcesHandler2(_req, res, next) {
    try {
      res.json({ ok: true, data: registry.list() });
    } catch (err) {
      next(err);
    }
  };
}
function createTestDataSourceHandler(deps = {}) {
  const registry = deps.registry ?? dataSourceRegistry;
  return async function testDataSourceHandler2(req, res, next) {
    let id;
    try {
      id = parseId(req);
    } catch (err) {
      next(err);
      return;
    }
    try {
      const health = await registry.test(id);
      log11.info("data source test", {
        id,
        provider: health.provider,
        ok: health.ok,
        latencyMs: health.latencyMs
      });
      res.json({
        ok: health.ok,
        id,
        name: health.name,
        provider: health.provider,
        configured: health.configured,
        detail: health.detail,
        latencyMs: health.latencyMs,
        checkedAt: health.checkedAt
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log11.error("data source test failed unexpectedly", { id, error: message });
      res.json({ ok: false, id, detail: message, latencyMs: null, checkedAt: Date.now() });
    }
  };
}
var listDataSourcesHandler = createListDataSourcesHandler();
var testDataSourceHandler = createTestDataSourceHandler();

// src/repos/watchlistRepo.ts
var WatchlistRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  list() {
    const rows = this.db.prepare("SELECT symbol, enabled, note, added_at as addedAt FROM watchlist ORDER BY symbol").all();
    return rows.map((r) => ({ ...r, enabled: !!r.enabled }));
  }
  get(symbol) {
    const row = this.db.prepare("SELECT symbol, enabled, note, added_at as addedAt FROM watchlist WHERE symbol = ?").get(symbol);
    return row ? { ...row, enabled: !!row.enabled } : void 0;
  }
  upsert(row) {
    this.db.prepare(
      `INSERT INTO watchlist (symbol, enabled, note, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET enabled = excluded.enabled, note = excluded.note`
    ).run(row.symbol, row.enabled ? 1 : 0, row.note, row.addedAt);
  }
  remove(symbol) {
    this.db.prepare("DELETE FROM watchlist WHERE symbol = ?").run(symbol);
  }
  /**
   * Insert the symbol if absent, enabled by default. Existing rows keep their
   * `addedAt`, `enabled` and `note` so re-adding is a safe no-op.
   * Clears any removal tombstone for this symbol.
   */
  addSymbol(symbol, note = null) {
    const normalized = normalize(symbol);
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO watchlist (symbol, enabled, note, added_at) VALUES (?, 1, ?, ?)
           ON CONFLICT(symbol) DO NOTHING`
      ).run(normalized, note, Date.now());
      this.db.prepare("DELETE FROM watchlist_removals WHERE symbol = ?").run(normalized);
    })();
    return this.get(normalized);
  }
  /** Returns true when a row was actually deleted. Records a removal tombstone. */
  removeSymbol(symbol) {
    const normalized = normalize(symbol);
    let deleted = false;
    this.db.transaction(() => {
      const info = this.db.prepare("DELETE FROM watchlist WHERE symbol = ?").run(normalized);
      deleted = info.changes > 0;
      if (deleted) {
        this.db.prepare(
          `INSERT INTO watchlist_removals (symbol, removed_at) VALUES (?, ?)
             ON CONFLICT(symbol) DO UPDATE SET removed_at = excluded.removed_at`
        ).run(normalized, Date.now());
      }
    })();
    return deleted;
  }
  /**
   * Add a symbol acquired via a position fill, unless it's already tracked or
   * the user explicitly removed it. Returns the row if added, null if skipped.
   */
  addSymbolIfNotRemoved(symbol, note = null) {
    const normalized = normalize(symbol);
    const existing = this.get(normalized);
    if (existing) {
      return existing;
    }
    const removedRow = this.db.prepare("SELECT symbol FROM watchlist_removals WHERE symbol = ?").get(normalized);
    if (removedRow) {
      return null;
    }
    return this.addSymbol(normalized, note);
  }
  /** Returns true when the symbol exists (and is now enabled). */
  enableSymbol(symbol) {
    return this.setEnabled(symbol, true);
  }
  /** Returns true when the symbol exists (and is now disabled). */
  disableSymbol(symbol) {
    return this.setEnabled(symbol, false);
  }
  setEnabled(symbol, enabled) {
    const info = this.db.prepare("UPDATE watchlist SET enabled = ? WHERE symbol = ?").run(enabled ? 1 : 0, normalize(symbol));
    return info.changes > 0;
  }
};
function normalize(symbol) {
  return symbol.trim().toUpperCase();
}

// src/repos/symbolCategoriesRepo.ts
var SymbolCategoriesRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  upsert(row) {
    this.db.prepare(
      `INSERT INTO symbol_categories (symbol, category, sector, yield_percent, dividend_growth_percent, est_cagr_percent, last_screened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET
           category = excluded.category,
           sector = excluded.sector,
           yield_percent = excluded.yield_percent,
           dividend_growth_percent = excluded.dividend_growth_percent,
           est_cagr_percent = excluded.est_cagr_percent,
           last_screened_at = excluded.last_screened_at,
           updated_at = excluded.updated_at`
    ).run(
      row.symbol,
      row.category,
      row.sector,
      row.yieldPercent,
      row.dividendGrowthPercent,
      row.estCagrPercent,
      row.lastScreenedAt,
      Date.now()
    );
  }
  get(symbol) {
    return this.db.prepare(
      `SELECT symbol, category, sector, yield_percent as yieldPercent, dividend_growth_percent as dividendGrowthPercent,
           est_cagr_percent as estCagrPercent, last_screened_at as lastScreenedAt, updated_at as updatedAt
         FROM symbol_categories WHERE symbol = ?`
    ).get(symbol);
  }
  listAll() {
    return this.db.prepare(
      `SELECT symbol, category, sector, yield_percent as yieldPercent, dividend_growth_percent as dividendGrowthPercent,
           est_cagr_percent as estCagrPercent, last_screened_at as lastScreenedAt, updated_at as updatedAt
         FROM symbol_categories ORDER BY symbol`
    ).all();
  }
  getBySymbols(symbols) {
    if (symbols.length === 0) return [];
    const placeholders = symbols.map(() => "?").join(",");
    return this.db.prepare(
      `SELECT symbol, category, sector, yield_percent as yieldPercent, dividend_growth_percent as dividendGrowthPercent,
           est_cagr_percent as estCagrPercent, last_screened_at as lastScreenedAt, updated_at as updatedAt
         FROM symbol_categories WHERE symbol IN (${placeholders}) ORDER BY symbol`
    ).all(...symbols);
  }
  getSector(symbol) {
    const row = this.db.prepare("SELECT sector FROM symbol_categories WHERE symbol = ?").get(symbol);
    return row?.sector ?? null;
  }
};

// src/repos/strategicPlansRepo.ts
var StrategicPlansRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(plan) {
    this.db.prepare(
      `INSERT INTO strategic_plans (id, symbol, direction, target_shares, executed_shares, target_weight,
           target_budget_cents, tranche_count, tranches_executed, min_days_between, entry_composite_score,
           conviction_at_creation, status, pause_reason, creation_notes, created_at, last_tranche_at, completed_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`
    ).run(
      plan.id,
      plan.symbol,
      plan.direction,
      plan.targetShares,
      plan.targetWeight,
      plan.targetBudgetCents,
      plan.trancheCount,
      plan.minDaysBetween,
      plan.entryCompositeScore,
      plan.convictionAtCreation,
      plan.status,
      plan.pauseReason,
      plan.creationNotes,
      plan.createdAt
    );
  }
  get(id) {
    return this.db.prepare(
      `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE id = ?`
    ).get(id);
  }
  getActiveBySymbol(symbol) {
    return this.db.prepare(
      `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE symbol = ? AND status = 'ACTIVE'`
    ).get(symbol);
  }
  listActive() {
    return this.db.prepare(
      `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE status = 'ACTIVE' ORDER BY created_at`
    ).all();
  }
  listPaused() {
    return this.db.prepare(
      `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE status = 'PAUSED' ORDER BY created_at`
    ).all();
  }
  listBySymbol(symbol) {
    return this.db.prepare(
      `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE symbol = ? ORDER BY created_at DESC`
    ).all(symbol);
  }
  updateStatus(id, status, pauseReason) {
    const completedAt = status === "COMPLETED" || status === "CANCELLED" ? Date.now() : null;
    this.db.prepare(
      `UPDATE strategic_plans SET status = ?, pause_reason = ?, completed_at = ? WHERE id = ?`
    ).run(status, pauseReason ?? null, completedAt, id);
  }
  recordTrancheExecution(id, shares) {
    this.db.prepare(
      `UPDATE strategic_plans SET
           executed_shares = executed_shares + ?,
           tranches_executed = tranches_executed + 1,
           last_tranche_at = ?
         WHERE id = ?`
    ).run(shares, Date.now(), id);
  }
};

// src/routes/watchlist.ts
init_errors();

// src/services/symbolService.ts
init_errors();

// src/datasources/prices/yahooPrices.ts
init_http();
init_errors();
init_logger();
var YAHOO_PRICES_SOURCE = "yahoo-prices";
var HEALTH_CHECK_SYMBOL = "AAPL";
var YAHOO_CHART_BASE_URL = "https://query1.finance.yahoo.com/";
var USER_AGENT3 = "atn-trd/0.1.0";
var NOT_FOUND_MESSAGE3 = /(not found|no data found|invalid (?:symbol|crumb)|quote not found|symbol may be delisted)/i;
var cachedQuoteFn = null;
var defaultQuoteFn = async (symbol) => {
  if (!cachedQuoteFn) {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
    cachedQuoteFn = async (s) => {
      const result = await yf.quote(s, {}, { validateResult: false });
      return Array.isArray(result) ? result[0] : result;
    };
  }
  return cachedQuoteFn(symbol);
};
function normalizeSymbol(symbol) {
  return symbol.trim().toUpperCase();
}
function toEpochMs3(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") {
    return value > 1e12 ? value : value * 1e3;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}
var YahooPricesDataSource = class extends BaseDataSource {
  name = YAHOO_PRICES_SOURCE;
  kind = "prices";
  provider = "yahoo";
  quoteFn;
  chartFn;
  http;
  log = logger.child({ component: "datasource", source: YAHOO_PRICES_SOURCE });
  constructor(options = {}) {
    super();
    this.quoteFn = options.quoteFn ?? defaultQuoteFn;
    this.http = options.http ?? new HttpClient({
      name: YAHOO_PRICES_SOURCE,
      baseUrl: YAHOO_CHART_BASE_URL,
      defaultHeaders: { "user-agent": USER_AGENT3, accept: "application/json" },
      // Yahoo's public endpoints throttle hard; allow a small burst then
      // settle at ~2 requests/second.
      rateLimit: { capacity: 5, refillPerSecond: 2 },
      retry: { retries: 2, baseDelayMs: 400, maxDelayMs: 4e3 }
    });
    this.chartFn = options.chartFn ?? (options.chartFallback === false ? null : (s) => this.chartQuote(s));
  }
  /** Basic quotes are free and unauthenticated. */
  isConfigured() {
    return true;
  }
  async fetch(request) {
    return this.quote(request.symbol);
  }
  async quote(symbol) {
    if (typeof symbol !== "string" || symbol.trim().length === 0) {
      throw new ValidationError("Symbol is required");
    }
    const normalized = normalizeSymbol(symbol);
    try {
      return await this.tryProvider(
        (s) => this.http.run(() => this.quoteFn(s)),
        normalized,
        "quote"
      );
    } catch (err) {
      if (err instanceof SymbolNotFoundError || !this.chartFn) throw err;
      this.log.warn("falling back to chart endpoint", {
        symbol: normalized,
        error: err instanceof Error ? err.message : String(err)
      });
      return this.tryProvider(this.chartFn, normalized, "chart");
    }
  }
  /** Fetch a quote from Yahoo's unauthenticated chart endpoint. */
  async chartQuote(symbol) {
    const path8 = `v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
    let body;
    try {
      body = await this.http.json(path8);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        throw new SymbolNotFoundError(symbol);
      }
      throw err;
    }
    if (body.chart?.error) {
      throw new SymbolNotFoundError(symbol);
    }
    return body.chart?.result?.[0]?.meta;
  }
  /** Runs one provider and normalizes both its payload and its failures. */
  async tryProvider(fn, normalized, label) {
    let raw;
    try {
      raw = await fn(normalized);
    } catch (err) {
      if (err instanceof SymbolNotFoundError || err instanceof ValidationError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (NOT_FOUND_MESSAGE3.test(message)) {
        throw new SymbolNotFoundError(normalized);
      }
      this.log.warn("quote request failed", { symbol: normalized, via: label, error: message });
      throw new UpstreamError(
        `Could not reach Yahoo Finance to price "${normalized}"`,
        YAHOO_PRICES_SOURCE
      );
    }
    if (!raw || typeof raw.regularMarketPrice !== "number" || !Number.isFinite(raw.regularMarketPrice)) {
      throw new SymbolNotFoundError(normalized);
    }
    return {
      symbol: (raw.symbol ?? normalized).toUpperCase(),
      name: raw.shortName ?? raw.longName ?? raw.displayName ?? normalized,
      price: raw.regularMarketPrice,
      currency: (raw.currency ?? "USD").toUpperCase(),
      timestamp: toEpochMs3(raw.regularMarketTime),
      exchange: raw.fullExchangeName ?? raw.exchange ?? null,
      marketState: raw.marketState ?? null
    };
  }
  async probe() {
    await this.quote(HEALTH_CHECK_SYMBOL);
  }
};
var yahooPrices = new YahooPricesDataSource();

// src/services/symbolService.ts
var SYMBOL_PATTERN = /^\^?[A-Z0-9][A-Z0-9.\-=]{0,19}$/;
function createSymbolService(deps) {
  function normalize2(input) {
    if (typeof input !== "string") {
      throw new ValidationError("Symbol is required and must be a string");
    }
    const symbol = input.trim().toUpperCase();
    if (symbol.length === 0) {
      throw new ValidationError("Symbol is required");
    }
    if (!SYMBOL_PATTERN.test(symbol)) {
      throw new ValidationError(
        `Invalid symbol "${symbol}". Use 1-20 characters: letters, digits, and . - = ^`
      );
    }
    return symbol;
  }
  async function validateSymbol2(input) {
    const symbol = normalize2(input);
    try {
      const quote = await deps.prices.quote(symbol);
      return {
        symbol: quote.symbol,
        name: quote.name,
        price: quote.price,
        currency: quote.currency,
        timestamp: quote.timestamp
      };
    } catch (err) {
      if (err instanceof SymbolNotFoundError) {
        throw new ValidationError(
          `Unknown symbol "${symbol}". Check the ticker and try again.`
        );
      }
      if (err instanceof UpstreamError) {
        throw err;
      }
      if (err instanceof ValidationError) {
        throw err;
      }
      throw new UpstreamError(
        `Could not validate symbol "${symbol}" right now. Try again shortly.`
      );
    }
  }
  return { normalize: normalize2, validateSymbol: validateSymbol2 };
}
var symbolService = createSymbolService({ prices: yahooPrices });
function normalizeSymbol2(input) {
  return symbolService.normalize(input);
}
function validateSymbol(input) {
  return symbolService.validateSymbol(input);
}

// src/services/autoBacktestService.ts
import { spawn } from "node:child_process";
import path4 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/repos/backtestRepo.ts
import { randomUUID } from "crypto";
var BacktestRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  createRun(input) {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO backtest_runs (id, name, start_date, end_date, symbols_json, settings_snapshot, status, started_at, finished_at, error)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL)
    `).run(id, input.name ?? null, input.startDate, input.endDate, JSON.stringify(input.symbols), input.settingsSnapshot, now);
    return id;
  }
  updateRunStatus(id, status, error) {
    this.db.prepare(`
      UPDATE backtest_runs SET status = ?, finished_at = ?, error = ?, progress = ? WHERE id = ?
    `).run(status, Date.now(), error ?? null, status === "succeeded" ? "completed" : "failed", id);
  }
  updateProgress(id, progress) {
    this.db.prepare(`
      UPDATE backtest_runs SET progress = ? WHERE id = ?
    `).run(progress, id);
  }
  updateSettingsSnapshot(id, settingsSnapshot) {
    this.db.prepare(`
      UPDATE backtest_runs SET settings_snapshot = ? WHERE id = ?
    `).run(settingsSnapshot, id);
  }
  getRun(id) {
    const row = this.db.prepare(`
      SELECT id, name, start_date, end_date, symbols_json, settings_snapshot, status, progress, started_at, finished_at, error, analysis
      FROM backtest_runs WHERE id = ?
    `).get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      symbols: JSON.parse(row.symbols_json),
      settingsSnapshot: row.settings_snapshot,
      status: row.status,
      progress: row.progress,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
      analysis: row.analysis
    };
  }
  listRuns(limit = 20) {
    const rows = this.db.prepare(`
      SELECT id, name, start_date, end_date, symbols_json, settings_snapshot, status, progress, started_at, finished_at, error, analysis
      FROM backtest_runs ORDER BY started_at DESC LIMIT ?
    `).all(limit);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      symbols: JSON.parse(row.symbols_json),
      settingsSnapshot: row.settings_snapshot,
      status: row.status,
      progress: row.progress,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      error: row.error,
      analysis: row.analysis
    }));
  }
  createSnapshot(input) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO backtest_snapshots (id, backtest_id, as_of_date, cash_cents, positions_json, total_value_cents, benchmark_value_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.backtestId, input.asOfDate, input.cashCents, JSON.stringify(input.positions), input.totalValueCents, input.benchmarkValueCents ?? null);
    return id;
  }
  getSnapshots(backtestId) {
    const rows = this.db.prepare(`
      SELECT id, backtest_id, as_of_date, cash_cents, positions_json, total_value_cents, benchmark_value_cents
      FROM backtest_snapshots WHERE backtest_id = ? ORDER BY as_of_date
    `).all(backtestId);
    return rows.map((row) => ({
      id: row.id,
      backtestId: row.backtest_id,
      asOfDate: row.as_of_date,
      cashCents: row.cash_cents,
      positions: JSON.parse(row.positions_json),
      totalValueCents: row.total_value_cents,
      benchmarkValueCents: row.benchmark_value_cents
    }));
  }
  createTrade(input) {
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO backtest_trades (id, backtest_id, trade_date, symbol, side, qty, price_cents, rationale)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.backtestId, input.tradeDate, input.symbol, input.side, input.qty, input.priceCents, input.rationale ?? null);
    return id;
  }
  getTrades(backtestId) {
    const rows = this.db.prepare(`
      SELECT id, backtest_id, trade_date, symbol, side, qty, price_cents, rationale
      FROM backtest_trades WHERE backtest_id = ? ORDER BY trade_date
    `).all(backtestId);
    return rows.map((row) => ({
      id: row.id,
      backtestId: row.backtest_id,
      tradeDate: row.trade_date,
      symbol: row.symbol,
      side: row.side,
      qty: row.qty,
      priceCents: row.price_cents,
      rationale: row.rationale
    }));
  }
  saveMetrics(metrics) {
    this.db.prepare(`
      INSERT OR REPLACE INTO backtest_metrics (backtest_id, total_return, benchmark_return, sharpe_ratio, sortino_ratio, max_drawdown, win_rate, avg_win, avg_loss, total_trades, per_symbol_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      metrics.backtestId,
      metrics.totalReturn,
      metrics.benchmarkReturn,
      metrics.sharpeRatio,
      metrics.sortinoRatio,
      metrics.maxDrawdown,
      metrics.winRate,
      metrics.avgWin,
      metrics.avgLoss,
      metrics.totalTrades,
      metrics.perSymbol ? JSON.stringify(metrics.perSymbol) : null
    );
  }
  getMetrics(backtestId) {
    const row = this.db.prepare(`
      SELECT backtest_id, total_return, benchmark_return, sharpe_ratio, sortino_ratio, max_drawdown, win_rate, avg_win, avg_loss, total_trades, per_symbol_json
      FROM backtest_metrics WHERE backtest_id = ?
    `).get(backtestId);
    if (!row) return null;
    return {
      backtestId: row.backtest_id,
      totalReturn: row.total_return,
      benchmarkReturn: row.benchmark_return,
      sharpeRatio: row.sharpe_ratio,
      sortinoRatio: row.sortino_ratio,
      maxDrawdown: row.max_drawdown,
      winRate: row.win_rate,
      avgWin: row.avg_win,
      avgLoss: row.avg_loss,
      totalTrades: row.total_trades,
      perSymbol: row.per_symbol_json ? JSON.parse(row.per_symbol_json) : null
    };
  }
  updateAnalysis(id, analysis) {
    this.db.prepare(`
      UPDATE backtest_runs SET analysis = ? WHERE id = ?
    `).run(analysis, id);
  }
};

// src/services/autoBacktestService.ts
init_logger();
var log12 = logger.child({ component: "auto-backtest" });
var __dirname2 = path4.dirname(fileURLToPath2(import.meta.url));
var runningBacktests = /* @__PURE__ */ new Set();
var debounceTimer = null;
var pendingDb = null;
var DEBOUNCE_MS = 2e3;
function queueWatchlistBacktest(db2) {
  pendingDb = db2;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (pendingDb) {
      runBacktestNow(pendingDb);
      pendingDb = null;
    }
  }, DEBOUNCE_MS);
}
function spawnBacktestCli(backtestId, config, repo) {
  const scriptPath = path4.join(__dirname2, "..", "..", "scripts", "backtest.ts");
  const cash = config.startingCashCents ? Math.floor(config.startingCashCents / 100) : 1e5;
  const args = [
    scriptPath,
    "--start",
    config.startDate,
    "--end",
    config.endDate,
    "--symbols",
    config.symbols.join(","),
    "--cash",
    cash.toString(),
    "--backtest-id",
    backtestId
  ];
  log12.info("spawning backtest CLI", { backtestId, symbols: config.symbols.length });
  const child = spawn("npx", ["tsx", ...args], {
    cwd: path4.join(__dirname2, "..", ".."),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr?.on("data", (data) => {
    stderr += data.toString();
  });
  child.on("close", (code) => {
    if (code === 0) {
      log12.info("backtest CLI completed", { backtestId });
    } else {
      const errorMsg = stderr || `CLI exited with code ${code}`;
      log12.error("backtest CLI failed", { backtestId, code });
      repo.updateRunStatus(backtestId, "failed", errorMsg.slice(0, 1e3));
    }
  });
  child.on("error", (err) => {
    log12.error("backtest CLI spawn error", { backtestId, error: err.message });
    repo.updateRunStatus(backtestId, "failed", err.message);
  });
}
function runBacktestNow(db2) {
  const settings = getSettings();
  if (!settings.watchlist.autoBacktest) {
    log12.debug("auto-backtest disabled, skipping");
    return;
  }
  const watchlistRepo = new WatchlistRepo(db2);
  const enabledSymbols = watchlistRepo.list().filter((w) => w.enabled).map((w) => w.symbol);
  if (enabledSymbols.length === 0) {
    log12.debug("no enabled symbols, skipping auto-backtest");
    return;
  }
  const fingerprint = enabledSymbols.sort().join(",");
  if (runningBacktests.has(fingerprint)) {
    log12.debug("auto-backtest already running for this watchlist");
    return;
  }
  const months = settings.watchlist.autoBacktestMonths || 12;
  const endDate = /* @__PURE__ */ new Date();
  const startDate = /* @__PURE__ */ new Date();
  startDate.setMonth(startDate.getMonth() - months);
  const formatDate = (d) => d.toISOString().slice(0, 10);
  const allSymbols = enabledSymbols.includes("SPY") ? enabledSymbols : [...enabledSymbols, "SPY"];
  const backtestRepo = new BacktestRepo(db2);
  const backtestId = backtestRepo.createRun({
    name: `Auto: Watchlist (${allSymbols.length - 1} symbols)`,
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    symbols: allSymbols,
    settingsSnapshot: JSON.stringify({ autoBacktest: true })
  });
  log12.info("queued auto-backtest", {
    backtestId,
    symbols: allSymbols.length,
    months,
    startDate: formatDate(startDate),
    endDate: formatDate(endDate)
  });
  runningBacktests.add(fingerprint);
  spawnBacktestCli(backtestId, {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
    symbols: allSymbols
  }, backtestRepo);
  setTimeout(() => {
    runningBacktests.delete(fingerprint);
  }, 60 * 60 * 1e3);
}

// src/routes/watchlist.ts
function getRepo() {
  return new WatchlistRepo(getDatabase());
}
function getCategoriesRepo() {
  return new SymbolCategoriesRepo(getDatabase());
}
function getPlansRepo() {
  return new StrategicPlansRepo(getDatabase());
}
function bodyOf(req) {
  const body = req.body;
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return body;
}
async function validateSymbolHandler(req, res, next) {
  try {
    const { symbol } = bodyOf(req);
    const data = await validateSymbol(symbol);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}
function listWatchlistHandler(_req, res, next) {
  try {
    res.json({ ok: true, data: getRepo().list() });
  } catch (err) {
    next(err);
  }
}
function listEnhancedWatchlistHandler(_req, res, next) {
  try {
    const watchlist = getRepo().list();
    const symbols = watchlist.map((w) => w.symbol);
    const categories = getCategoriesRepo().getBySymbols(symbols);
    const categoryMap = new Map(categories.map((c) => [c.symbol, c]));
    const plansRepo = getPlansRepo();
    const activePlans = plansRepo.listActive();
    const pausedPlans = plansRepo.listPaused();
    const planMap = new Map(
      [...activePlans, ...pausedPlans].map((p) => [
        p.symbol,
        { status: p.status, progress: `${p.tranchesExecuted}/${p.trancheCount}` }
      ])
    );
    const enhanced = watchlist.map((w) => {
      const cat = categoryMap.get(w.symbol);
      const plan = planMap.get(w.symbol);
      return {
        ...w,
        category: cat?.category ?? null,
        yieldPercent: cat?.yieldPercent ?? null,
        dividendGrowthPercent: cat?.dividendGrowthPercent ?? null,
        estCagrPercent: cat?.estCagrPercent ?? null,
        lastScreenedAt: cat?.lastScreenedAt ?? null,
        planStatus: plan ? `Plan: ${plan.progress}` : "Watching"
      };
    });
    res.json({ ok: true, data: enhanced });
  } catch (err) {
    next(err);
  }
}
async function addWatchlistHandler(req, res, next) {
  try {
    const body = bodyOf(req);
    const note = typeof body.note === "string" && body.note.trim().length > 0 ? body.note.trim() : null;
    const validated = await validateSymbol(body.symbol);
    const row = getRepo().addSymbol(validated.symbol, note);
    res.status(201).json({
      ok: true,
      data: {
        ...row,
        name: validated.name,
        price: validated.price,
        currency: validated.currency
      }
    });
    queueWatchlistBacktest(getDatabase());
  } catch (err) {
    next(err);
  }
}
function removeWatchlistHandler(req, res, next) {
  try {
    const symbol = normalizeSymbol2(req.params.symbol);
    if (!getRepo().removeSymbol(symbol)) {
      throw new NotFoundError(`"${symbol}" is not on the watchlist`);
    }
    res.json({ ok: true, data: { symbol } });
    queueWatchlistBacktest(getDatabase());
  } catch (err) {
    next(err);
  }
}
function patchWatchlistHandler(req, res, next) {
  try {
    const symbol = normalizeSymbol2(req.params.symbol);
    const { enabled } = bodyOf(req);
    if (typeof enabled !== "boolean") {
      throw new ValidationError('Field "enabled" must be a boolean');
    }
    const repo = getRepo();
    const found = enabled ? repo.enableSymbol(symbol) : repo.disableSymbol(symbol);
    if (!found) {
      throw new NotFoundError(`"${symbol}" is not on the watchlist`);
    }
    res.json({ ok: true, data: repo.get(symbol) });
    queueWatchlistBacktest(getDatabase());
  } catch (err) {
    next(err);
  }
}

// src/scheduler/index.ts
import { Cron } from "croner";
init_logger();
import { getLlmLimits as getLlmLimits3 } from "@atn-trd/shared";

// src/scheduler/jobs/snapshot.ts
init_logger();

// src/scheduler/marketCalendar.ts
function toETDateStr(d) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
function etHourMinute(d) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(d);
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return [h, m];
}
function etWeekday(d) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short"
  }).format(d);
  return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[day] ?? 0;
}
function buildETDate(dateStr, hour, minute) {
  for (const offset of ["-04:00", "-05:00"]) {
    const candidate = /* @__PURE__ */ new Date(
      `${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${offset}`
    );
    const [h, m] = etHourMinute(candidate);
    if (h === hour && m === minute) return candidate;
  }
  throw new Error(`Cannot build ET time ${hour}:${minute} for ${dateStr}`);
}
var NYSE_HOLIDAYS = /* @__PURE__ */ new Set([
  // 2024
  "2024-01-01",
  // New Year's Day
  "2024-01-15",
  // MLK Day
  "2024-02-19",
  // Presidents' Day
  "2024-03-29",
  // Good Friday
  "2024-05-27",
  // Memorial Day
  "2024-06-19",
  // Juneteenth
  "2024-07-04",
  // Independence Day
  "2024-09-02",
  // Labor Day
  "2024-11-28",
  // Thanksgiving
  "2024-12-25",
  // Christmas
  // 2025
  "2025-01-01",
  // New Year's Day
  "2025-01-09",
  // National Day of Mourning (Jimmy Carter)
  "2025-01-20",
  // MLK Day
  "2025-02-17",
  // Presidents' Day
  "2025-04-18",
  // Good Friday
  "2025-05-26",
  // Memorial Day
  "2025-06-19",
  // Juneteenth
  "2025-07-04",
  // Independence Day
  "2025-09-01",
  // Labor Day
  "2025-11-27",
  // Thanksgiving
  "2025-12-25",
  // Christmas
  // 2026
  "2026-01-01",
  // New Year's Day
  "2026-01-19",
  // MLK Day
  "2026-02-16",
  // Presidents' Day
  "2026-04-03",
  // Good Friday
  "2026-05-25",
  // Memorial Day
  "2026-06-19",
  // Juneteenth
  "2026-07-03",
  // Independence Day (observed; Jul 4 falls on Saturday)
  "2026-09-07",
  // Labor Day
  "2026-11-26",
  // Thanksgiving
  "2026-12-25",
  // Christmas
  // 2027
  "2027-01-01",
  // New Year's Day
  "2027-01-18",
  // MLK Day
  "2027-02-15",
  // Presidents' Day
  "2027-03-26",
  // Good Friday
  "2027-05-31",
  // Memorial Day
  "2027-06-18",
  // Juneteenth (observed; Jun 19 falls on Saturday)
  "2027-07-05",
  // Independence Day (observed; Jul 4 falls on Sunday)
  "2027-09-06",
  // Labor Day
  "2027-11-25",
  // Thanksgiving
  "2027-12-24",
  // Christmas (observed; Dec 25 falls on Saturday)
  // 2028
  "2027-12-31",
  // New Year's (2028, observed; Jan 1 falls on Saturday)
  "2028-01-17",
  // MLK Day
  "2028-02-21",
  // Presidents' Day
  "2028-04-14",
  // Good Friday
  "2028-05-29",
  // Memorial Day
  "2028-06-19",
  // Juneteenth
  "2028-07-04",
  // Independence Day
  "2028-09-04",
  // Labor Day
  "2028-11-23",
  // Thanksgiving
  "2028-12-25",
  // Christmas
  // 2029
  "2029-01-01",
  // New Year's Day
  "2029-01-15",
  // MLK Day
  "2029-02-19",
  // Presidents' Day
  "2029-03-30",
  // Good Friday
  "2029-05-28",
  // Memorial Day
  "2029-06-19",
  // Juneteenth
  "2029-07-04",
  // Independence Day
  "2029-09-03",
  // Labor Day
  "2029-11-22",
  // Thanksgiving
  "2029-12-25",
  // Christmas
  // 2030
  "2030-01-01",
  // New Year's Day
  "2030-01-21",
  // MLK Day
  "2030-02-18",
  // Presidents' Day
  "2030-04-19",
  // Good Friday
  "2030-05-27",
  // Memorial Day
  "2030-06-19",
  // Juneteenth
  "2030-07-04",
  // Independence Day
  "2030-09-02",
  // Labor Day
  "2030-11-28",
  // Thanksgiving
  "2030-12-25"
  // Christmas
]);
var NYSE_EARLY_CLOSES = /* @__PURE__ */ new Set([
  // 2024
  "2024-07-03",
  // Day before Independence Day
  "2024-11-29",
  // Black Friday
  "2024-12-24",
  // Christmas Eve
  // 2025
  "2025-07-03",
  // Day before Independence Day
  "2025-11-28",
  // Black Friday
  "2025-12-24",
  // Christmas Eve
  // 2026 — Jul 3 is a full holiday, no pre-holiday early close
  "2026-11-27",
  // Black Friday
  "2026-12-24",
  // Christmas Eve
  // 2027 — Jul 5 is observed holiday, no Jul 3 early close
  "2027-11-26",
  // Black Friday
  "2027-12-23",
  // Christmas Eve (Dec 24 is the observed Christmas holiday)
  // 2028
  "2028-07-03",
  // Day before Independence Day
  "2028-11-24",
  // Black Friday
  // 2029
  "2029-07-03",
  // Day before Independence Day
  "2029-11-23",
  // Black Friday
  "2029-12-24",
  // Christmas Eve
  // 2030
  "2030-07-03",
  // Day before Independence Day
  "2030-11-29",
  // Black Friday
  "2030-12-24"
  // Christmas Eve
]);
var OPEN_HOUR = 9;
var OPEN_MIN = 30;
var CLOSE_HOUR = 16;
var CLOSE_MIN = 0;
var EARLY_CLOSE_HOUR = 13;
var EARLY_CLOSE_MIN = 0;
function isTradingDay(date) {
  const dateStr = toETDateStr(date);
  if (NYSE_HOLIDAYS.has(dateStr)) return false;
  const dow = etWeekday(date);
  return dow >= 1 && dow <= 5;
}
function isMarketHours(date) {
  if (!isTradingDay(date)) return false;
  const dateStr = toETDateStr(date);
  const [h, m] = etHourMinute(date);
  const minutesIntoDay = h * 60 + m;
  const openMinutes = OPEN_HOUR * 60 + OPEN_MIN;
  if (minutesIntoDay < openMinutes) return false;
  const [closeH, closeM] = closeHourMin(dateStr);
  const closeMinutes = closeH * 60 + closeM;
  if (minutesIntoDay >= closeMinutes) return false;
  return true;
}
function closeHourMin(dateStr) {
  return NYSE_EARLY_CLOSES.has(dateStr) ? [EARLY_CLOSE_HOUR, EARLY_CLOSE_MIN] : [CLOSE_HOUR, CLOSE_MIN];
}
function nextSessionOpen(date) {
  const dateStr = toETDateStr(date);
  const [h, m] = etHourMinute(date);
  const minutesIntoDay = h * 60 + m;
  const openMinutes = OPEN_HOUR * 60 + OPEN_MIN;
  if (isTradingDay(date) && minutesIntoDay < openMinutes) {
    return buildETDate(dateStr, OPEN_HOUR, OPEN_MIN);
  }
  return buildETDate(nextTradingDateStr(dateStr), OPEN_HOUR, OPEN_MIN);
}
function nextSessionClose(date) {
  const dateStr = toETDateStr(date);
  const [h, m] = etHourMinute(date);
  const minutesIntoDay = h * 60 + m;
  const [closeH, closeM] = closeHourMin(dateStr);
  const closeMinutes = closeH * 60 + closeM;
  if (isTradingDay(date) && minutesIntoDay < closeMinutes) {
    return buildETDate(dateStr, closeH, closeM);
  }
  const nextDate = nextTradingDateStr(dateStr);
  const [nCloseH, nCloseM] = closeHourMin(nextDate);
  return buildETDate(nextDate, nCloseH, nCloseM);
}
function addDay(dateStr) {
  const d = /* @__PURE__ */ new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function nextTradingDateStr(dateStr) {
  let cursor = addDay(dateStr);
  for (let i = 0; i < 10; i++) {
    const probe = /* @__PURE__ */ new Date(cursor + "T12:00:00Z");
    if (isTradingDay(probe)) return cursor;
    cursor = addDay(cursor);
  }
  throw new Error(`No trading day found within 10 days of ${dateStr}`);
}

// src/services/snapshotService.ts
init_logger();
var log13 = logger.child({ component: "snapshot-service" });
var SnapshotServiceImpl = class {
  constructor(priceFeed, portfolioService, portfolioRepo, snapshotsRepo) {
    this.priceFeed = priceFeed;
    this.portfolioService = portfolioService;
    this.portfolioRepo = portfolioRepo;
    this.snapshotsRepo = snapshotsRepo;
  }
  priceFeed;
  portfolioService;
  portfolioRepo;
  snapshotsRepo;
  async captureSnapshot() {
    const portfolio = this.portfolioRepo.read();
    if (!portfolio) {
      log13.info("portfolio not initialized, skipping snapshot");
      return { status: "skipped", reason: "portfolio_not_initialized" };
    }
    const asOfDate = toETDateStr(/* @__PURE__ */ new Date());
    try {
      const portfolioState = await this.portfolioService.getPortfolio();
      const weights = portfolioState.positions.map((pos) => ({
        symbol: pos.symbol,
        weightPercent: pos.weightPercent
      }));
      const portfolioSnapshotId = this.snapshotsRepo.upsertPortfolioSnapshot({
        asOfDate,
        cashCents: portfolioState.cashCents,
        positionsValueCents: portfolioState.positionsValueCents,
        totalValueCents: portfolioState.totalValueCents,
        unrealizedPnlCents: portfolioState.totalUnrealizedPnlCents,
        weightsJson: weights.length > 0 ? JSON.stringify(weights) : "[]"
      });
      const benchmarkSnapshotId = await this.captureBenchmark(asOfDate);
      log13.info("snapshot captured successfully", {
        asOfDate,
        portfolioSnapshotId,
        benchmarkSnapshotId,
        totalValueCents: portfolioState.totalValueCents,
        unrealizedPnlCents: portfolioState.totalUnrealizedPnlCents,
        positionCount: portfolioState.positions.length
      });
      return {
        status: "ok",
        portfolioSnapshotId,
        benchmarkSnapshotId
      };
    } catch (err) {
      log13.error("failed to capture portfolio snapshot", {
        asOfDate,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  }
  /**
   * Capture SPY benchmark price for the given date.
   * Never throws - returns null if SPY fetch fails.
   */
  async captureBenchmark(asOfDate) {
    try {
      const price = await this.priceFeed.getPrice("SPY");
      if (price !== null && price !== void 0) {
        const priceCents = Math.round(price * 100);
        this.snapshotsRepo.upsertBenchmarkSnapshot({
          symbol: "SPY",
          asOfDate,
          closeCents: priceCents,
          adjCloseCents: priceCents
        });
        return asOfDate;
      }
      const bar = await this.priceFeed.getLatestBar("SPY");
      if (bar) {
        this.snapshotsRepo.upsertBenchmarkSnapshot({
          symbol: "SPY",
          asOfDate,
          closeCents: bar.closeCents,
          adjCloseCents: bar.adjCloseCents
        });
        return asOfDate;
      }
      log13.warn("SPY benchmark not available", { asOfDate });
      return null;
    } catch (err) {
      log13.warn("failed to capture SPY benchmark", {
        asOfDate,
        error: err instanceof Error ? err.message : String(err)
      });
      return null;
    }
  }
};

// src/repos/cashFlowsRepo.ts
var CashFlowsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  /**
   * Insert a new cash flow record.
   * @param type - 'deposit' or 'withdrawal'
   * @param amountCents - Amount in cents (always positive)
   * @param occurredAt - Timestamp in milliseconds when the flow occurred
   * @param note - Optional description
   * @returns Flow id
   */
  insertFlow(type, amountCents, occurredAt, note) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db.prepare(
      `INSERT INTO cash_flows (id, type, amount_cents, occurred_at, created_at, note)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, type, amountCents, occurredAt, createdAt, note || null);
    return id;
  }
  /**
   * Sum cash flows by type, optionally filtered by date.
   * @param type - 'deposit' or 'withdrawal'
   * @param asOfDate - Optional YYYY-MM-DD string to filter by date
   * @returns Sum in cents
   */
  sumByType(type, asOfDate) {
    let query = "SELECT COALESCE(SUM(amount_cents), 0) as total FROM cash_flows WHERE type = ?";
    const params = [type];
    if (asOfDate) {
      const [year, month, day] = asOfDate.split("-").map(Number);
      const startOfDay = new Date(Date.UTC(year, month - 1, day)).getTime();
      const endOfDay = startOfDay + 24 * 60 * 60 * 1e3;
      query += " AND occurred_at >= ? AND occurred_at < ?";
      params.push(startOfDay, endOfDay);
    }
    const result = this.db.prepare(query).get(...params);
    return result.total;
  }
  /**
   * List cash flows ordered by date (most recent first).
   * @param limit - Maximum number of flows to return
   * @returns Array of cash flows
   */
  listFlows(limit = 100) {
    return this.db.prepare(
      `SELECT id, type, amount_cents as amountCents, occurred_at as occurredAt,
                created_at as createdAt, note
         FROM cash_flows ORDER BY occurred_at DESC LIMIT ?`
    ).all(limit);
  }
  /**
   * Delete all cash flows (used when resetting portfolio).
   */
  deleteAll() {
    this.db.prepare("DELETE FROM cash_flows").run();
  }
};

// src/lib/money.ts
function toCents(dollars) {
  return Math.round(dollars * 100);
}
function notionalCents(qty, priceCents) {
  return Math.round(qty * priceCents);
}
var QTY_EPSILON = 1e-7;
function floorQty(qty) {
  return Math.floor(qty * 1e3 + QTY_EPSILON) / 1e3;
}
function ceilQty(qty) {
  return Math.ceil(qty * 1e3 - QTY_EPSILON) / 1e3;
}

// src/services/portfolioService.ts
init_logger();
var log14 = logger.child({ component: "portfolio-service" });
var PortfolioServiceImpl = class {
  constructor(db2, priceFeed, positionsRepo, portfolioRepo) {
    this.db = db2;
    this.priceFeed = priceFeed;
    this.positionsRepo = positionsRepo;
    this.portfolioRepo = portfolioRepo;
    this.cashFlowsRepo = new CashFlowsRepo(db2);
  }
  db;
  priceFeed;
  positionsRepo;
  portfolioRepo;
  cashFlowsRepo;
  async getPortfolio(opts) {
    const portfolio = this.portfolioRepo.read();
    if (!portfolio) {
      throw new Error("Portfolio not initialized");
    }
    const asOfDate = opts?.asOfDate || toETDateStr(/* @__PURE__ */ new Date());
    const isHistorical = !!opts?.asOfDate;
    const positions = this.positionsRepo.list();
    const positionDetails = [];
    let positionsValueCents = 0;
    for (const pos of positions) {
      const currentPriceCents = await this.resolvePriceCents(pos.symbol, pos.avgCostCents, asOfDate, isHistorical);
      const costBasisCents = notionalCents(pos.qty, pos.avgCostCents);
      const marketValueCents = notionalCents(pos.qty, currentPriceCents);
      const unrealizedPnlCents = marketValueCents - costBasisCents;
      positionDetails.push({
        symbol: pos.symbol,
        qty: pos.qty,
        avgCostCents: pos.avgCostCents,
        currentPriceCents,
        costBasisCents,
        marketValueCents,
        weightPercent: 0,
        // Will be computed in second pass
        unrealizedPnlCents,
        realizedPnlCents: pos.realizedPnlCents
      });
      positionsValueCents += marketValueCents;
    }
    const allPositions = this.positionsRepo.listAll();
    let totalRealizedPnlCents = 0;
    for (const pos of allPositions) {
      totalRealizedPnlCents += pos.realizedPnlCents;
    }
    const totalValueCents = portfolio.cashCents + positionsValueCents;
    for (const detail of positionDetails) {
      detail.weightPercent = totalValueCents > 0 ? detail.marketValueCents / totalValueCents * 100 : 0;
    }
    const totalUnrealizedPnlCents = positionDetails.reduce((sum2, d) => sum2 + d.unrealizedPnlCents, 0);
    const totalPnlCents = totalUnrealizedPnlCents + totalRealizedPnlCents;
    const totalReturnPercent = portfolio.startingCashCents > 0 ? totalPnlCents / portfolio.startingCashCents * 100 : 0;
    return {
      asOfDate,
      cashCents: portfolio.cashCents,
      positionsValueCents,
      totalValueCents,
      totalUnrealizedPnlCents,
      totalRealizedPnlCents,
      totalPnlCents,
      totalReturnPercent,
      positions: positionDetails
    };
  }
  async resetPaperAccount() {
    const portfolio = this.portfolioRepo.read();
    if (!portfolio) {
      throw new Error("Portfolio not initialized");
    }
    this.db.transaction(() => {
      this.positionsRepo.clear();
      this.portfolioRepo.write({
        cashCents: portfolio.startingCashCents,
        startingCashCents: portfolio.startingCashCents,
        startedAt: portfolio.startedAt,
        resetAt: Date.now(),
        baseCurrency: portfolio.baseCurrency
      });
    })();
  }
  /**
   * Get the cost base (sum of deposits minus sum of withdrawals).
   * Used for performance calculation.
   * Falls back to starting_cash_cents for backward compatibility with old portfolios.
   * @param asOfDate - Optional historical date (YYYY-MM-DD)
   * @returns Cost base in cents
   */
  getCostBase(asOfDate) {
    const deposits = this.cashFlowsRepo.sumByType("deposit", asOfDate);
    const withdrawals = this.cashFlowsRepo.sumByType("withdrawal", asOfDate);
    const costBase = Math.max(0, deposits - withdrawals);
    if (costBase === 0 && deposits === 0 && withdrawals === 0) {
      const portfolio = this.portfolioRepo.read();
      if (portfolio) {
        return portfolio.startingCashCents;
      }
    }
    return costBase;
  }
  /**
   * Resolve current price for a symbol, handling live vs historical modes.
   * Live mode: getPrice -> getLatestBar -> avgCostCents (with warning)
   * Historical mode: getBar -> avgCostCents (with warning)
   */
  async resolvePriceCents(symbol, avgCostCents, asOfDate, isHistorical) {
    if (isHistorical) {
      const bar2 = await this.priceFeed.getBar(symbol, asOfDate);
      if (bar2) {
        return bar2.closeCents;
      }
      log14.warn("historical price not found, using average cost", { symbol, asOfDate });
      return avgCostCents;
    }
    const price = await this.priceFeed.getPrice(symbol);
    if (price !== null && price !== void 0) {
      const priceCents = Math.round(price * 100);
      return priceCents;
    }
    const bar = await this.priceFeed.getLatestBar(symbol);
    if (bar) {
      return bar.closeCents;
    }
    log14.warn("live price not found, using average cost", { symbol });
    return avgCostCents;
  }
};

// src/datasources/prices/finnhubPrices.ts
init_http();
init_errors();
init_logger();
var FINNHUB_PRICES_SOURCE = "finnhub-prices";
var FINNHUB_API_KEY_SECRET3 = "FINNHUB_API_KEY";
var FINNHUB_BASE_URL3 = "https://finnhub.io/api/v1/";
var FinnhubPricesDataSource = class extends BaseDataSource {
  name = FINNHUB_PRICES_SOURCE;
  kind = "prices";
  provider = "finnhub";
  http;
  resolveKey;
  log = logger.child({ component: "datasource", source: FINNHUB_PRICES_SOURCE });
  constructor(options = {}) {
    super();
    this.resolveKey = options.resolveKey ?? apiKeyResolver(FINNHUB_API_KEY_SECRET3);
    this.http = options.http ?? new HttpClient({
      name: FINNHUB_PRICES_SOURCE,
      baseUrl: FINNHUB_BASE_URL3,
      defaultHeaders: { accept: "application/json" },
      // Finnhub free tier: 60 req/min → 1/s sustained; allow small burst.
      rateLimit: { capacity: 10, refillPerSecond: 1 },
      retry: { retries: 2, baseDelayMs: 300, maxDelayMs: 3e3 }
    });
  }
  isConfigured() {
    return !!this.resolveKey();
  }
  notConfiguredReason() {
    return `Missing ${FINNHUB_API_KEY_SECRET3}`;
  }
  async fetch(request) {
    const key = this.resolveKey();
    if (!key) throw new DataSourceNotConfiguredError(this.name, this.notConfiguredReason());
    const symbol = request.symbol.trim().toUpperCase();
    const path8 = `quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
    let raw;
    try {
      raw = await this.http.json(path8);
    } catch (err) {
      this.log.warn("quote request failed", {
        symbol,
        error: err instanceof Error ? err.message : String(err)
      });
      throw new UpstreamError(`Could not reach Finnhub to price "${symbol}"`, FINNHUB_PRICES_SOURCE);
    }
    if (typeof raw.c !== "number" || raw.c === 0) {
      throw new SymbolNotFoundError(symbol);
    }
    return {
      symbol,
      name: symbol,
      price: raw.c,
      currency: "USD",
      timestamp: typeof raw.t === "number" ? raw.t * 1e3 : Date.now(),
      exchange: null,
      marketState: null
    };
  }
  async probe() {
    await this.fetch({ symbol: "AAPL" });
  }
};

// src/services/priceService.ts
init_logger();
var log15 = logger.child({ component: "price-service" });
var PriceService = class {
  pricesRepo;
  finnhub;
  cache = /* @__PURE__ */ new Map();
  cacheMaxAgeMs = 1e3 * 60 * 60;
  // 1 hour
  constructor(pricesRepo) {
    this.pricesRepo = pricesRepo;
    this.finnhub = new FinnhubPricesDataSource();
  }
  /**
   * Get current price for a symbol.
   * Checks cache first, then fetches from Finnhub if cache miss or stale.
   */
  async getPrice(symbol) {
    const normalized = normalizeSymbol(symbol);
    const cached2 = this.cache.get(normalized);
    if (cached2 && Date.now() - cached2.timestamp < this.cacheMaxAgeMs) {
      return cached2.priceCents / 100;
    }
    let price = null;
    if (this.finnhub.isConfigured()) {
      try {
        const quote = await this.finnhub.fetch({ symbol: normalized });
        price = quote.price;
      } catch (err) {
        log15.debug("finnhub price fetch failed", { symbol: normalized, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      log15.warn("finnhub not configured, using cached price", { symbol: normalized });
    }
    if (price === null) return this.getLatestCachedPrice(normalized);
    const priceCents = Math.round(price * 100);
    this.cache.set(normalized, {
      symbol: normalized,
      priceCents,
      adjCloseCents: priceCents,
      timestamp: Date.now()
    });
    return priceCents / 100;
  }
  /**
   * Batch fetch prices for multiple symbols and date range.
   * Returns historical prices from price_bars cache.
   */
  async getPrices(symbols, fromDate, toDate) {
    const result = /* @__PURE__ */ new Map();
    for (const symbol of symbols) {
      const normalized = normalizeSymbol(symbol);
      const bars = this.pricesRepo.listByDateRange(normalized, fromDate, toDate);
      result.set(normalized, bars.map((bar) => ({
        barDate: bar.barDate,
        openCents: bar.openCents,
        highCents: bar.highCents,
        lowCents: bar.lowCents,
        closeCents: bar.closeCents,
        adjCloseCents: bar.adjCloseCents,
        volume: bar.volume
      })));
    }
    return result;
  }
  /**
   * Persist current price to price_bars table for historical tracking.
   * Called after each successful quote fetch to build historical record.
   */
  async recordPrice(symbol, price, date) {
    const normalized = normalizeSymbol(symbol);
    const priceCents = Math.round(price * 100);
    this.pricesRepo.upsert({
      symbol: normalized,
      barDate: date,
      openCents: priceCents,
      highCents: priceCents,
      lowCents: priceCents,
      closeCents: priceCents,
      adjCloseCents: priceCents,
      // TODO: adjust for splits/dividends
      volume: null,
      provider: "finnhub",
      fetchedAt: Date.now()
    });
    log15.debug("price recorded", { symbol: normalized, date, priceCents });
  }
  /**
   * Get the latest price from the price_bars cache when live fetch fails.
   */
  getLatestCachedPrice(symbol) {
    const bar = this.pricesRepo.getLatest(symbol);
    return bar ? bar.adjCloseCents / 100 : null;
  }
  /**
   * Clear stale cache entries (older than max age).
   * Called periodically to prevent unbounded cache growth.
   */
  clearStaleCache() {
    const now = Date.now();
    let cleared = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.cacheMaxAgeMs) {
        this.cache.delete(key);
        cleared++;
      }
    }
    if (cleared > 0) {
      log15.debug("cleared stale cache entries", { count: cleared });
    }
  }
  /**
   * Warm cache by fetching current quotes for symbols.
   * Used at startup or before trading cycles.
   */
  async warmCache(symbols) {
    log15.debug("warming price cache", { count: symbols.length });
    const normalized = symbols.map(normalizeSymbol);
    const results = await Promise.allSettled(normalized.map((s) => this.getPrice(s)));
    const successful = results.filter((r) => r.status === "fulfilled").length;
    log15.debug("price cache warmed", { count: successful, total: results.length });
  }
  /**
   * Get the latest bar for a symbol (used by PaperBroker for fills).
   */
  async getLatestBar(symbol) {
    const normalized = normalizeSymbol(symbol);
    const bar = this.pricesRepo.getLatest(normalized);
    if (bar) {
      return {
        barDate: bar.barDate,
        openCents: bar.openCents,
        highCents: bar.highCents,
        lowCents: bar.lowCents,
        closeCents: bar.closeCents,
        adjCloseCents: bar.adjCloseCents,
        volume: bar.volume
      };
    }
    const livePriceDollars = await this.getPrice(symbol);
    if (livePriceDollars === null) {
      log15.debug("latest bar not found", { symbol: normalized });
      return null;
    }
    const priceCents = Math.round(livePriceDollars * 100);
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    log15.debug("latest bar synthesized from live price", { symbol: normalized, priceCents });
    return {
      barDate: today,
      openCents: priceCents,
      highCents: priceCents,
      lowCents: priceCents,
      closeCents: priceCents,
      adjCloseCents: priceCents,
      volume: 0
    };
  }
  /**
   * Get a specific bar by symbol and date (used by PaperBroker for fills).
   */
  async getBar(symbol, date) {
    const normalized = normalizeSymbol(symbol);
    const bar = this.pricesRepo.get(normalized, date);
    if (!bar) {
      log15.debug("bar not found", { symbol: normalized, date });
      return null;
    }
    return {
      barDate: bar.barDate,
      openCents: bar.openCents,
      highCents: bar.highCents,
      lowCents: bar.lowCents,
      closeCents: bar.closeCents,
      adjCloseCents: bar.adjCloseCents,
      volume: bar.volume
    };
  }
};

// src/repos/positionsRepo.ts
var PositionsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  upsert(position) {
    this.db.prepare(
      `INSERT INTO positions (symbol, qty, avg_cost_cents, realized_pnl_cents, opened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET qty = excluded.qty, avg_cost_cents = excluded.avg_cost_cents,
                                            realized_pnl_cents = excluded.realized_pnl_cents, updated_at = excluded.updated_at`
    ).run(position.symbol, position.qty, position.avgCostCents, position.realizedPnlCents, position.openedAt, position.updatedAt);
  }
  get(symbol) {
    return this.db.prepare(
      `SELECT symbol, qty, avg_cost_cents as avgCostCents, realized_pnl_cents as realizedPnlCents, opened_at as openedAt, updated_at as updatedAt
         FROM positions WHERE symbol = ?`
    ).get(symbol);
  }
  list() {
    return this.db.prepare(
      `SELECT symbol, qty, avg_cost_cents as avgCostCents, realized_pnl_cents as realizedPnlCents, opened_at as openedAt, updated_at as updatedAt
         FROM positions WHERE qty != 0 ORDER BY symbol`
    ).all();
  }
  listAll() {
    return this.db.prepare(
      `SELECT symbol, qty, avg_cost_cents as avgCostCents, realized_pnl_cents as realizedPnlCents, opened_at as openedAt, updated_at as updatedAt
         FROM positions ORDER BY symbol`
    ).all();
  }
  remove(symbol) {
    this.db.prepare("DELETE FROM positions WHERE symbol = ?").run(symbol);
  }
  clear() {
    this.db.prepare("DELETE FROM positions").run();
  }
  getTotalQtyCost() {
    const result = this.db.prepare("SELECT SUM(qty) as totalQty, SUM(qty * avg_cost_cents / 100) as totalCostCents FROM positions WHERE qty > 0").get();
    return {
      totalQty: result.totalQty || 0,
      totalCostCents: Math.round((result.totalCostCents || 0) * 100)
    };
  }
};

// src/repos/portfolioRepo.ts
var PortfolioRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  read() {
    return this.db.prepare(
      `SELECT cash_cents as cashCents, starting_cash_cents as startingCashCents,
                started_at as startedAt, reset_at as resetAt, base_currency as baseCurrency
         FROM portfolio WHERE id = 1`
    ).get();
  }
  write(row) {
    this.db.prepare(
      `INSERT INTO portfolio (id, cash_cents, starting_cash_cents, started_at, reset_at, base_currency)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           cash_cents = excluded.cash_cents,
           starting_cash_cents = excluded.starting_cash_cents,
           started_at = excluded.started_at,
           reset_at = excluded.reset_at,
           base_currency = excluded.base_currency`
    ).run(row.cashCents, row.startingCashCents, row.startedAt, row.resetAt, row.baseCurrency);
  }
};

// src/repos/pricesRepo.ts
var PricesRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  upsert(bar) {
    this.db.prepare(
      `INSERT INTO price_bars (symbol, bar_date, open_cents, high_cents, low_cents, close_cents, adj_close_cents, volume, provider, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol, bar_date) DO UPDATE SET open_cents = excluded.open_cents, high_cents = excluded.high_cents,
                                                       low_cents = excluded.low_cents, close_cents = excluded.close_cents,
                                                       adj_close_cents = excluded.adj_close_cents, volume = excluded.volume,
                                                       provider = excluded.provider, fetched_at = excluded.fetched_at`
    ).run(
      bar.symbol,
      bar.barDate,
      bar.openCents,
      bar.highCents,
      bar.lowCents,
      bar.closeCents,
      bar.adjCloseCents,
      bar.volume,
      bar.provider,
      bar.fetchedAt
    );
  }
  get(symbol, barDate) {
    return this.db.prepare(
      `SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? AND bar_date = ?`
    ).get(symbol, barDate);
  }
  listBySymbol(symbol, limit = 252) {
    return this.db.prepare(
      `SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? ORDER BY bar_date DESC LIMIT ?`
    ).all(symbol, limit);
  }
  listByDateRange(symbol, fromDate, toDate) {
    return this.db.prepare(
      `SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? AND bar_date >= ? AND bar_date <= ? ORDER BY bar_date ASC`
    ).all(symbol, fromDate, toDate);
  }
  getLatest(symbol) {
    return this.db.prepare(
      `SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? ORDER BY bar_date DESC LIMIT 1`
    ).get(symbol);
  }
  deleteOlderThan(barDate) {
    const info = this.db.prepare("DELETE FROM price_bars WHERE bar_date < ?").run(barDate);
    return info.changes;
  }
};

// src/repos/snapshotsRepo.ts
var SnapshotsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  // Portfolio snapshots
  upsertPortfolioSnapshot(snapshot) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db.prepare(
      `INSERT INTO portfolio_snapshots (id, as_of_date, cash_cents, positions_value_cents, total_value_cents, unrealized_pnl_cents, weights_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(as_of_date) DO UPDATE SET
           cash_cents = excluded.cash_cents,
           positions_value_cents = excluded.positions_value_cents,
           total_value_cents = excluded.total_value_cents,
           unrealized_pnl_cents = excluded.unrealized_pnl_cents,
           weights_json = excluded.weights_json`
    ).run(
      id,
      snapshot.asOfDate,
      snapshot.cashCents,
      snapshot.positionsValueCents,
      snapshot.totalValueCents,
      snapshot.unrealizedPnlCents,
      snapshot.weightsJson,
      createdAt
    );
    return id;
  }
  getPortfolioSnapshot(asOfDate) {
    return this.db.prepare(
      `SELECT id, as_of_date as asOfDate, cash_cents as cashCents, positions_value_cents as positionsValueCents,
                total_value_cents as totalValueCents, unrealized_pnl_cents as unrealizedPnlCents, weights_json as weightsJson, created_at as createdAt
         FROM portfolio_snapshots WHERE as_of_date = ?`
    ).get(asOfDate);
  }
  listPortfolioSnapshots(limit = 252) {
    return this.db.prepare(
      `SELECT id, as_of_date as asOfDate, cash_cents as cashCents, positions_value_cents as positionsValueCents,
                total_value_cents as totalValueCents, unrealized_pnl_cents as unrealizedPnlCents, weights_json as weightsJson, created_at as createdAt
         FROM portfolio_snapshots ORDER BY as_of_date DESC LIMIT ?`
    ).all(limit);
  }
  listPortfolioSnapshotsByDateRange(fromDate, toDate) {
    return this.db.prepare(
      `SELECT id, as_of_date as asOfDate, cash_cents as cashCents, positions_value_cents as positionsValueCents,
                total_value_cents as totalValueCents, unrealized_pnl_cents as unrealizedPnlCents, weights_json as weightsJson, created_at as createdAt
         FROM portfolio_snapshots WHERE as_of_date >= ? AND as_of_date <= ? ORDER BY as_of_date ASC`
    ).all(fromDate, toDate);
  }
  // Benchmark snapshots
  upsertBenchmarkSnapshot(snapshot) {
    this.db.prepare(
      `INSERT INTO benchmark_snapshots (symbol, as_of_date, close_cents, adj_close_cents)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(symbol, as_of_date) DO UPDATE SET close_cents = excluded.close_cents, adj_close_cents = excluded.adj_close_cents`
    ).run(snapshot.symbol, snapshot.asOfDate, snapshot.closeCents, snapshot.adjCloseCents);
  }
  getBenchmarkSnapshot(symbol, asOfDate) {
    return this.db.prepare(
      `SELECT symbol, as_of_date as asOfDate, close_cents as closeCents, adj_close_cents as adjCloseCents
         FROM benchmark_snapshots WHERE symbol = ? AND as_of_date = ?`
    ).get(symbol, asOfDate);
  }
  listBenchmarkSnapshots(symbol, limit = 252) {
    return this.db.prepare(
      `SELECT symbol, as_of_date as asOfDate, close_cents as closeCents, adj_close_cents as adjCloseCents
         FROM benchmark_snapshots WHERE symbol = ? ORDER BY as_of_date DESC LIMIT ?`
    ).all(symbol, limit);
  }
  listBenchmarkSnapshotsByDateRange(symbol, fromDate, toDate) {
    return this.db.prepare(
      `SELECT symbol, as_of_date as asOfDate, close_cents as closeCents, adj_close_cents as adjCloseCents
         FROM benchmark_snapshots WHERE symbol = ? AND as_of_date >= ? AND as_of_date <= ? ORDER BY as_of_date ASC`
    ).all(symbol, fromDate, toDate);
  }
  deleteOldBenchmarkSnapshots(symbol, beforeDate) {
    const info = this.db.prepare("DELETE FROM benchmark_snapshots WHERE symbol = ? AND as_of_date < ?").run(symbol, beforeDate);
    return info.changes;
  }
};

// src/repos/calibrationRepo.ts
var CalibrationRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(row) {
    const result = this.db.prepare(`
      INSERT INTO confidence_calibration (run_id, symbol, predicted_direction, confidence, actual_return_5d, actual_return_20d, correct_direction, created_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)
    `).run(row.runId, row.symbol, row.predictedDirection, row.confidence, Date.now());
    return Number(result.lastInsertRowid);
  }
  updateActuals(id, actualReturn5d, actualReturn20d, correctDirection) {
    this.db.prepare(`
      UPDATE confidence_calibration
      SET actual_return_5d = ?, actual_return_20d = ?, correct_direction = ?
      WHERE id = ?
    `).run(actualReturn5d, actualReturn20d, correctDirection, id);
  }
  listPendingActuals() {
    return this.db.prepare(`
      SELECT id, run_id as runId, symbol, predicted_direction as predictedDirection,
             confidence, actual_return_5d as actualReturn5d, actual_return_20d as actualReturn20d,
             correct_direction as correctDirection, created_at as createdAt
      FROM confidence_calibration
      WHERE actual_return_5d IS NULL
      ORDER BY created_at ASC
    `).all();
  }
  countPending() {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM confidence_calibration WHERE actual_return_5d IS NULL`).get();
    return row.count;
  }
  getCalibrationReport() {
    return this.db.prepare(`
      SELECT
        CASE
          WHEN confidence >= 0.9 THEN '0.9-1.0'
          WHEN confidence >= 0.8 THEN '0.8-0.9'
          WHEN confidence >= 0.7 THEN '0.7-0.8'
          WHEN confidence >= 0.6 THEN '0.6-0.7'
          ELSE '0.5-0.6'
        END as band,
        COUNT(*) as count,
        SUM(CASE WHEN correct_direction = 1 THEN 1 ELSE 0 END) as correctCount,
        AVG(actual_return_5d) as avgReturn5d,
        AVG(actual_return_20d) as avgReturn20d
      FROM confidence_calibration
      WHERE actual_return_5d IS NOT NULL
      GROUP BY band
      ORDER BY band DESC
    `).all();
  }
};

// src/repos/runsRepo.ts
var RunsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(run) {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO agent_runs (id, trigger, status, started_at, finished_at, model, settings_snapshot, error, token_usage_json, skip_reason, summary_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      run.trigger,
      run.status,
      run.startedAt,
      run.finishedAt,
      run.model,
      run.settingsSnapshot,
      run.error,
      run.tokenUsageJson,
      run.skipReason,
      run.summaryJson
    );
    return id;
  }
  get(id) {
    return this.db.prepare(
      `SELECT id, trigger, status, started_at as startedAt, finished_at as finishedAt,
                model, settings_snapshot as settingsSnapshot, error, token_usage_json as tokenUsageJson,
                skip_reason as skipReason, summary_json as summaryJson
         FROM agent_runs WHERE id = ?`
    ).get(id);
  }
  list(limit = 50, offset = 0) {
    return this.db.prepare(
      `SELECT id, trigger, status, started_at as startedAt, finished_at as finishedAt,
                model, settings_snapshot as settingsSnapshot, error, token_usage_json as tokenUsageJson,
                skip_reason as skipReason, summary_json as summaryJson
         FROM agent_runs ORDER BY started_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
  }
  listByTrigger(trigger, limit = 50) {
    return this.db.prepare(
      `SELECT id, trigger, status, started_at as startedAt, finished_at as finishedAt,
                model, settings_snapshot as settingsSnapshot, error, token_usage_json as tokenUsageJson,
                skip_reason as skipReason, summary_json as summaryJson
         FROM agent_runs WHERE trigger = ? ORDER BY started_at DESC LIMIT ?`
    ).all(trigger, limit);
  }
  updateStatus(id, status, error) {
    this.db.prepare(
      `UPDATE agent_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?`
    ).run(status, status === "running" ? null : Date.now(), error || null, id);
  }
  setSkipped(id, reason) {
    this.db.prepare(
      `UPDATE agent_runs SET status = ?, finished_at = ?, skip_reason = ? WHERE id = ?`
    ).run("skipped", Date.now(), reason, id);
  }
  updateTokenUsage(id, tokenUsageJson) {
    this.db.prepare(
      `UPDATE agent_runs SET token_usage_json = ? WHERE id = ?`
    ).run(tokenUsageJson, id);
  }
  updateSummary(id, summaryJson) {
    this.db.prepare(
      `UPDATE agent_runs SET summary_json = ? WHERE id = ?`
    ).run(summaryJson, id);
  }
};

// src/brokers/alpacaBroker.ts
init_logger();
import { Alpaca } from "@alpacahq/alpaca-trade-api";
var log16 = logger.child({ component: "alpaca-broker" });
var AlpacaBroker = class {
  id = "alpaca";
  supportsFractionalShares = true;
  client;
  constructor(config) {
    if (config.testClient) {
      this.client = config.testClient;
    } else {
      this.client = new Alpaca({
        keyId: config.apiKey,
        secret: config.apiSecret,
        ...config.paperTrading && { baseUrl: "https://paper-api.alpaca.markets" }
      });
    }
  }
  async getAccount() {
    const account = await this.client.trading.account.getAccount();
    const cash = typeof account.cash === "string" ? parseFloat(account.cash) : account.cash || 0;
    const portfolioValue = typeof account.portfolio_value === "string" ? parseFloat(account.portfolio_value) : account.portfolio_value || 0;
    const buyingPower = typeof account.buying_power === "string" ? parseFloat(account.buying_power) : account.buying_power || 0;
    const cashCents = Math.round(cash * 100);
    const equityCents = Math.round(portfolioValue * 100) - cashCents;
    const buyingPowerCents = Math.round(buyingPower * 100);
    return {
      cashCents,
      equityCents,
      buyingPowerCents
    };
  }
  async getPositions() {
    const positions = await this.client.trading.positions.getAllOpenPositions();
    return positions.filter((pos) => parseFloat(String(pos.qty)) !== 0).map((pos) => {
      const avgEntryPrice = typeof pos.avgEntryPrice === "string" ? parseFloat(pos.avgEntryPrice) : pos.avgEntryPrice ?? 0;
      return {
        symbol: pos.symbol,
        qty: parseFloat(String(pos.qty)),
        avgCostCents: Math.round(avgEntryPrice * 100)
      };
    });
  }
  async submitOrder(req) {
    try {
      const orderParams = {
        symbol: req.symbol,
        qty: req.qty,
        side: req.side,
        type: req.type,
        timeInForce: req.tif,
        clientOrderId: req.clientOrderId
      };
      if (req.type === "limit" && req.limitPriceCents) {
        orderParams.limitPrice = req.limitPriceCents / 100;
      }
      const response = await this.client.trading.orders.submit(orderParams);
      log16.debug("order submitted to Alpaca", {
        orderId: response.id,
        clientOrderId: response.client_order_id,
        symbol: req.symbol
      });
      return this.mapAlpacaOrderToState(response);
    } catch (err) {
      log16.error("failed to submit order to Alpaca", {
        clientOrderId: req.clientOrderId,
        symbol: req.symbol,
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && "status" in err ? err.status : void 0
      });
      throw err;
    }
  }
  async getOrder(orderId) {
    try {
      const response = await this.client.trading.orders.getOrderByOrderID({ orderId });
      return this.mapAlpacaOrderToState(response);
    } catch (err) {
      log16.warn("failed to fetch order from Alpaca", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && "status" in err ? err.status : void 0
      });
      return null;
    }
  }
  async listOrders(f) {
    try {
      let alpacaStatus = "all";
      if (f.status && f.status.length > 0) {
        const hasOpen = f.status.some((s) => ["pending", "accepted", "partially_filled"].includes(s));
        const hasClosed = f.status.some((s) => ["filled", "canceled", "expired", "rejected"].includes(s));
        if (hasOpen && !hasClosed) {
          alpacaStatus = "open";
        } else if (!hasOpen && hasClosed) {
          alpacaStatus = "closed";
        } else {
          alpacaStatus = "all";
        }
      }
      const orderParams = {
        status: alpacaStatus,
        limit: 100
        // Default limit
      };
      if (f.since) {
        const date = new Date(f.since).toISOString().split("T")[0];
        orderParams.after = date;
      }
      const responses = await this.client.trading.orders.getAllOrders(orderParams);
      return responses.map((r) => this.mapAlpacaOrderToState(r));
    } catch (err) {
      log16.warn("failed to list orders from Alpaca", {
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && "status" in err ? err.status : void 0
      });
      return [];
    }
  }
  async cancelOrder(orderId) {
    try {
      await this.client.trading.orders.deleteOrderByOrderID({ orderId });
      log16.debug("order cancelled on Alpaca", { orderId });
    } catch (err) {
      log16.error("failed to cancel order on Alpaca", {
        orderId,
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && "status" in err ? err.status : void 0
      });
      throw err;
    }
  }
  async getClock() {
    try {
      const clock = await this.client.trading.clock.clock();
      const clockData = clock;
      const nextOpen = clockData.next_open instanceof Date ? clockData.next_open.getTime() : new Date(clockData.next_open).getTime();
      const nextClose = clockData.next_close instanceof Date ? clockData.next_close.getTime() : new Date(clockData.next_close).getTime();
      return {
        isOpen: clockData.is_open,
        nextOpen,
        nextClose
      };
    } catch (err) {
      log16.error("failed to fetch market clock from Alpaca", {
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof Error && "status" in err ? err.status : void 0
      });
      throw err;
    }
  }
  mapAlpacaOrderToState(alpacaOrder) {
    const status = this.mapAlpacaOrderStatus(alpacaOrder.status);
    const qty = typeof alpacaOrder.qty === "string" ? parseFloat(alpacaOrder.qty) : alpacaOrder.qty ?? 0;
    const limitPrice = alpacaOrder.limit_price ? typeof alpacaOrder.limit_price === "string" ? parseFloat(alpacaOrder.limit_price) : alpacaOrder.limit_price : null;
    const filledAvgPrice = alpacaOrder.filled_avg_price ? typeof alpacaOrder.filled_avg_price === "string" ? parseFloat(alpacaOrder.filled_avg_price) : alpacaOrder.filled_avg_price : null;
    const createdAt = alpacaOrder.created_at instanceof Date ? alpacaOrder.created_at.getTime() : new Date(alpacaOrder.created_at).getTime();
    const updatedAt = alpacaOrder.updated_at instanceof Date ? alpacaOrder.updated_at.getTime() : new Date(alpacaOrder.updated_at).getTime();
    return {
      id: alpacaOrder.id,
      clientOrderId: alpacaOrder.client_order_id ?? "",
      symbol: alpacaOrder.symbol,
      side: alpacaOrder.side,
      qty,
      type: alpacaOrder.type,
      limitPriceCents: limitPrice ? Math.round(limitPrice * 100) : null,
      fillPriceCents: filledAvgPrice ? Math.round(filledAvgPrice * 100) : null,
      tif: alpacaOrder.time_in_force,
      status,
      rejectReason: null,
      // Alpaca doesn't provide reject reasons in this format
      submittedAt: createdAt,
      updatedAt
    };
  }
  mapAlpacaOrderStatus(alpacaStatus) {
    switch (alpacaStatus.toLowerCase()) {
      case "new":
      case "pending_new":
        return "pending";
      case "accepted":
      case "pending_cancel":
        return "accepted";
      case "partially_filled":
        return "partially_filled";
      case "filled":
        return "filled";
      case "done_for_day":
      case "canceled":
        return "canceled";
      case "expired":
        return "expired";
      case "rejected":
      case "suspended":
        return "rejected";
      default:
        log16.warn("unknown Alpaca order status", { status: alpacaStatus });
        return "pending";
    }
  }
};

// src/scheduler/jobs/snapshot.ts
var log17 = logger.child({ component: "snapshot-job" });
function computeCorrectDirection(direction, return5d) {
  if (direction === "long") return return5d > 0 ? 1 : 0;
  if (direction === "short") return return5d < 0 ? 1 : 0;
  return Math.abs(return5d) < 0.02 ? 1 : 0;
}
async function runSnapshotJob(db2) {
  const runsRepo = new RunsRepo(db2);
  const runId = runsRepo.create({
    trigger: "snapshot",
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    settingsSnapshot: JSON.stringify({}),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null
  });
  try {
    const positionsRepo = new PositionsRepo(db2);
    const portfolioRepo = new PortfolioRepo(db2);
    const pricesRepo = new PricesRepo(db2);
    const snapshotsRepo = new SnapshotsRepo(db2);
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const alpacaAccount = await broker.getAccount();
        const alpacaPositions = await broker.getPositions();
        const currentPortfolio = portfolioRepo.read();
        if (currentPortfolio) {
          portfolioRepo.write({
            ...currentPortfolio,
            cashCents: alpacaAccount.cashCents
          });
        }
        const alpacaSymbols = new Set(alpacaPositions.map((p) => p.symbol));
        const localPositions = positionsRepo.listAll();
        for (const localPos of localPositions) {
          if (!alpacaSymbols.has(localPos.symbol) && localPos.qty !== 0) {
            positionsRepo.upsert({ ...localPos, qty: 0, updatedAt: Date.now() });
          }
        }
        for (const pos of alpacaPositions) {
          const existing = positionsRepo.get(pos.symbol);
          positionsRepo.upsert({
            symbol: pos.symbol,
            qty: pos.qty,
            avgCostCents: pos.avgCostCents,
            realizedPnlCents: existing?.realizedPnlCents ?? 0,
            openedAt: existing?.openedAt ?? Date.now(),
            updatedAt: Date.now()
          });
        }
      } catch (err) {
        log17.warn("failed to sync Alpaca data for snapshot", {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    const priceService = new PriceService(pricesRepo);
    const portfolioService = new PortfolioServiceImpl(db2, priceService, positionsRepo, portfolioRepo);
    const snapshotService = new SnapshotServiceImpl(
      priceService,
      portfolioService,
      portfolioRepo,
      snapshotsRepo
    );
    const result = await snapshotService.captureSnapshot();
    if (result.status === "ok") {
      log17.info("snapshot job succeeded", {
        portfolioSnapshotId: result.portfolioSnapshotId,
        benchmarkSnapshotId: result.benchmarkSnapshotId
      });
    } else if (result.status === "skipped") {
      runsRepo.setSkipped(runId, result.reason || "skipped");
      return;
    }
    try {
      const calibrationRepo = new CalibrationRepo(db2);
      const pending = calibrationRepo.listPendingActuals();
      for (const row of pending) {
        const assessmentDate = new Date(row.createdAt).toISOString().split("T")[0];
        const toDate = new Date(row.createdAt + 42 * 24 * 60 * 60 * 1e3).toISOString().split("T")[0];
        const bars = pricesRepo.listByDateRange(row.symbol, assessmentDate, toDate);
        if (bars.length < 6) continue;
        const entry = bars[0].adjCloseCents;
        if (entry === 0) continue;
        const return5d = (bars[5].adjCloseCents - entry) / entry;
        const return20d = bars.length >= 21 ? (bars[20].adjCloseCents - entry) / entry : null;
        const correctDirection = computeCorrectDirection(row.predictedDirection, return5d);
        calibrationRepo.updateActuals(row.id, return5d, return20d, correctDirection);
      }
    } catch (err) {
      log17.warn("calibration backfill failed", { error: err instanceof Error ? err.message : String(err) });
    }
    runsRepo.updateStatus(runId, "succeeded");
  } catch (err) {
    runsRepo.updateStatus(runId, "failed", err instanceof Error ? err.message : String(err));
    log17.warn("snapshot job failed", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

// src/scheduler/jobs/signalCollection.ts
init_logger();

// src/services/signalCollectionService.ts
init_logger();
import { randomUUID as randomUUID2 } from "crypto";

// src/services/signalSynthesisService.ts
import { HumanMessage as HumanMessage2, SystemMessage as SystemMessage2 } from "@langchain/core/messages";

// src/llm/rateLimitedLlm.ts
import { ChatOpenAI as ChatOpenAI2 } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
init_logger();
var log18 = logger.child({ component: "rate-limited-llm" });
var queueTail = Promise.resolve();
var MIN_DELAY_MS = 4e3;
function sleep2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function enqueue() {
  const myTurn = queueTail;
  let resolve;
  queueTail = new Promise((r) => {
    resolve = r;
  });
  return myTurn.then(() => {
    enqueue._release = resolve;
  });
}
function releaseQueue() {
  const release = enqueue._release;
  if (release) {
    delete enqueue._release;
    release();
  }
}
function parseRetryDelay(err) {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/retry\s+in\s+([\d.]+)s|"retryDelay"\s*:\s*"([\d.]+)s"/i);
  if (match) {
    const seconds = parseFloat(match[1] || match[2]);
    if (!isNaN(seconds)) {
      return Math.ceil(seconds * 1e3);
    }
  }
  return void 0;
}
function is429Error(err) {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("429") || message.includes("Too Many Requests") || message.includes("rate limit");
}
var RateLimitedLlm = class _RateLimitedLlm extends BaseChatModel {
  llm;
  baseDelayMs;
  maxRetries;
  constructor(llm, config = {}) {
    super({});
    this.llm = llm;
    this.baseDelayMs = config.baseDelayMs ?? 6e4;
    this.maxRetries = config.maxRetries ?? 5;
  }
  _llmType() {
    return "rate-limited-wrapper";
  }
  /** Bind tools to the underlying LLM */
  bindTools(tools, kwargs) {
    const boundLlm = this.llm.bindTools?.(tools, kwargs) ?? this.llm;
    return new _RateLimitedLlm(boundLlm, {
      baseDelayMs: this.baseDelayMs,
      maxRetries: this.maxRetries
    });
  }
  /**
   * Core generation method - all LLM calls go through here.
   * Implements blocking queue with retry logic.
   */
  async _generate(messages, options, runManager) {
    await enqueue();
    log18.debug("acquired queue slot");
    try {
      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          const result = await this.llm.invoke(messages, {
            ...options,
            callbacks: runManager ? [runManager] : void 0
          });
          await sleep2(MIN_DELAY_MS);
          return {
            generations: [{ message: result, text: typeof result.content === "string" ? result.content : "" }]
          };
        } catch (err) {
          if (!is429Error(err)) {
            throw err;
          }
          if (attempt === this.maxRetries - 1) {
            log18.error("max retries exceeded for rate limit", { attempt });
            throw err;
          }
          const parsedDelay = parseRetryDelay(err);
          const exponentialDelay = this.baseDelayMs * Math.pow(2, attempt);
          const delay = Math.max(parsedDelay ?? 0, exponentialDelay);
          log18.warn("rate limited, backing off", {
            attempt,
            delayMs: delay,
            parsedFromResponse: parsedDelay,
            exponentialDelay
          });
          await sleep2(delay);
        }
      }
      throw new Error("Max retries exceeded");
    } finally {
      releaseQueue();
    }
  }
};
var instance = null;
var currentModel = null;
function getRateLimitedLlm() {
  const resolved = resolveConfigForAgent("analyst");
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new LlmNotConfiguredError();
  }
  if (instance && currentModel !== resolved.model) {
    log18.info("model changed, recreating LLM instance", {
      from: currentModel,
      to: resolved.model
    });
    instance = null;
  }
  if (!instance) {
    const isGemini = /gemini/i.test(resolved.model);
    let baseLlm;
    if (isGemini) {
      baseLlm = new ChatGoogleGenerativeAI({
        model: resolved.model,
        apiKey,
        temperature: resolved.temperature,
        maxRetries: 0
        // We handle retries
      });
    } else {
      baseLlm = new ChatOpenAI2({
        apiKey,
        model: resolved.model,
        temperature: resolved.temperature,
        timeout: resolved.timeoutMs,
        maxRetries: 0,
        // We handle retries
        ...resolved.baseUrl ? { configuration: { baseURL: resolved.baseUrl } } : {}
      });
    }
    instance = new RateLimitedLlm(baseLlm);
    currentModel = resolved.model;
    log18.info("created rate-limited LLM instance", { model: resolved.model, isGemini });
  }
  return instance;
}
function getSynthesisLlm() {
  return getRateLimitedLlm();
}
function isGeminiModel() {
  const resolved = resolveConfigForAgent("analyst");
  return /gemini/i.test(resolved.model);
}

// src/services/signalSynthesisService.ts
init_logger();
var log19 = logger.child({ component: "signal-synthesis" });
var SYNTHESIS_SYSTEM_PROMPT = `You are a financial analyst summarizing market sentiment for a stock.
Given recent news headlines and optional fundamentals, write a 1-2 sentence sentiment summary.
Focus on the overall market sentiment direction (bullish/bearish/neutral) and key drivers.
Be concise and factual. Output ONLY the sentiment summary, no preamble.`;
async function synthesizeSentiment(input) {
  const { symbol, headlines, fundamentalsSummary } = input;
  if (headlines.length === 0) {
    return { sentimentSummary: "", tokensUsed: 0 };
  }
  const llm = getSynthesisLlm();
  let userContent = `Symbol: ${symbol}

Recent Headlines:
${headlines.slice(0, 10).map((h, i) => `${i + 1}. ${h}`).join("\n")}`;
  if (fundamentalsSummary) {
    userContent += `

Key Fundamentals:
${fundamentalsSummary}`;
  }
  userContent += "\n\nWrite a 1-2 sentence sentiment summary:";
  try {
    const response = await llm.invoke([
      new SystemMessage2(SYNTHESIS_SYSTEM_PROMPT),
      new HumanMessage2(userContent)
    ]);
    const content = typeof response.content === "string" ? response.content : Array.isArray(response.content) ? response.content.map((c) => typeof c === "string" ? c : c.text ?? "").join("") : "";
    const usage = response.usage_metadata ?? response.response_metadata?.usage ?? {};
    const tokensUsed = (usage.total_tokens ?? usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
    log19.debug("synthesized sentiment", { symbol, tokensUsed, summaryLength: content.length });
    return {
      sentimentSummary: content.trim(),
      tokensUsed
    };
  } catch (err) {
    log19.warn("synthesis failed", { symbol, error: err instanceof Error ? err.message : String(err) });
    return {
      sentimentSummary: headlines.slice(0, 5).join(". "),
      tokensUsed: 0
    };
  }
}

// src/services/signalCollectionService.ts
var log20 = logger.child({ component: "signal-collection" });
function computeSentimentTrend(scores) {
  if (scores.length < 3) return null;
  const n = scores.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += scores[i];
    sumXY += i * scores[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}
function computePriceVsSma50(prices) {
  if (prices.length < 50) return null;
  const currentPrice = prices[0].adjCloseCents;
  const sma50 = prices.slice(0, 50).reduce((sum2, p) => sum2 + p.adjCloseCents, 0) / 50;
  if (sma50 === 0) return null;
  return (currentPrice - sma50) / sma50;
}
function computeCompositeScore(sentimentScore, sentimentTrend, priceVsSma50, optionsScore, fundamentalsScore, weights) {
  let score = 0;
  let totalWeight = 0;
  if (sentimentScore !== null) {
    score += weights.sentiment * sentimentScore;
    totalWeight += weights.sentiment;
  }
  if (sentimentTrend !== null) {
    const normalizedTrend = Math.max(-1, Math.min(1, sentimentTrend * 10));
    score += weights.sentimentTrend * normalizedTrend;
    totalWeight += weights.sentimentTrend;
  }
  if (priceVsSma50 !== null) {
    const normalizedMomentum = Math.max(-1, Math.min(1, priceVsSma50 * 5));
    score += weights.priceMomentum * normalizedMomentum;
    totalWeight += weights.priceMomentum;
  }
  if (optionsScore !== null) {
    score += weights.options * optionsScore;
    totalWeight += weights.options;
  }
  if (fundamentalsScore !== null) {
    score += weights.fundamentals * fundamentalsScore;
    totalWeight += weights.fundamentals;
  }
  if (totalWeight <= 0) return null;
  const rawScore = score / totalWeight;
  return (rawScore + 1) / 2;
}
function computeOptionsScore(ivPercentile, putCallRatio) {
  if (ivPercentile === null && putCallRatio === null) return null;
  let score = 0;
  let count2 = 0;
  if (ivPercentile !== null) {
    score += (0.5 - ivPercentile) * 1.2;
    count2++;
  }
  if (putCallRatio !== null) {
    const normalizedPcr = Math.max(-1, Math.min(1, (1 - putCallRatio) * 2));
    score += normalizedPcr * 0.5;
    count2++;
  }
  return count2 > 0 ? Math.max(-1, Math.min(1, score / count2)) : null;
}
function computeFundamentalsScore(trailingPE, forwardPE, pegRatio, revenueGrowth, earningsGrowth) {
  let valuationScore = null;
  let growthScore = null;
  const valuationSignals = [];
  if (forwardPE !== null && forwardPE > 0) {
    valuationSignals.push(Math.max(-1, Math.min(1, (20 - forwardPE) / 20)));
  } else if (trailingPE !== null && trailingPE > 0) {
    valuationSignals.push(Math.max(-1, Math.min(1, (25 - trailingPE) / 25)));
  }
  if (pegRatio !== null && pegRatio > 0) {
    valuationSignals.push(Math.max(-1, Math.min(1, 1 - pegRatio)));
  }
  if (valuationSignals.length > 0) {
    valuationScore = valuationSignals.reduce((a, b) => a + b, 0) / valuationSignals.length;
  }
  const growthSignals = [];
  if (revenueGrowth !== null) {
    growthSignals.push(Math.max(-1, Math.min(1, revenueGrowth * 2.5)));
  }
  if (earningsGrowth !== null) {
    growthSignals.push(Math.max(-1, Math.min(1, earningsGrowth * 1.67)));
  }
  if (growthSignals.length > 0) {
    growthScore = growthSignals.reduce((a, b) => a + b, 0) / growthSignals.length;
  }
  return { valuationScore, growthScore };
}
function computeEwma(currentScore, previousEwma, alpha) {
  if (currentScore === null) return previousEwma;
  if (previousEwma === null) return currentScore;
  return alpha * currentScore + (1 - alpha) * previousEwma;
}
async function collectSymbolSignals(symbol, snapshotDate, deps) {
  const { signalSnapshotsRepo, pricesRepo, newsSource, optionsSource, fundamentalsSource, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  const existing = signalSnapshotsRepo.get(symbol, snapshotDate);
  if (existing) {
    log20.debug("snapshot already exists, skipping", { symbol, snapshotDate });
    return { symbol, status: "skipped", reason: "already collected today" };
  }
  let tokensUsed = 0;
  try {
    const latestPrice = pricesRepo.getLatest(symbol);
    const priceCents = latestPrice?.adjCloseCents ?? null;
    let sentimentScore = null;
    let sentimentConfidence = null;
    let sentimentSynthesis = null;
    try {
      const fromDate = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
      const toDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
      const result = await newsSource.fetch({ symbol, from: fromDate, to: toDate, limit: 10 });
      const articles = result.data.articles;
      if (articles.length > 0) {
        let textToScore;
        if (settings.signals.useLlm) {
          const headlines = articles.map((a) => a.headline);
          const synthesis = await synthesizeSentiment({ symbol, headlines });
          textToScore = synthesis.sentimentSummary || headlines.join(". ");
          sentimentSynthesis = synthesis.sentimentSummary || null;
          tokensUsed = synthesis.tokensUsed;
        } else {
          textToScore = articles.map((a) => a.headline).join(". ");
        }
        const finbertResult = await scoreFinBERT(textToScore);
        sentimentScore = finbertResult.normalizedScore;
        sentimentConfidence = finbertResult.score;
      }
    } catch (err) {
      log20.warn("failed to get news sentiment", { symbol, error: err instanceof Error ? err.message : String(err) });
    }
    const recentSentiment = signalSnapshotsRepo.getRecentSentiment(symbol, settings.signals.rollingWindowDays);
    const sentimentScores = recentSentiment.map((s) => s.sentimentScore).reverse();
    if (sentimentScore !== null) sentimentScores.push(sentimentScore);
    const sentimentTrend = computeSentimentTrend(sentimentScores);
    const prices = pricesRepo.listBySymbol(symbol, 60);
    const priceVsSma50 = computePriceVsSma50(prices);
    let ivPercentile = null;
    let putCallRatio = null;
    try {
      const optionsResult = await optionsSource.fetch({ symbol });
      const metrics = optionsResult.data.metrics;
      const callIv = metrics.nearestOtmCallIv;
      const putIv = metrics.nearestOtmPutIv;
      if (callIv !== null || putIv !== null) {
        const avgIv = (callIv ?? putIv ?? 0 + (putIv ?? callIv ?? 0)) / 2;
        ivPercentile = Math.max(0, Math.min(1, (avgIv - 0.15) / 0.65));
      }
      putCallRatio = metrics.putCallOpenInterestRatio;
    } catch (err) {
      log20.debug("failed to get options data", { symbol, error: err instanceof Error ? err.message : String(err) });
    }
    let valuationScore = null;
    let growthScore = null;
    try {
      const fundResult = await fundamentalsSource.fetch({ symbol });
      const fund = fundResult.data;
      const scores = computeFundamentalsScore(
        fund.trailingPE,
        fund.forwardPE,
        fund.pegRatio,
        fund.revenueGrowth,
        fund.earningsGrowth
      );
      valuationScore = scores.valuationScore;
      growthScore = scores.growthScore;
    } catch (err) {
      log20.debug("failed to get fundamentals data", { symbol, error: err instanceof Error ? err.message : String(err) });
    }
    const optionsScore = computeOptionsScore(ivPercentile, putCallRatio);
    const fundamentalsScoreCombined = valuationScore !== null || growthScore !== null ? ((valuationScore ?? 0) + (growthScore ?? 0)) / ((valuationScore !== null ? 1 : 0) + (growthScore !== null ? 1 : 0)) : null;
    const compositeScore = computeCompositeScore(
      sentimentScore,
      sentimentTrend,
      priceVsSma50,
      optionsScore,
      fundamentalsScoreCombined,
      settings.signals.weights
    );
    const previousSnapshot = signalSnapshotsRepo.getLatest(symbol);
    const compositeEwma = computeEwma(
      compositeScore,
      previousSnapshot?.compositeEwma ?? null,
      settings.signals.ewmaAlpha
    );
    const snapshot = {
      id: randomUUID2(),
      symbol,
      snapshotDate,
      priceCents,
      sentimentScore,
      sentimentConfidence,
      sentimentTrend,
      priceVsSma50,
      ivPercentile,
      putCallRatio,
      valuationScore,
      growthScore,
      compositeScore,
      compositeEwma,
      sentimentSynthesis,
      createdAt: Date.now()
    };
    signalSnapshotsRepo.insert(snapshot);
    log20.debug("signal collected", {
      symbol,
      snapshotDate,
      sentimentScore,
      optionsScore,
      fundamentalsScoreCombined,
      compositeScore,
      compositeEwma
    });
    return { symbol, status: "ok", tokensUsed };
  } catch (err) {
    log20.error("failed to collect signals", { symbol, error: err instanceof Error ? err.message : String(err) });
    return { symbol, status: "error", reason: err instanceof Error ? err.message : String(err) };
  }
}
async function runSignalCollection(deps) {
  const { watchlistRepo, positionsRepo, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  if (!settings.signals.enabled) {
    log20.info("signal collection disabled");
    return [];
  }
  const snapshotDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const watchlist = watchlistRepo.list().filter((w) => w.enabled);
  const watchlistSymbols = watchlist.map((w) => w.symbol);
  const positionSymbols = positionsRepo.list().map((p) => p.symbol);
  const allSymbols = [.../* @__PURE__ */ new Set([...watchlistSymbols, ...positionSymbols])];
  if (allSymbols.length === 0) {
    log20.info("no symbols in watchlist or positions");
    return [];
  }
  log20.info("starting signal collection", { date: snapshotDate, symbolCount: allSymbols.length });
  const results = [];
  for (const symbol of allSymbols) {
    const result = await collectSymbolSignals(symbol, snapshotDate, deps);
    results.push(result);
  }
  const okCount = results.filter((r) => r.status === "ok").length;
  const errorCount = results.filter((r) => r.status === "error").length;
  log20.info("signal collection complete", { date: snapshotDate, ok: okCount, errors: errorCount });
  return results;
}

// src/repos/signalSnapshotsRepo.ts
var SignalSnapshotsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  /**
   * Insert snapshot if not exists. Skips if already recorded for this symbol+date.
   * This ensures snapshots are immutable for IC measurement against forward returns.
   */
  insert(row) {
    const result = this.db.prepare(
      `INSERT OR IGNORE INTO signal_snapshots (id, symbol, snapshot_date, price_cents, sentiment_score, sentiment_confidence,
           sentiment_trend, price_vs_sma50, iv_percentile, put_call_ratio, valuation_score, growth_score,
           composite_score, composite_ewma, sentiment_synthesis, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.id,
      row.symbol,
      row.snapshotDate,
      row.priceCents,
      row.sentimentScore,
      row.sentimentConfidence,
      row.sentimentTrend,
      row.priceVsSma50,
      row.ivPercentile,
      row.putCallRatio,
      row.valuationScore,
      row.growthScore,
      row.compositeScore,
      row.compositeEwma,
      row.sentimentSynthesis,
      row.createdAt
    );
    return result.changes > 0;
  }
  get(symbol, snapshotDate) {
    return this.db.prepare(
      `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           iv_percentile as ivPercentile, put_call_ratio as putCallRatio,
           valuation_score as valuationScore, growth_score as growthScore,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           sentiment_synthesis as sentimentSynthesis, created_at as createdAt
         FROM signal_snapshots WHERE symbol = ? AND snapshot_date = ?`
    ).get(symbol, snapshotDate);
  }
  getLatest(symbol) {
    return this.db.prepare(
      `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           iv_percentile as ivPercentile, put_call_ratio as putCallRatio,
           valuation_score as valuationScore, growth_score as growthScore,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           sentiment_synthesis as sentimentSynthesis, created_at as createdAt
         FROM signal_snapshots WHERE symbol = ? ORDER BY snapshot_date DESC LIMIT 1`
    ).get(symbol);
  }
  listBySymbol(symbol, limit = 30) {
    return this.db.prepare(
      `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           iv_percentile as ivPercentile, put_call_ratio as putCallRatio,
           valuation_score as valuationScore, growth_score as growthScore,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           sentiment_synthesis as sentimentSynthesis, created_at as createdAt
         FROM signal_snapshots WHERE symbol = ? ORDER BY snapshot_date DESC LIMIT ?`
    ).all(symbol, limit);
  }
  listByDateRange(symbol, fromDate, toDate) {
    return this.db.prepare(
      `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           iv_percentile as ivPercentile, put_call_ratio as putCallRatio,
           valuation_score as valuationScore, growth_score as growthScore,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           sentiment_synthesis as sentimentSynthesis, created_at as createdAt
         FROM signal_snapshots WHERE symbol = ? AND snapshot_date >= ? AND snapshot_date <= ?
         ORDER BY snapshot_date ASC`
    ).all(symbol, fromDate, toDate);
  }
  getRecentSnapshots(symbol, days) {
    return this.db.prepare(
      `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           iv_percentile as ivPercentile, put_call_ratio as putCallRatio,
           valuation_score as valuationScore, growth_score as growthScore,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           sentiment_synthesis as sentimentSynthesis, created_at as createdAt
         FROM signal_snapshots
         WHERE symbol = ?
         ORDER BY snapshot_date DESC LIMIT ?`
    ).all(symbol, days);
  }
  /** Get previous N days of sentiment scores for trend calculation */
  getRecentSentiment(symbol, days) {
    return this.db.prepare(
      `SELECT snapshot_date as snapshotDate, sentiment_score as sentimentScore
         FROM signal_snapshots
         WHERE symbol = ? AND sentiment_score IS NOT NULL
         ORDER BY snapshot_date DESC LIMIT ?`
    ).all(symbol, days);
  }
  listByDate(snapshotDate) {
    return this.db.prepare(
      `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           iv_percentile as ivPercentile, put_call_ratio as putCallRatio,
           valuation_score as valuationScore, growth_score as growthScore,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           sentiment_synthesis as sentimentSynthesis, created_at as createdAt
         FROM signal_snapshots WHERE snapshot_date = ? ORDER BY symbol`
    ).all(snapshotDate);
  }
  /**
   * Get all snapshots for IC measurement.
   * Returns snapshots with both sentiment and price for forward return calculation.
   */
  listForIcMeasurement(fromDate, toDate) {
    return this.db.prepare(
      `SELECT symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, price_vs_sma50 as priceVsSma50,
           composite_score as compositeScore
         FROM signal_snapshots
         WHERE snapshot_date >= ? AND snapshot_date <= ?
           AND sentiment_score IS NOT NULL AND price_cents IS NOT NULL
         ORDER BY snapshot_date ASC, symbol ASC`
    ).all(fromDate, toDate);
  }
};

// src/scheduler/jobs/signalCollection.ts
var log21 = logger.child({ component: "signal-collection-job" });
async function runSignalCollectionJob(db2, trigger = "signal_collection") {
  const settings = getSettings();
  const runsRepo = new RunsRepo(db2);
  const summary = {
    symbolsUpdated: 0,
    errors: 0,
    symbols: [],
    tokensUsed: 0
  };
  const model = settings.signals.useLlm ? settings.llm.model : null;
  const runId = runsRepo.create({
    trigger,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    model,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null
  });
  try {
    if (!settings.signals.enabled) {
      runsRepo.setSkipped(runId, "signal collection disabled");
      return summary;
    }
    const signalSnapshotsRepo = new SignalSnapshotsRepo(db2);
    const pricesRepo = new PricesRepo(db2);
    const watchlistRepo = new WatchlistRepo(db2);
    const positionsRepo = new PositionsRepo(db2);
    const newsSource = dataSourceRegistry.get("news");
    const optionsSource = dataSourceRegistry.get("options");
    const fundamentalsSource = dataSourceRegistry.get("fundamentals");
    const results = await runSignalCollection({
      signalSnapshotsRepo,
      pricesRepo,
      watchlistRepo,
      positionsRepo,
      newsSource,
      optionsSource,
      fundamentalsSource,
      getSettings
    });
    summary.symbolsUpdated = results.filter((r) => r.status === "ok").length;
    summary.errors = results.filter((r) => r.status === "error").length;
    summary.symbols = results.filter((r) => r.status === "ok").map((r) => r.symbol);
    summary.tokensUsed = results.reduce((sum2, r) => sum2 + (r.tokensUsed ?? 0), 0);
    runsRepo.updateStatus(runId, "succeeded");
    runsRepo.updateSummary(runId, JSON.stringify(summary));
    if (summary.tokensUsed > 0) {
      runsRepo.updateTokenUsage(runId, JSON.stringify({
        total_tokens: summary.tokensUsed,
        prompt_tokens: Math.round(summary.tokensUsed * 0.8),
        completion_tokens: Math.round(summary.tokensUsed * 0.2)
      }));
    }
    log21.info("signal collection job complete", { ok: summary.symbolsUpdated, errors: summary.errors });
    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, "failed", err instanceof Error ? err.message : String(err));
    log21.error("signal collection job failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// src/scheduler/jobs/regimeDetection.ts
init_logger();

// src/services/regimeDetectionService.ts
init_logger();
import { randomUUID as randomUUID3 } from "crypto";
var log22 = logger.child({ component: "regime-detection" });
function computeRiskScore(indicators, settings) {
  const { regime: regimeSettings } = settings;
  let score = 0;
  if (indicators.vix !== null) {
    if (indicators.vix > regimeSettings.vixExtremeThreshold) {
      score += 0.5;
    } else if (indicators.vix > regimeSettings.vixRiskOffThreshold) {
      score += 0.3;
    }
  }
  if (indicators.yieldCurve !== null && regimeSettings.yieldCurveEnabled) {
    if (indicators.yieldCurve < 0) {
      score += 0.25;
    }
  }
  if (indicators.breadth !== null) {
    if (indicators.breadth < regimeSettings.breadthThreshold) {
      score += 0.25;
    }
  }
  return Math.min(1, score);
}
function scoreToRegime(riskScore) {
  if (riskScore >= 0.5) return "RISK_OFF";
  if (riskScore >= 0.25) return "NEUTRAL";
  return "RISK_ON";
}
async function fetchIndicators(macroSource) {
  const indicators = {
    vix: null,
    yieldCurve: null,
    breadth: null
  };
  try {
    const result = await macroSource.fetch({ seriesIds: ["VIXCLS", "T10Y2Y"] });
    for (const series of result.data.series) {
      if (series.seriesId === "VIXCLS" && series.latest) {
        indicators.vix = series.latest.value;
      }
      if (series.seriesId === "T10Y2Y" && series.latest) {
        indicators.yieldCurve = series.latest.value;
      }
    }
  } catch (err) {
    log22.warn("failed to fetch macro indicators", { error: err instanceof Error ? err.message : String(err) });
  }
  return indicators;
}
async function detectRegime(deps) {
  const { marketRegimeRepo, macroSource, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  if (!settings.regime.enabled) {
    log22.info("regime detection disabled");
    return {
      regime: "RISK_ON",
      riskScore: 0,
      indicators: { vix: null, yieldCurve: null, breadth: null },
      confirmedStreak: 0
    };
  }
  const asOfDate = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  const indicators = await fetchIndicators(macroSource);
  const riskScore = computeRiskScore(indicators, settings);
  const regime = scoreToRegime(riskScore);
  const row = {
    id: randomUUID3(),
    asOfDate,
    regime,
    vixLevel: indicators.vix,
    yieldCurveSpread: indicators.yieldCurve,
    breadthPct: indicators.breadth,
    riskScore,
    indicatorsJson: JSON.stringify(indicators),
    createdAt: Date.now()
  };
  marketRegimeRepo.upsert(row);
  const confirmedStreak = marketRegimeRepo.getRegimeStreak(regime);
  log22.info("regime detected", { asOfDate, regime, riskScore, confirmedStreak, indicators });
  return { regime, riskScore, indicators, confirmedStreak };
}
function getCurrentRegime(marketRegimeRepo) {
  const latest = marketRegimeRepo.getLatest();
  return latest?.regime ?? "RISK_ON";
}

// src/repos/marketRegimeRepo.ts
var MarketRegimeRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  upsert(row) {
    this.db.prepare(
      `INSERT INTO market_regime (id, as_of_date, regime, vix_level, yield_curve_spread, breadth_pct, risk_score, indicators_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(as_of_date) DO UPDATE SET
           regime = excluded.regime,
           vix_level = excluded.vix_level,
           yield_curve_spread = excluded.yield_curve_spread,
           breadth_pct = excluded.breadth_pct,
           risk_score = excluded.risk_score,
           indicators_json = excluded.indicators_json`
    ).run(
      row.id,
      row.asOfDate,
      row.regime,
      row.vixLevel,
      row.yieldCurveSpread,
      row.breadthPct,
      row.riskScore,
      row.indicatorsJson,
      row.createdAt
    );
  }
  get(asOfDate) {
    return this.db.prepare(
      `SELECT id, as_of_date as asOfDate, regime, vix_level as vixLevel,
           yield_curve_spread as yieldCurveSpread, breadth_pct as breadthPct,
           risk_score as riskScore, indicators_json as indicatorsJson, created_at as createdAt
         FROM market_regime WHERE as_of_date = ?`
    ).get(asOfDate);
  }
  getLatest() {
    return this.db.prepare(
      `SELECT id, as_of_date as asOfDate, regime, vix_level as vixLevel,
           yield_curve_spread as yieldCurveSpread, breadth_pct as breadthPct,
           risk_score as riskScore, indicators_json as indicatorsJson, created_at as createdAt
         FROM market_regime ORDER BY as_of_date DESC LIMIT 1`
    ).get();
  }
  /** Get recent regime history for confirmation logic */
  getRecentRegimes(days) {
    return this.db.prepare(
      `SELECT id, as_of_date as asOfDate, regime, vix_level as vixLevel,
           yield_curve_spread as yieldCurveSpread, breadth_pct as breadthPct,
           risk_score as riskScore, indicators_json as indicatorsJson, created_at as createdAt
         FROM market_regime ORDER BY as_of_date DESC LIMIT ?`
    ).all(days);
  }
  /** Check if regime has been consistent for N days (for confirmation) */
  getRegimeStreak(regime) {
    const rows = this.db.prepare(
      `SELECT regime FROM market_regime ORDER BY as_of_date DESC LIMIT 10`
    ).all();
    let streak = 0;
    for (const row of rows) {
      if (row.regime === regime) streak++;
      else break;
    }
    return streak;
  }
};

// src/scheduler/jobs/regimeDetection.ts
var log23 = logger.child({ component: "regime-detection-job" });
async function runRegimeDetectionJob(db2) {
  const runsRepo = new RunsRepo(db2);
  const settings = getSettings();
  if (!settings.regime.enabled) {
    const runId2 = runsRepo.create({
      trigger: "regime_detection",
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      model: null,
      settingsSnapshot: JSON.stringify(settings),
      error: null,
      tokenUsageJson: null,
      skipReason: null,
      summaryJson: null
    });
    runsRepo.setSkipped(runId2, "regime detection disabled");
    return;
  }
  const runId = runsRepo.create({
    trigger: "regime_detection",
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null
  });
  try {
    const marketRegimeRepo = new MarketRegimeRepo(db2);
    const macroSource = dataSourceRegistry.get("macro");
    const result = await detectRegime({
      marketRegimeRepo,
      macroSource,
      getSettings
    });
    log23.info("regime detection job complete", {
      regime: result.regime,
      riskScore: result.riskScore,
      confirmedStreak: result.confirmedStreak
    });
    runsRepo.updateStatus(runId, "succeeded");
  } catch (err) {
    runsRepo.updateStatus(runId, "failed", err instanceof Error ? err.message : String(err));
    log23.error("regime detection job failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

// src/scheduler/jobs/weeklyPlanner.ts
init_logger();

// src/scheduler/jobs/planReviewJob.ts
init_logger();

// src/repos/planTranchesRepo.ts
var PlanTranchesRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(tranche) {
    this.db.prepare(
      `INSERT INTO plan_tranches (id, plan_id, tranche_number, shares, price_cents, order_id,
           order_status, total_cost_cents, composite_score, regime, executed_at, filled_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, ?, NULL)`
    ).run(
      tranche.id,
      tranche.planId,
      tranche.trancheNumber,
      tranche.shares,
      tranche.priceCents,
      tranche.orderId,
      tranche.compositeScore,
      tranche.regime,
      tranche.executedAt
    );
  }
  listByPlan(planId) {
    return this.db.prepare(
      `SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, order_status as orderStatus, total_cost_cents as totalCostCents,
           composite_score as compositeScore, regime, executed_at as executedAt, filled_at as filledAt
         FROM plan_tranches WHERE plan_id = ? ORDER BY tranche_number`
    ).all(planId);
  }
  getLatestByPlan(planId) {
    return this.db.prepare(
      `SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, order_status as orderStatus, total_cost_cents as totalCostCents,
           composite_score as compositeScore, regime, executed_at as executedAt, filled_at as filledAt
         FROM plan_tranches WHERE plan_id = ? ORDER BY tranche_number DESC LIMIT 1`
    ).get(planId);
  }
  listPending() {
    return this.db.prepare(
      `SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, order_status as orderStatus, total_cost_cents as totalCostCents,
           composite_score as compositeScore, regime, executed_at as executedAt, filled_at as filledAt
         FROM plan_tranches WHERE order_status = 'PENDING' ORDER BY executed_at`
    ).all();
  }
  updateStatus(id, status, totalCostCents, filledAt) {
    this.db.prepare(
      `UPDATE plan_tranches SET order_status = ?, total_cost_cents = ?, filled_at = ? WHERE id = ?`
    ).run(status, totalCostCents ?? null, filledAt ?? null, id);
  }
  updateShares(id, shares) {
    this.db.prepare(`UPDATE plan_tranches SET shares = ? WHERE id = ?`).run(shares, id);
  }
};

// src/services/strategicPlanService.ts
init_logger();
import { randomUUID as randomUUID4 } from "crypto";
var log24 = logger.child({ component: "strategic-plan" });
function createPlan(deps, params) {
  const { strategicPlansRepo, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  if (!params.targetShares && !params.targetBudgetCents) {
    throw new Error("Either targetShares or targetBudgetCents must be provided");
  }
  const existing = strategicPlansRepo.getActiveBySymbol(params.symbol);
  if (existing) {
    throw new Error(`Active plan already exists for ${params.symbol}`);
  }
  const plan = {
    id: randomUUID4(),
    symbol: params.symbol,
    direction: params.direction,
    targetShares: params.targetShares ?? 0,
    targetWeight: params.targetWeight ?? null,
    targetBudgetCents: params.targetBudgetCents ?? null,
    trancheCount: params.trancheCount ?? settings.execution.defaultTrancheCount,
    minDaysBetween: settings.execution.minDaysBetweenTranches,
    entryCompositeScore: params.entryCompositeScore ?? null,
    convictionAtCreation: params.conviction ?? null,
    status: "ACTIVE",
    pauseReason: null,
    creationNotes: params.creationNotes ?? null,
    createdAt: Date.now()
  };
  strategicPlansRepo.create(plan);
  log24.info("plan created", {
    id: plan.id,
    symbol: params.symbol,
    direction: params.direction,
    targetShares: params.targetShares,
    targetBudgetCents: params.targetBudgetCents
  });
  return { ...plan, executedShares: 0, tranchesExecuted: 0, lastTrancheAt: null, completedAt: null };
}
function computeConvictionScaledTranche(plan, currentScore) {
  const remainingShares = plan.targetShares - plan.executedShares;
  const remainingTranches = plan.trancheCount - plan.tranchesExecuted;
  if (remainingTranches <= 0) return 0;
  const baseSize = remainingShares / remainingTranches;
  if (currentScore === null) return Math.ceil(baseSize);
  const convictionMultiplier = Math.max(0.2, Math.min(1.5, (currentScore - 0.5) / 0.5));
  return Math.max(1, Math.ceil(baseSize * convictionMultiplier));
}
function pausePlan(deps, planId, reason) {
  const { strategicPlansRepo } = deps;
  strategicPlansRepo.updateStatus(planId, "PAUSED", reason);
  log24.info("plan paused", { planId, reason });
}
function resumePlan(deps, planId) {
  const { strategicPlansRepo } = deps;
  strategicPlansRepo.updateStatus(planId, "ACTIVE");
  log24.info("plan resumed", { planId });
}
function completePlan(deps, planId) {
  const { strategicPlansRepo } = deps;
  strategicPlansRepo.updateStatus(planId, "COMPLETED");
  log24.info("plan completed", { planId });
}
function cancelPlan(deps, planId, reason) {
  const { strategicPlansRepo } = deps;
  strategicPlansRepo.updateStatus(planId, "CANCELLED", reason);
  log24.info("plan cancelled", { planId, reason });
}
function daysSince(timestamp) {
  if (!timestamp) return Infinity;
  return Math.floor((Date.now() - timestamp) / 864e5);
}
function shouldExecuteTranche(deps, plan) {
  const { signalSnapshotsRepo, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  const daysSinceLastTranche = daysSince(plan.lastTrancheAt);
  if (daysSinceLastTranche < plan.minDaysBetween) {
    return { execute: false, reason: `only ${daysSinceLastTranche} days since last tranche (min: ${plan.minDaysBetween})` };
  }
  if (plan.tranchesExecuted >= plan.trancheCount) {
    return { execute: false, reason: "all tranches executed" };
  }
  if (plan.direction === "ACCUMULATE") {
    const signal = signalSnapshotsRepo.getLatest(plan.symbol);
    const score = signal?.compositeEwma ?? signal?.compositeScore;
    if (score !== null && score !== void 0) {
      if (score < settings.signals.cancelThreshold) {
        return { execute: false, reason: `signal dropped below cancel threshold (${score.toFixed(2)} < ${settings.signals.cancelThreshold})` };
      }
      if (score < settings.signals.pauseThreshold) {
        return { execute: false, reason: `signal below pause threshold (${score.toFixed(2)} < ${settings.signals.pauseThreshold})` };
      }
    }
  }
  return { execute: true };
}
function computeTrancheSize(plan, currentScore, trancheStyle) {
  if (trancheStyle === "conviction_scaled" && currentScore !== void 0) {
    return computeConvictionScaledTranche(plan, currentScore);
  }
  const remainingShares = plan.targetShares - plan.executedShares;
  const remainingTranches = plan.trancheCount - plan.tranchesExecuted;
  if (remainingTranches <= 0) return 0;
  return Math.ceil(remainingShares / remainingTranches);
}
function computeTrancheSizeWithBudget(plan, priceCents, availableCashCents) {
  const remainingTranches = plan.trancheCount - plan.tranchesExecuted;
  if (remainingTranches <= 0) return { shares: 0, reason: "all tranches executed" };
  let trancheBudget;
  if (plan.targetBudgetCents) {
    const executedBudget = plan.executedShares * priceCents;
    const remainingBudget = plan.targetBudgetCents - executedBudget;
    trancheBudget = Math.max(0, remainingBudget / remainingTranches);
  } else {
    const remainingShares = plan.targetShares - plan.executedShares;
    trancheBudget = remainingShares / remainingTranches * priceCents;
  }
  const maxAffordable = Math.floor(availableCashCents / priceCents);
  const desired = Math.floor(trancheBudget / priceCents);
  if (maxAffordable < 1) {
    return { shares: 0, reason: "insufficient cash for 1 whole share" };
  }
  const shares = Math.min(desired, maxAffordable);
  if (shares < 1) {
    return { shares: 0, reason: "tranche budget insufficient for 1 share" };
  }
  return { shares };
}
async function executeTranche(deps, plan, priceCents, availableCashCents, orderId) {
  const { strategicPlansRepo, planTranchesRepo, signalSnapshotsRepo, marketRegimeRepo, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  const signal = signalSnapshotsRepo.getLatest(plan.symbol);
  const currentScore = signal?.compositeEwma ?? signal?.compositeScore ?? null;
  let shares;
  if (availableCashCents !== void 0) {
    const result = computeTrancheSizeWithBudget(plan, priceCents, availableCashCents);
    if (result.shares === 0) {
      log24.warn("tranche skipped", { planId: plan.id, symbol: plan.symbol, reason: result.reason });
      return null;
    }
    shares = result.shares;
    if (settings.execution.trancheStyle === "conviction_scaled" && currentScore !== null) {
      const convictionMultiplier = Math.max(0.2, Math.min(1.5, (currentScore - 0.5) / 0.5));
      shares = Math.max(1, Math.ceil(shares * convictionMultiplier));
    }
  } else {
    shares = computeTrancheSize(plan, currentScore, settings.execution.trancheStyle);
    if (shares === 0) {
      log24.warn("tranche skipped", { planId: plan.id, symbol: plan.symbol, reason: "no shares to execute" });
      return null;
    }
  }
  const trancheNumber = plan.tranchesExecuted + 1;
  const regime = getCurrentRegime(marketRegimeRepo);
  const trancheId = randomUUID4();
  planTranchesRepo.create({
    id: trancheId,
    planId: plan.id,
    trancheNumber,
    shares,
    priceCents,
    orderId: orderId ?? null,
    compositeScore: signal?.compositeEwma ?? signal?.compositeScore ?? null,
    regime,
    executedAt: Date.now()
  });
  if (deps.broker && deps.ordersRepo) {
    const clientOrderId = `plan-${plan.id}-tranche-${trancheNumber}-${Date.now()}`;
    const side = plan.direction === "ACCUMULATE" ? "buy" : "sell";
    const orderReq = {
      clientOrderId,
      symbol: plan.symbol,
      side,
      qty: shares,
      type: "market",
      tif: "day"
    };
    try {
      const orderState = await deps.broker.submitOrder(orderReq);
      deps.ordersRepo.create({
        clientOrderId: orderState.clientOrderId,
        decisionId: null,
        runId: null,
        broker: "alpaca",
        brokerOrderId: orderState.id,
        mode: "paper",
        symbol: plan.symbol,
        side: orderReq.side,
        qty: shares,
        type: "market",
        limitPriceCents: null,
        tif: "day",
        status: orderState.status,
        rejectReason: orderState.rejectReason,
        submittedAt: orderState.submittedAt
      });
      planTranchesRepo.updateStatus(trancheId, "PENDING", void 0, Date.now());
      log24.info("tranche order submitted to Alpaca", {
        planId: plan.id,
        symbol: plan.symbol,
        trancheId,
        trancheNumber,
        shares,
        brokerOrderId: orderState.id,
        orderStatus: orderState.status
      });
      if (orderState.status === "filled") {
        planTranchesRepo.updateStatus(trancheId, "FILLED", shares * priceCents, Date.now());
        strategicPlansRepo.recordTrancheExecution(plan.id, shares);
      }
      return {
        planId: plan.id,
        symbol: plan.symbol,
        shares,
        priceCents,
        trancheNumber
      };
    } catch (err) {
      log24.error("failed to submit tranche order to Alpaca", {
        planId: plan.id,
        symbol: plan.symbol,
        shares,
        error: err instanceof Error ? err.message : String(err)
      });
      planTranchesRepo.updateStatus(trancheId, "FAILED", void 0, Date.now());
      return null;
    }
  }
  planTranchesRepo.updateStatus(trancheId, "FILLED", shares * priceCents, Date.now());
  strategicPlansRepo.recordTrancheExecution(plan.id, shares);
  const updatedPlan = strategicPlansRepo.get(plan.id);
  if (updatedPlan && updatedPlan.tranchesExecuted >= updatedPlan.trancheCount) {
    completePlan(deps, plan.id);
  }
  log24.info("tranche executed", {
    planId: plan.id,
    symbol: plan.symbol,
    trancheNumber,
    shares,
    priceCents,
    regime
  });
  return {
    planId: plan.id,
    symbol: plan.symbol,
    shares,
    priceCents,
    trancheNumber,
    orderId
  };
}
function checkAndPausePlansForRegime(deps) {
  const { strategicPlansRepo, marketRegimeRepo, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  if (!settings.execution.requireRegimeCheck) return 0;
  const regime = getCurrentRegime(marketRegimeRepo);
  if (regime !== "RISK_OFF") return 0;
  const streak = marketRegimeRepo.getRegimeStreak("RISK_OFF");
  if (streak < settings.regime.confirmationDays) return 0;
  const activePlans = strategicPlansRepo.listActive();
  let pausedCount = 0;
  for (const plan of activePlans) {
    if (plan.direction === "ACCUMULATE") {
      pausePlan(deps, plan.id, "regime_risk_off");
      pausedCount++;
    }
  }
  if (pausedCount > 0) {
    log24.info("paused plans due to RISK_OFF regime", { count: pausedCount, streak });
  }
  return pausedCount;
}
function checkAndResumePlansForRegime(deps) {
  const { strategicPlansRepo, marketRegimeRepo } = deps;
  const regime = getCurrentRegime(marketRegimeRepo);
  if (regime === "RISK_OFF") return 0;
  const pausedPlans = strategicPlansRepo.listPaused();
  let resumedCount = 0;
  for (const plan of pausedPlans) {
    if (plan.pauseReason === "regime_risk_off") {
      resumePlan(deps, plan.id);
      resumedCount++;
    }
  }
  if (resumedCount > 0) {
    log24.info("resumed plans after regime change", { count: resumedCount, regime });
  }
  return resumedCount;
}
function checkAndCancelPlansForSignal(deps) {
  const { strategicPlansRepo, signalSnapshotsRepo, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  const activePlans = strategicPlansRepo.listActive();
  let cancelledCount = 0;
  for (const plan of activePlans) {
    if (plan.direction !== "ACCUMULATE") continue;
    const signal = signalSnapshotsRepo.getLatest(plan.symbol);
    const score = signal?.compositeEwma ?? signal?.compositeScore;
    if (score !== null && score !== void 0 && score < settings.signals.cancelThreshold) {
      cancelPlan(deps, plan.id, `signal_below_threshold:${score.toFixed(2)}`);
      cancelledCount++;
    }
  }
  if (cancelledCount > 0) {
    log24.info("cancelled plans due to signal degradation", { count: cancelledCount });
  }
  return cancelledCount;
}
function createAutoTrimPlans(deps) {
  const { strategicPlansRepo, signalSnapshotsRepo, portfolioRepo, positionsRepo, pricesRepo, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  const result = {
    trimPlansCreated: 0,
    targetCashPercent: settings.hedging.cashReserveInRiskOff,
    currentCashPercent: 0,
    symbols: []
  };
  if (!settings.hedging.autoTrimForCash) {
    log24.debug("auto-trim disabled");
    return result;
  }
  if (!positionsRepo) {
    log24.warn("positionsRepo not provided, cannot auto-trim");
    return result;
  }
  const portfolio = portfolioRepo.read();
  if (!portfolio) {
    log24.warn("no portfolio found");
    return result;
  }
  const positions = positionsRepo.list();
  let totalValueCents = portfolio.cashCents;
  const positionValues = [];
  for (const pos of positions) {
    const price = pricesRepo.getLatest(pos.symbol);
    if (!price) continue;
    const valueCents = pos.qty * price.adjCloseCents;
    totalValueCents += valueCents;
    const signal = signalSnapshotsRepo.getLatest(pos.symbol);
    const score = signal?.compositeEwma ?? signal?.compositeScore ?? null;
    positionValues.push({ symbol: pos.symbol, valueCents, score });
  }
  result.currentCashPercent = totalValueCents > 0 ? portfolio.cashCents / totalValueCents : 1;
  if (result.currentCashPercent >= result.targetCashPercent) {
    log24.debug("cash already at target", { current: result.currentCashPercent, target: result.targetCashPercent });
    return result;
  }
  positionValues.sort((a, b) => (a.score ?? -1) - (b.score ?? -1));
  const targetCashCents = totalValueCents * result.targetCashPercent;
  let cashNeededCents = targetCashCents - portfolio.cashCents;
  for (const pos of positionValues) {
    if (cashNeededCents <= 0) break;
    const existingPlan = strategicPlansRepo.getActiveBySymbol(pos.symbol);
    if (existingPlan) {
      if (existingPlan.direction === "ACCUMULATE") {
        pausePlan(deps, existingPlan.id, "auto_trim_for_hedge");
      }
      continue;
    }
    const trimValueCents = Math.min(pos.valueCents * 0.5, cashNeededCents);
    const price = pricesRepo.getLatest(pos.symbol);
    if (!price) continue;
    const trimShares = Math.floor(trimValueCents / price.adjCloseCents);
    if (trimShares < 1) continue;
    try {
      createPlan(deps, {
        symbol: pos.symbol,
        direction: "TRIM",
        targetShares: trimShares,
        entryCompositeScore: pos.score ?? void 0,
        conviction: 0
        // Low conviction trim
      });
      cashNeededCents -= trimShares * price.adjCloseCents;
      result.trimPlansCreated++;
      result.symbols.push(pos.symbol);
    } catch (err) {
      log24.warn("failed to create trim plan", { symbol: pos.symbol, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (result.trimPlansCreated > 0) {
    log24.info("auto-trim plans created for hedging", { ...result });
  }
  return result;
}
var SECTOR_MAP = {
  AAPL: "Technology",
  MSFT: "Technology",
  GOOGL: "Technology",
  AMZN: "Consumer Cyclical",
  META: "Technology",
  NVDA: "Technology",
  TSLA: "Consumer Cyclical",
  AMD: "Technology",
  JPM: "Financial",
  BAC: "Financial",
  GS: "Financial",
  MS: "Financial",
  JNJ: "Healthcare",
  UNH: "Healthcare",
  PFE: "Healthcare",
  MRK: "Healthcare",
  XOM: "Energy",
  CVX: "Energy",
  COP: "Energy",
  GLD: "Commodities",
  TLT: "Fixed Income",
  SHY: "Fixed Income"
};
async function getSectorAsync(deps, symbol) {
  if (deps.symbolCategoriesRepo) {
    const dbSector = deps.symbolCategoriesRepo.getSector(symbol);
    if (dbSector) return dbSector;
    const apiKey = process.env.FINNHUB_API_KEY;
    if (apiKey) {
      try {
        const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          if (data.finnhubIndustry) {
            const existing = deps.symbolCategoriesRepo.get(symbol);
            if (existing) {
              deps.symbolCategoriesRepo.upsert({ ...existing, sector: data.finnhubIndustry });
            } else {
              deps.symbolCategoriesRepo.upsert({
                symbol,
                category: "GROWTH_CORE",
                sector: data.finnhubIndustry,
                yieldPercent: null,
                dividendGrowthPercent: null,
                estCagrPercent: null,
                lastScreenedAt: null
              });
            }
            log24.debug("sector fetched and cached", { symbol, sector: data.finnhubIndustry });
            return data.finnhubIndustry;
          }
        }
      } catch (err) {
        log24.debug("failed to fetch sector from finnhub", { symbol, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return SECTOR_MAP[symbol.toUpperCase()] ?? "Unknown";
}
function getSector(deps, symbol) {
  if (deps.symbolCategoriesRepo) {
    const dbSector = deps.symbolCategoriesRepo.getSector(symbol);
    if (dbSector) return dbSector;
  }
  return SECTOR_MAP[symbol.toUpperCase()] ?? "Unknown";
}
function calculateSectorExposure(deps) {
  const { positionsRepo, pricesRepo, portfolioRepo } = deps;
  if (!positionsRepo) {
    return { exposures: [], totalValueCents: 0 };
  }
  const portfolio = portfolioRepo.read();
  if (!portfolio) {
    return { exposures: [], totalValueCents: 0 };
  }
  const positions = positionsRepo.list();
  let totalValueCents = portfolio.cashCents;
  const sectorValues = /* @__PURE__ */ new Map();
  for (const pos of positions) {
    const price = pricesRepo.getLatest(pos.symbol);
    if (!price) continue;
    const valueCents = pos.qty * price.adjCloseCents;
    totalValueCents += valueCents;
    const sector = getSector(deps, pos.symbol);
    sectorValues.set(sector, (sectorValues.get(sector) ?? 0) + valueCents);
  }
  const exposures = [];
  for (const [sector, valueCents] of sectorValues) {
    exposures.push({
      sector,
      valueCents,
      percent: totalValueCents > 0 ? valueCents / totalValueCents : 0
    });
  }
  return { exposures, totalValueCents };
}
async function checkSectorExposure(deps, symbol, trancheValueCents) {
  const { getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  const maxSectorExposure = settings.execution.maxSectorExposure;
  if (maxSectorExposure >= 1) {
    return { allowed: true };
  }
  const { exposures, totalValueCents } = calculateSectorExposure(deps);
  const sector = await getSectorAsync(deps, symbol);
  const currentSectorValue = exposures.find((e) => e.sector === sector)?.valueCents ?? 0;
  const currentExposure = totalValueCents > 0 ? currentSectorValue / totalValueCents : 0;
  const newExposure = totalValueCents > 0 ? (currentSectorValue + trancheValueCents) / (totalValueCents + trancheValueCents) : 0;
  if (newExposure > maxSectorExposure) {
    return {
      allowed: false,
      reason: `sector ${sector} would exceed ${(maxSectorExposure * 100).toFixed(0)}% limit (${(newExposure * 100).toFixed(1)}%)`,
      currentExposure,
      newExposure
    };
  }
  return { allowed: true, currentExposure, newExposure };
}
function maybeCreateAutoHedgePlan(deps) {
  const { strategicPlansRepo, marketRegimeRepo, portfolioRepo, pricesRepo, getSettings: getSettings2 } = deps;
  const settings = getSettings2();
  if (!settings.hedging.autoCreateHedgePlan) {
    return { hedgePlanCreated: false, reason: "auto-hedge disabled" };
  }
  const regime = getCurrentRegime(marketRegimeRepo);
  if (regime !== "RISK_OFF") {
    return { hedgePlanCreated: false, reason: "not in RISK_OFF regime" };
  }
  const streak = marketRegimeRepo.getRegimeStreak("RISK_OFF");
  if (streak < settings.hedging.minRiskOffStreak) {
    return { hedgePlanCreated: false, reason: `RISK_OFF streak ${streak} < min ${settings.hedging.minRiskOffStreak}` };
  }
  const portfolio = portfolioRepo.read();
  if (!portfolio) {
    return { hedgePlanCreated: false, reason: "no portfolio" };
  }
  const { totalValueCents } = calculateSectorExposure(deps);
  const cashPercent = totalValueCents > 0 ? portfolio.cashCents / totalValueCents : 0;
  if (cashPercent < settings.hedging.minCashForHedge) {
    return { hedgePlanCreated: false, reason: `cash ${(cashPercent * 100).toFixed(1)}% < min ${(settings.hedging.minCashForHedge * 100).toFixed(0)}%` };
  }
  for (const hedgeSymbol of settings.hedging.riskOffAssets) {
    const existingPlan = strategicPlansRepo.getActiveBySymbol(hedgeSymbol);
    if (existingPlan) continue;
    const price = pricesRepo.getLatest(hedgeSymbol);
    if (!price) continue;
    const targetWeight = 0.15;
    const targetValueCents = totalValueCents * targetWeight;
    const targetShares = Math.floor(targetValueCents / price.adjCloseCents);
    if (targetShares < 1) continue;
    try {
      createPlan(deps, {
        symbol: hedgeSymbol,
        direction: "HEDGE",
        targetShares,
        targetWeight,
        conviction: 1,
        // High conviction for hedge
        creationNotes: `Auto-hedge: RISK_OFF streak=${streak}, cash=${(cashPercent * 100).toFixed(1)}%`
      });
      log24.info("auto-hedge plan created", { symbol: hedgeSymbol, targetShares, streak });
      return { hedgePlanCreated: true, symbol: hedgeSymbol };
    } catch (err) {
      log24.warn("failed to create hedge plan", { symbol: hedgeSymbol, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { hedgePlanCreated: false, reason: "all hedge assets have active plans or no price" };
}

// src/scheduler/jobs/planReviewJob.ts
var log25 = logger.child({ component: "plan-review-job" });
var CHUNKY_STOCK_THRESHOLD_CENTS = 5e4;
function computeTargetAllocation(portfolioValueCents, priceCents, conviction, maxPositionWeight) {
  const baseWeight = 0.05;
  const convictionMultiplier = 0.5 + conviction;
  const targetWeight = Math.min(baseWeight * convictionMultiplier, maxPositionWeight / 100);
  const targetValueCents = portfolioValueCents * targetWeight;
  if (priceCents >= CHUNKY_STOCK_THRESHOLD_CENTS) {
    return { targetBudgetCents: Math.round(targetValueCents) };
  }
  const targetShares = Math.floor(targetValueCents / priceCents);
  return { targetShares };
}
async function runPlanReviewJob(db2, trigger = "plan_review") {
  const settings = getSettings();
  const runsRepo = new RunsRepo(db2);
  const summary = {
    regime: "UNKNOWN",
    watchlistCount: 0,
    positionsCount: 0,
    plansCreated: 0,
    trimPlansCreated: 0,
    plansSkipped: [],
    existingActivePlans: 0,
    symbolsPruned: []
  };
  const runId = runsRepo.create({
    trigger,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null
  });
  try {
    if (!settings.execution.enabled) {
      runsRepo.setSkipped(runId, "execution disabled");
      return summary;
    }
    const signalSnapshotsRepo = new SignalSnapshotsRepo(db2);
    const strategicPlansRepo = new StrategicPlansRepo(db2);
    const planTranchesRepo = new PlanTranchesRepo(db2);
    const marketRegimeRepo = new MarketRegimeRepo(db2);
    const portfolioRepo = new PortfolioRepo(db2);
    const pricesRepo = new PricesRepo(db2);
    const watchlistRepo = new WatchlistRepo(db2);
    const positionsRepo = new PositionsRepo(db2);
    const deps = {
      strategicPlansRepo,
      planTranchesRepo,
      signalSnapshotsRepo,
      marketRegimeRepo,
      portfolioRepo,
      pricesRepo,
      getSettings
    };
    const regime = getCurrentRegime(marketRegimeRepo);
    summary.regime = regime;
    if (regime === "RISK_OFF" && settings.execution.requireRegimeCheck) {
      runsRepo.setSkipped(runId, "RISK_OFF regime - no new ACCUMULATE plans");
      runsRepo.updateSummary(runId, JSON.stringify(summary));
      return summary;
    }
    const portfolio = portfolioRepo.read();
    if (!portfolio) {
      runsRepo.setSkipped(runId, "no portfolio found");
      return summary;
    }
    const watchlist = watchlistRepo.list().filter((w) => w.enabled);
    const positions = positionsRepo.list();
    summary.watchlistCount = watchlist.length;
    summary.positionsCount = positions.length;
    summary.existingActivePlans = strategicPlansRepo.listActive().length;
    for (const item of watchlist) {
      const existingPlan = strategicPlansRepo.getActiveBySymbol(item.symbol);
      if (existingPlan) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: "active plan exists" });
        continue;
      }
      const signal = signalSnapshotsRepo.getLatest(item.symbol);
      if (!signal) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: "no signal data" });
        continue;
      }
      const score = signal.compositeEwma ?? signal.compositeScore;
      if (score === null) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: "no composite score" });
        continue;
      }
      if (score < settings.signals.buyThreshold) {
        summary.plansSkipped.push({
          symbol: item.symbol,
          reason: `score ${score.toFixed(2)} < threshold ${settings.signals.buyThreshold}`
        });
        continue;
      }
      const price = pricesRepo.getLatest(item.symbol);
      if (!price) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: "no price data" });
        continue;
      }
      const conviction = Math.min(1, (score - settings.signals.buyThreshold) / (1 - settings.signals.buyThreshold));
      const allocation = computeTargetAllocation(
        portfolio.cashCents,
        price.adjCloseCents,
        conviction,
        settings.risk.maxPositionWeightPercent
      );
      if (allocation.targetShares !== void 0 && allocation.targetShares < 1) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: "allocation too small (< 1 share)" });
        continue;
      }
      if (allocation.targetBudgetCents !== void 0 && allocation.targetBudgetCents < price.adjCloseCents) {
        summary.plansSkipped.push({ symbol: item.symbol, reason: "budget insufficient for 1 share" });
        continue;
      }
      createPlan(deps, {
        symbol: item.symbol,
        direction: "ACCUMULATE",
        targetShares: allocation.targetShares,
        targetBudgetCents: allocation.targetBudgetCents,
        entryCompositeScore: score,
        conviction
      });
      summary.plansCreated++;
    }
    for (const position of positions) {
      const existingPlan = strategicPlansRepo.getActiveBySymbol(position.symbol);
      if (existingPlan) {
        continue;
      }
      const signal = signalSnapshotsRepo.getLatest(position.symbol);
      if (!signal) {
        summary.plansSkipped.push({ symbol: position.symbol, reason: "position: no signal data" });
        continue;
      }
      const score = signal.compositeEwma ?? signal.compositeScore;
      if (score === null) {
        summary.plansSkipped.push({ symbol: position.symbol, reason: "position: no composite score" });
        continue;
      }
      if (score > settings.signals.sellThreshold) {
        summary.plansSkipped.push({
          symbol: position.symbol,
          reason: `position: score ${score.toFixed(2)} > sell threshold ${settings.signals.sellThreshold}`
        });
        continue;
      }
      const price = pricesRepo.getLatest(position.symbol);
      if (!price) {
        summary.plansSkipped.push({ symbol: position.symbol, reason: "position: no price data" });
        continue;
      }
      const conviction = Math.min(1, (settings.signals.sellThreshold - score) / settings.signals.sellThreshold);
      createPlan(deps, {
        symbol: position.symbol,
        direction: "TRIM",
        targetShares: position.qty,
        entryCompositeScore: score,
        conviction
      });
      summary.trimPlansCreated++;
    }
    if (settings.watchlist.pruning.enabled) {
      const { scoreThreshold, consecutiveDaysBelow } = settings.watchlist.pruning;
      const positionSymbols = new Set(positions.map((p) => p.symbol));
      const activeplanSymbols = new Set(strategicPlansRepo.listActive().map((p) => p.symbol));
      for (const item of watchlist) {
        if (positionSymbols.has(item.symbol)) continue;
        if (activeplanSymbols.has(item.symbol)) continue;
        const snapshots = signalSnapshotsRepo.getRecentSnapshots(item.symbol, consecutiveDaysBelow);
        if (snapshots.length < consecutiveDaysBelow) continue;
        const allBelowThreshold = snapshots.every((s) => {
          const score = s.compositeEwma ?? s.compositeScore;
          return score !== null && score < scoreThreshold;
        });
        if (allBelowThreshold) {
          watchlistRepo.removeSymbol(item.symbol);
          summary.symbolsPruned.push(item.symbol);
          log25.info("pruned watchlist symbol", {
            symbol: item.symbol,
            reason: `score below ${scoreThreshold} for ${consecutiveDaysBelow} consecutive days`
          });
        }
      }
    }
    runsRepo.updateStatus(runId, "succeeded");
    runsRepo.updateSummary(runId, JSON.stringify(summary));
    log25.info("plan review job complete", { ...summary });
    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, "failed", err instanceof Error ? err.message : String(err));
    log25.error("plan review job failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// src/scheduler/jobs/weeklyPlanner.ts
var log26 = logger.child({ component: "weekly-planner-job" });
async function runWeeklyPlannerJob(db2) {
  try {
    const summary = await runPlanReviewJob(db2, "plan_review");
    log26.info("weekly planner job complete", { ...summary });
  } catch (err) {
    log26.error("weekly planner job failed", { error: err instanceof Error ? err.message : String(err) });
  }
}

// src/scheduler/jobs/trancheExecutor.ts
init_logger();

// src/repos/ordersRepo.ts
var OrdersRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(order) {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO orders (id, client_order_id, decision_id, run_id, broker, broker_order_id, mode, symbol, side, qty, type, limit_price_cents, tif, status, reject_reason, submitted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      order.clientOrderId,
      order.decisionId,
      order.runId,
      order.broker,
      order.brokerOrderId,
      order.mode,
      order.symbol,
      order.side,
      order.qty,
      order.type,
      order.limitPriceCents,
      order.tif,
      order.status,
      order.rejectReason,
      order.submittedAt,
      order.submittedAt
    );
    return id;
  }
  get(id) {
    return this.db.prepare(
      `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE id = ?`
    ).get(id);
  }
  getByClientOrderId(clientOrderId) {
    return this.db.prepare(
      `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE client_order_id = ?`
    ).get(clientOrderId);
  }
  listByRun(runId) {
    return this.db.prepare(
      `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE run_id = ? ORDER BY submitted_at`
    ).all(runId);
  }
  updateStatus(id, status, brokerOrderId, rejectReason) {
    this.db.prepare(
      `UPDATE orders SET status = ?, broker_order_id = ?, reject_reason = ?, updated_at = ? WHERE id = ?`
    ).run(status, brokerOrderId || null, rejectReason || null, Date.now(), id);
  }
  updateRunContext(id, decisionId, runId) {
    this.db.prepare(`UPDATE orders SET decision_id = ?, run_id = ?, updated_at = ? WHERE id = ?`).run(decisionId, runId, Date.now(), id);
  }
  listPending(symbol) {
    if (symbol) {
      return this.db.prepare(
        `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                  broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                  limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                  submitted_at as submittedAt, updated_at as updatedAt
           FROM orders WHERE status IN ('pending', 'accepted', 'partially_filled') AND symbol = ? ORDER BY submitted_at`
      ).all(symbol);
    }
    return this.db.prepare(
      `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE status IN ('pending', 'accepted', 'partially_filled') ORDER BY submitted_at`
    ).all();
  }
  list(filter) {
    let sql = `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                      broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                      limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                      submitted_at as submittedAt, updated_at as updatedAt
               FROM orders WHERE 1=1`;
    const params = [];
    if (filter?.status && filter.status.length > 0) {
      const placeholders = filter.status.map(() => "?").join(",");
      sql += ` AND status IN (${placeholders})`;
      params.push(...filter.status);
    }
    if (filter?.since !== void 0) {
      sql += ` AND submitted_at >= ?`;
      params.push(filter.since);
    }
    sql += ` ORDER BY submitted_at DESC`;
    return this.db.prepare(sql).all(...params);
  }
};

// src/scheduler/jobs/trancheExecutor.ts
var log27 = logger.child({ component: "tranche-executor-job" });
async function runTrancheExecutorJob(db2, trigger = "tranche_execution") {
  const settings = getSettings();
  const runsRepo = new RunsRepo(db2);
  const summary = {
    regime: "UNKNOWN",
    activePlans: 0,
    tranchesExecuted: 0,
    tranchesSkipped: [],
    plansPaused: 0,
    plansResumed: 0,
    plansCancelled: 0,
    autoTrimPlans: 0,
    autoHedgePlan: null
  };
  const runId = runsRepo.create({
    trigger,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null
  });
  try {
    if (!settings.execution.enabled) {
      runsRepo.setSkipped(runId, "execution disabled");
      return summary;
    }
    const signalSnapshotsRepo = new SignalSnapshotsRepo(db2);
    const strategicPlansRepo = new StrategicPlansRepo(db2);
    const planTranchesRepo = new PlanTranchesRepo(db2);
    const marketRegimeRepo = new MarketRegimeRepo(db2);
    const portfolioRepo = new PortfolioRepo(db2);
    const pricesRepo = new PricesRepo(db2);
    const positionsRepo = new PositionsRepo(db2);
    const symbolCategoriesRepo = new SymbolCategoriesRepo(db2);
    const ordersRepo = new OrdersRepo(db2);
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    const broker = apiKey && apiSecret ? new AlpacaBroker({ apiKey, apiSecret, paperTrading: true }) : void 0;
    const deps = {
      strategicPlansRepo,
      planTranchesRepo,
      signalSnapshotsRepo,
      marketRegimeRepo,
      portfolioRepo,
      pricesRepo,
      positionsRepo,
      symbolCategoriesRepo,
      ordersRepo,
      broker,
      getSettings
    };
    summary.plansPaused = checkAndPausePlansForRegime(deps);
    summary.plansResumed = checkAndResumePlansForRegime(deps);
    const regime = getCurrentRegime(marketRegimeRepo);
    summary.regime = regime;
    if (regime === "RISK_OFF" && settings.hedging.autoTrimForCash) {
      const streak = marketRegimeRepo.getRegimeStreak("RISK_OFF");
      if (streak >= settings.hedging.minRiskOffStreak) {
        const trimResult = createAutoTrimPlans(deps);
        summary.autoTrimPlans = trimResult.trimPlansCreated;
      }
    }
    if (regime === "RISK_OFF" && settings.hedging.autoCreateHedgePlan) {
      const hedgeResult = maybeCreateAutoHedgePlan(deps);
      if (hedgeResult.hedgePlanCreated) {
        summary.autoHedgePlan = hedgeResult.symbol ?? null;
      }
    }
    summary.plansCancelled = checkAndCancelPlansForSignal(deps);
    const activePlans = strategicPlansRepo.listActive();
    summary.activePlans = activePlans.length;
    const portfolio = portfolioRepo.read();
    for (const plan of activePlans) {
      const { execute, reason } = shouldExecuteTranche(deps, plan);
      if (!execute) {
        summary.tranchesSkipped.push({
          symbol: plan.symbol,
          planId: plan.id,
          reason: reason || "unknown"
        });
        log27.debug("tranche skipped", { planId: plan.id, symbol: plan.symbol, reason });
        if (reason?.includes("cancel threshold")) {
          cancelPlan(deps, plan.id, reason);
          summary.plansCancelled++;
        }
        continue;
      }
      const price = pricesRepo.getLatest(plan.symbol);
      if (!price) {
        summary.tranchesSkipped.push({
          symbol: plan.symbol,
          planId: plan.id,
          reason: "no price available"
        });
        log27.warn("no price available", { symbol: plan.symbol });
        continue;
      }
      if (plan.direction === "ACCUMULATE") {
        const trancheValueCents = price.adjCloseCents * 10;
        const sectorCheck = await checkSectorExposure(deps, plan.symbol, trancheValueCents);
        if (!sectorCheck.allowed) {
          summary.tranchesSkipped.push({
            symbol: plan.symbol,
            planId: plan.id,
            reason: sectorCheck.reason || "sector exposure limit"
          });
          log27.info("tranche skipped due to sector exposure", { symbol: plan.symbol, reason: sectorCheck.reason });
          continue;
        }
      }
      const result = await executeTranche(
        deps,
        plan,
        price.adjCloseCents,
        portfolio?.cashCents
      );
      if (result) {
        summary.tranchesExecuted++;
      } else {
        summary.tranchesSkipped.push({
          symbol: plan.symbol,
          planId: plan.id,
          reason: "execution returned null"
        });
      }
    }
    runsRepo.updateStatus(runId, "succeeded");
    runsRepo.updateSummary(runId, JSON.stringify(summary));
    log27.info("tranche executor job complete", {
      activePlans: summary.activePlans,
      tranchesExecuted: summary.tranchesExecuted,
      tranchesSkipped: summary.tranchesSkipped.length
    });
    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, "failed", err instanceof Error ? err.message : String(err));
    log27.error("tranche executor job failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// src/scheduler/jobs/watchlistCurator.ts
init_logger();

// src/services/watchlistCurationService.ts
init_logger();
import { getLlmLimits } from "@atn-trd/shared";

// src/repos/screenerSelectionsRepo.ts
var ScreenerSelectionsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(selection) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db.prepare(
      `INSERT INTO screener_selections (id, run_id, symbol, rationale, conviction, selected_json, rejected_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      selection.runId,
      selection.symbol,
      selection.rationale,
      selection.conviction,
      selection.selectedJson,
      selection.rejectedJson,
      createdAt
    );
    return id;
  }
  get(id) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, rationale, conviction, selected_json as selectedJson,
                rejected_json as rejectedJson, created_at as createdAt
         FROM screener_selections WHERE id = ?`
    ).get(id);
  }
  listByRun(runId) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, rationale, conviction, selected_json as selectedJson,
                rejected_json as rejectedJson, created_at as createdAt
         FROM screener_selections WHERE run_id = ? ORDER BY symbol`
    ).all(runId);
  }
  getByRunAndSymbol(runId, symbol) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, rationale, conviction, selected_json as selectedJson,
                rejected_json as rejectedJson, created_at as createdAt
         FROM screener_selections WHERE run_id = ? AND symbol = ?`
    ).get(runId, symbol);
  }
};

// src/repos/artifactsRepo.ts
var ArtifactsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(artifact) {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO research_artifacts (id, run_id, symbol, source, provider, fetched_at, payload_json, summary, citations_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      artifact.runId,
      artifact.symbol,
      artifact.source,
      artifact.provider,
      artifact.fetchedAt,
      artifact.payloadJson,
      artifact.summary,
      artifact.citationsJson
    );
    return id;
  }
  get(id) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, source, provider, fetched_at as fetchedAt,
                payload_json as payloadJson, summary, citations_json as citationsJson
         FROM research_artifacts WHERE id = ?`
    ).get(id);
  }
  listByRun(runId) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, source, provider, fetched_at as fetchedAt,
                payload_json as payloadJson, summary, citations_json as citationsJson
         FROM research_artifacts WHERE run_id = ? ORDER BY fetched_at`
    ).all(runId);
  }
  listByRunAndSymbol(runId, symbol) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, source, provider, fetched_at as fetchedAt,
                payload_json as payloadJson, summary, citations_json as citationsJson
         FROM research_artifacts WHERE run_id = ? AND symbol = ? ORDER BY fetched_at`
    ).all(runId, symbol);
  }
};

// src/repos/agentMessagesRepo.ts
var AgentMessagesRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(message) {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO agent_messages (id, run_id, symbol, seq, role, content, tool_name, tool_args_json, tool_result_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      message.runId,
      message.symbol,
      message.seq,
      message.role,
      message.content,
      message.toolName,
      message.toolArgsJson,
      message.toolResultJson,
      message.createdAt
    );
    return id;
  }
  get(id) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, seq, role, content, tool_name as toolName,
                tool_args_json as toolArgsJson, tool_result_json as toolResultJson, created_at as createdAt
         FROM agent_messages WHERE id = ?`
    ).get(id);
  }
  listByRun(runId) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, seq, role, content, tool_name as toolName,
                tool_args_json as toolArgsJson, tool_result_json as toolResultJson, created_at as createdAt
         FROM agent_messages WHERE run_id = ? ORDER BY seq`
    ).all(runId);
  }
  listByRunAndSymbol(runId, symbol) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, seq, role, content, tool_name as toolName,
                tool_args_json as toolArgsJson, tool_result_json as toolResultJson, created_at as createdAt
         FROM agent_messages WHERE run_id = ? AND symbol = ? ORDER BY seq`
    ).all(runId, symbol);
  }
  countByRun(runId) {
    const result = this.db.prepare("SELECT COUNT(*) as count FROM agent_messages WHERE run_id = ?").get(runId);
    return result.count;
  }
};

// src/repos/decisionsRepo.ts
var DecisionsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(decision) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db.prepare(
      `INSERT INTO decisions (id, run_id, symbol, action, target_weight, confidence, rationale, assessment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      decision.runId,
      decision.symbol,
      decision.action,
      decision.targetWeight,
      decision.confidence,
      decision.rationale,
      decision.assessmentId,
      createdAt
    );
    return id;
  }
  get(id) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE id = ?`
    ).get(id);
  }
  listByRun(runId) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE run_id = ? ORDER BY symbol`
    ).all(runId);
  }
  listByRunAndSymbol(runId, symbol) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE run_id = ? AND symbol = ? ORDER BY created_at`
    ).all(runId, symbol);
  }
  countByRun(runId) {
    const result = this.db.prepare("SELECT COUNT(*) as count FROM decisions WHERE run_id = ?").get(runId);
    return result.count;
  }
  listBySymbol(symbol, limit) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`
    ).all(symbol, limit);
  }
};

// src/agent/screenerAgent.ts
import { z as z3 } from "zod";
import { HumanMessage as HumanMessage3, SystemMessage as SystemMessage3 } from "@langchain/core/messages";

// src/llm/prompts/screener.ts
var SCREENER_SYSTEM_PROMPT = `You are a quantitative equity screener for a daily automated trading system.

Your role is to identify the most promising candidates from a pre-filtered universe of quality stocks.

**Screening Framework:**

1. **Sector Momentum** - Prioritize stocks in sectors with strong momentum and positive trends
2. **Earnings Catalysts** - Look for upcoming earnings, positive estimate revisions, earnings surprises
3. **Options Sentiment** - Bullish put/call ratios, unusual call volume, reasonable IV levels
4. **Multiple Signals** - Prioritize names with sector + earnings + options aligned

**Output Requirements:**

Analyze the provided data and return your selections as a JSON array. Each element should have:
- "symbol": stock ticker
- "rationale": 1-2 sentence investment rationale citing specific data points
- "conviction": number 0-1 based on signal strength

Return 3-8 selections ranked by conviction. Respond ONLY with the JSON array, no markdown or explanation.`;

// src/agent/runCollector.ts
init_logger();
var TOOL_ARTIFACT_MAP = {
  get_price_history: { source: "prices", provider: "yahoo" },
  get_fundamentals: { source: "fundamentals", provider: "yahoo" },
  get_news: { source: "news", provider: "yahoo" },
  // TODO(step-26): confirm provider
  get_macro: { source: "macro", provider: "fred" },
  get_options_snapshot: { source: "options", provider: "yahoo" },
  // TODO(step-26): confirm provider
  get_portfolio: null,
  get_prior_decisions: null
};
function chunkText(chunk) {
  if (!chunk || typeof chunk !== "object") return "";
  const c = chunk.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c.map(
      (item) => typeof item === "string" ? item : item.text ?? ""
    ).join("");
  }
  return "";
}
function extractToolContent(output) {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object") return safeStringify(output);
  const obj = output;
  if (typeof obj.content === "string") return obj.content;
  if (obj.kwargs && typeof obj.kwargs === "object") {
    const kwargs = obj.kwargs;
    if (typeof kwargs.content === "string") return kwargs.content;
  }
  return safeStringify(output);
}
function safeStringify(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '"[serialization error]"';
  }
}
var log28 = logger.child({ component: "run-collector" });
var RunCollector = class {
  constructor(runId, symbol, messagesRepo, artifactsRepo) {
    this.runId = runId;
    this.symbol = symbol;
    this.messagesRepo = messagesRepo;
    this.artifactsRepo = artifactsRepo;
  }
  runId;
  symbol;
  messagesRepo;
  artifactsRepo;
  seq = 0;
  modelBuffers = /* @__PURE__ */ new Map();
  pendingTools = /* @__PURE__ */ new Map();
  writeInitialMessages(messages) {
    try {
      for (const message of messages) {
        this.messagesRepo.create({
          runId: this.runId,
          symbol: this.symbol,
          seq: this.seq++,
          role: message.role,
          content: message.content,
          toolName: null,
          toolArgsJson: null,
          toolResultJson: null,
          createdAt: Date.now()
        });
      }
    } catch (err) {
      log28.error("failed to write initial messages", {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  handleEvent(event) {
    try {
      switch (event.event) {
        case "on_chat_model_start":
          this.modelBuffers.set(event.run_id, "");
          break;
        case "on_chat_model_stream": {
          const text = chunkText(event.data?.chunk);
          if (!this.modelBuffers.has(event.run_id)) {
            this.modelBuffers.set(event.run_id, "");
          }
          this.modelBuffers.set(event.run_id, (this.modelBuffers.get(event.run_id) ?? "") + text);
          break;
        }
        case "on_chat_model_end": {
          const buffer = this.modelBuffers.get(event.run_id);
          this.modelBuffers.delete(event.run_id);
          const content = (buffer ?? "").trim();
          if (content) {
            const createdAt = Date.now();
            this.messagesRepo.create({
              runId: this.runId,
              symbol: this.symbol,
              seq: this.seq++,
              role: "ai",
              content,
              toolName: null,
              toolArgsJson: null,
              toolResultJson: null,
              createdAt
            });
          }
          break;
        }
        case "on_tool_start": {
          const pending = {
            toolName: event.name,
            toolArgsJson: safeStringify(event.data?.input ?? {}),
            seq: this.seq++,
            startedAt: Date.now()
          };
          this.pendingTools.set(event.run_id, pending);
          break;
        }
        case "on_tool_end": {
          const pending = this.pendingTools.get(event.run_id);
          if (!pending) {
            log28.warn("orphaned tool_end event", { runId: event.run_id, toolName: event.name });
            return;
          }
          const rawOutput = event.data?.output;
          const toolContent = extractToolContent(rawOutput);
          const toolResultJson = safeStringify(rawOutput);
          this.messagesRepo.create({
            runId: this.runId,
            symbol: this.symbol,
            seq: pending.seq,
            role: "tool",
            content: pending.toolName,
            toolName: pending.toolName,
            toolArgsJson: pending.toolArgsJson,
            toolResultJson,
            createdAt: pending.startedAt
          });
          this.pendingTools.delete(event.run_id);
          this.writeArtifact(pending.toolName, toolContent, pending.startedAt);
          break;
        }
      }
    } catch (err) {
      log28.error("failed to handle event", {
        event: event.event,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
  writeArtifact(toolName, toolResultJson, fetchedAt) {
    try {
      const meta = TOOL_ARTIFACT_MAP[toolName];
      if (!meta) {
        return;
      }
      this.artifactsRepo.create({
        runId: this.runId,
        symbol: this.symbol,
        source: meta.source,
        provider: meta.provider,
        fetchedAt,
        payloadJson: toolResultJson,
        summary: null,
        citationsJson: null
      });
    } catch (err) {
      log28.warn("failed to write artifact", {
        toolName,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }
};

// src/agent/screenerAgent.ts
init_logger();

// src/services/runProgress.ts
import { EventEmitter as EventEmitter2 } from "events";
var RunProgressEmitter = class extends EventEmitter2 {
  emit(event, data) {
    return super.emit(event, data);
  }
  on(event, listener) {
    return super.on(event, listener);
  }
  off(event, listener) {
    return super.off(event, listener);
  }
};
var runProgress = new RunProgressEmitter();
function emitProgress(runId, phase, message, extra) {
  runProgress.emit("progress", {
    runId,
    phase,
    message,
    timestamp: Date.now(),
    ...extra
  });
}

// src/agent/screenerAgent.ts
var log29 = logger.child({ component: "screener-agent" });
var SelectionSchema = z3.object({
  symbol: z3.string(),
  rationale: z3.string(),
  conviction: z3.number().min(0).max(1)
});
async function fetchAllData(symbols, deps) {
  const sectors = await deps.cache.getOrFetch(
    "sector_performance_all",
    18e5,
    () => deps.sectorSource.fetch()
  ).catch(() => []);
  const candidates = [];
  const batchSize = 10;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (symbol) => {
        const [fundamentals, options] = await Promise.all([
          deps.cache.getOrFetch(
            `earnings:${symbol}`,
            18e5,
            () => deps.fundamentalsSource.fetch({ symbol })
          ).catch(() => null),
          deps.cache.getOrFetch(
            `options:${symbol}`,
            18e5,
            () => deps.optionsSource.fetch({ symbol })
          ).catch(() => null)
        ]);
        return {
          symbol,
          fundamentals: fundamentals?.data ? {
            pe: fundamentals.data.trailingPE,
            marketCap: fundamentals.data.marketCap,
            sector: fundamentals.data.sector
          } : void 0,
          options: options?.data?.metrics ? {
            putCallRatio: options.data.metrics.putCallVolumeRatio,
            ivSkew: options.data.metrics.ivSkew
          } : void 0
        };
      })
    );
    candidates.push(...results);
  }
  return { sectors, candidates };
}
function formatDataForPrompt(sectors, candidates) {
  let output = "## Sector Performance\n";
  for (const s of sectors.slice(0, 11)) {
    output += `${s.sector}: ${s.dayChangePercent > 0 ? "+" : ""}${s.dayChangePercent?.toFixed(1)}% today, ${s.weekChangePercent > 0 ? "+" : ""}${s.weekChangePercent?.toFixed(1)}% week
`;
  }
  output += "\n## Candidates\n";
  for (const c of candidates) {
    const parts = [c.symbol];
    if (c.fundamentals?.sector) parts.push(`sector:${c.fundamentals.sector}`);
    if (c.fundamentals?.pe) parts.push(`PE:${c.fundamentals.pe.toFixed(1)}`);
    if (c.options?.putCallRatio) parts.push(`P/C:${c.options.putCallRatio.toFixed(2)}`);
    if (c.options?.ivSkew) parts.push(`IVSkew:${c.options.ivSkew.toFixed(2)}`);
    output += parts.join(" | ") + "\n";
  }
  return output;
}
async function runScreenerAgent(runId, candidates, deps, _config) {
  if (candidates.length === 0) {
    log29.debug("no candidates to screen");
    return [];
  }
  const symbols = candidates.map((c) => c.symbol);
  const collector = new RunCollector(runId, "screener", deps.messagesRepo, deps.artifactsRepo);
  try {
    emitProgress(runId, "screener", `Fetching data for ${symbols.length} candidates...`, {});
    log29.debug("fetching data for candidates", { count: symbols.length });
    const { sectors, candidates: candidateData } = await fetchAllData(symbols, deps.toolsDeps);
    log29.debug("data fetched", { sectors: sectors.length, candidates: candidateData.length });
    const dataBlock = formatDataForPrompt(sectors, candidateData);
    const humanContent = `Screen these candidates and select the best 3-8 for investment:

${dataBlock}`;
    collector.writeInitialMessages([
      { role: "system", content: SCREENER_SYSTEM_PROMPT },
      { role: "human", content: humanContent }
    ]);
    emitProgress(runId, "screener", "Analyzing candidates...", {});
    const llm = getSynthesisLlm();
    const response = await llm.invoke([
      new SystemMessage3(SCREENER_SYSTEM_PROMPT),
      new HumanMessage3(humanContent)
    ]);
    const content = typeof response.content === "string" ? response.content : Array.isArray(response.content) ? response.content.map((c) => typeof c === "string" ? c : c.text ?? "").join("") : "";
    deps.messagesRepo.create({
      runId,
      symbol: "screener",
      seq: 2,
      role: "ai",
      content,
      toolName: null,
      toolArgsJson: null,
      toolResultJson: null,
      createdAt: Date.now()
    });
    let jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
    let raw;
    if (jsonMatch) {
      raw = JSON.parse(jsonMatch[1].trim());
    } else {
      jsonMatch = content.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (!jsonMatch) {
        log29.warn("no JSON array found in response", { content: content.slice(0, 200) });
        return null;
      }
      raw = JSON.parse(jsonMatch[0]);
    }
    const parsed = z3.array(SelectionSchema).parse(raw);
    log29.debug("screening complete", { selections: parsed.length });
    return parsed;
  } catch (err) {
    log29.warn("screener agent failed", { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

// src/services/preFilterService.ts
init_logger();

// src/config/universeLoader.ts
init_logger();
import { readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath as fileURLToPath3 } from "url";
import { dirname } from "path";
var log30 = logger.child({ component: "universe-loader" });
var __dirname3 = dirname(fileURLToPath3(import.meta.url));
var cachedUniverse = null;
function loadUniverse() {
  if (cachedUniverse) {
    return cachedUniverse;
  }
  try {
    const sp500 = JSON.parse(
      readFileSync(join(__dirname3, "universe", "sp500.json"), "utf-8")
    );
    const nasdaq100 = JSON.parse(
      readFileSync(join(__dirname3, "universe", "nasdaq100.json"), "utf-8")
    );
    const russell2000 = JSON.parse(
      readFileSync(join(__dirname3, "universe", "russell2000.json"), "utf-8")
    );
    const tech = JSON.parse(
      readFileSync(join(__dirname3, "universe", "tech.json"), "utf-8")
    );
    const healthcare = JSON.parse(
      readFileSync(join(__dirname3, "universe", "healthcare.json"), "utf-8")
    );
    const commodity = JSON.parse(
      readFileSync(join(__dirname3, "universe", "commodity.json"), "utf-8")
    );
    const crypto2 = JSON.parse(
      readFileSync(join(__dirname3, "universe", "crypto.json"), "utf-8")
    );
    cachedUniverse = { sp500, nasdaq100, russell2000, tech, healthcare, commodity, crypto: crypto2 };
    log30.debug("loaded universes", {
      sp500Count: sp500.length,
      nasdaq100Count: nasdaq100.length,
      russell2000Count: russell2000.length,
      techCount: tech.length,
      healthcareCount: healthcare.length,
      commodityCount: commodity.length,
      cryptoCount: crypto2.length
    });
    return cachedUniverse;
  } catch (err) {
    log30.error("failed to load universe", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
function getUniverse(types, customSymbols) {
  const universe = loadUniverse();
  const merged = /* @__PURE__ */ new Set();
  for (const type of types) {
    if (type === "custom") {
      (customSymbols || []).forEach((s) => merged.add(s));
    } else {
      (universe[type] || []).forEach((s) => merged.add(s));
    }
  }
  return Array.from(merged);
}

// src/lib/concurrency.ts
async function runWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// src/services/preFilterService.ts
var log31 = logger.child({ component: "pre-filter" });
var PREFILTER_CONCURRENCY = 5;
async function runPreFilter(config, deps, runId) {
  const symbols = getUniverse(config.universes, config.customSymbols);
  log31.debug("loaded universe", { universes: config.universes, count: symbols.length });
  if (symbols.length === 0) {
    log31.warn("empty universe");
    return { candidates: [], rejected: [] };
  }
  const rejected = [];
  let processed = 0;
  const fundamentalsResults = await runWithConcurrency(
    symbols,
    PREFILTER_CONCURRENCY,
    async (symbol) => {
      try {
        const result = await deps.fundamentalsSource.fetch({ symbol });
        processed++;
        if (runId && processed % 10 === 0) {
          emitProgress(runId, "screener", `Fetching fundamentals... ${processed}/${symbols.length}`, { symbol });
        }
        return { symbol, fundamentals: result.data };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        rejected.push({ symbol, reason });
        log31.debug("fundamentals fetch failed", { symbol, reason });
        processed++;
        return null;
      }
    }
  );
  const withFundamentals = fundamentalsResults.filter(
    (r) => r !== null
  );
  log31.debug("fetched fundamentals", {
    total: symbols.length,
    success: withFundamentals.length,
    failed: rejected.length
  });
  const filtered = withFundamentals.filter((item) => {
    const { symbol, fundamentals } = item;
    const f = fundamentals;
    if (f.price === null || f.price < config.minPrice || f.price > config.maxPrice) {
      rejected.push({
        symbol,
        reason: `price=${f.price} outside range [${config.minPrice}, ${config.maxPrice}]`
      });
      return false;
    }
    if (f.averageVolume === null || f.averageVolume < config.minVolume) {
      rejected.push({
        symbol,
        reason: `averageVolume=${f.averageVolume} below ${config.minVolume}`
      });
      return false;
    }
    if (config.minMarketCap > 0) {
      if (f.marketCap === null || f.marketCap < config.minMarketCap) {
        rejected.push({
          symbol,
          reason: `marketCap=${f.marketCap} below ${config.minMarketCap}`
        });
        return false;
      }
    }
    return true;
  });
  log31.debug("applied quantitative filters", {
    before: withFundamentals.length,
    after: filtered.length
  });
  const sorted = filtered.sort((a, b) => {
    const capA = a.fundamentals.marketCap ?? 0;
    const capB = b.fundamentals.marketCap ?? 0;
    return capB - capA;
  });
  const candidates = sorted.slice(0, config.maxCandidates);
  log31.debug("pre-filter complete", {
    candidates: candidates.length,
    rejected: rejected.length
  });
  return { candidates, rejected };
}

// src/services/screenerOrchestrationService.ts
init_logger();
var log32 = logger.child({ component: "screener-orchestration" });
async function runScreener(runId, settings, deps) {
  try {
    if (!settings.screener?.enabled) {
      log32.debug("screener is disabled");
      return null;
    }
    if (settings.watchlist?.mode !== "dynamic") {
      log32.debug("watchlist is not in dynamic mode");
      return null;
    }
    const dynamicConfig = settings.watchlist.dynamic;
    if (!dynamicConfig) {
      log32.debug("no dynamic config");
      return null;
    }
    emitProgress(runId, "screener", "Pre-filtering universe...", {});
    const preFilterConfig = {
      universes: dynamicConfig.universes,
      customSymbols: dynamicConfig.customSymbols,
      maxCandidates: dynamicConfig.maxCandidates,
      minPrice: dynamicConfig.minPrice,
      maxPrice: dynamicConfig.maxPrice,
      minVolume: dynamicConfig.minVolume,
      minMarketCap: dynamicConfig.minMarketCap
    };
    const preFilterResult = await runPreFilter(preFilterConfig, deps.toolsDeps, runId);
    if (preFilterResult.candidates.length === 0) {
      log32.warn("pre-filter returned zero candidates");
      return null;
    }
    log32.debug("pre-filter complete", {
      candidates: preFilterResult.candidates.length,
      rejected: preFilterResult.rejected.length
    });
    emitProgress(runId, "screener", `Screening ${preFilterResult.candidates.length} candidates...`, {});
    const candidateList = preFilterResult.candidates.map((c) => ({ symbol: c.symbol }));
    const selections = await runScreenerAgent(
      runId,
      candidateList,
      deps.screenerAgentDeps,
      {
        model: settings.llm.agents?.screener?.model || void 0,
        temperature: settings.llm.temperature
      }
    );
    if (!selections || selections.length === 0) {
      log32.warn("screener agent returned no selections");
      return null;
    }
    log32.debug("screener agent complete", { selections: selections.length });
    emitProgress(runId, "screener", `Persisting ${selections.length} selections...`, {});
    for (const selection of selections) {
      const selectedJson = JSON.stringify({
        fundamentals: preFilterResult.candidates.find((c) => c.symbol === selection.symbol)?.fundamentals
      });
      deps.screenerSelectionsRepo.create({
        runId,
        symbol: selection.symbol,
        rationale: selection.rationale,
        conviction: selection.conviction,
        selectedJson,
        rejectedJson: JSON.stringify(
          preFilterResult.rejected.filter((r) => r.symbol === selection.symbol)
        )
      });
    }
    log32.debug("persisted selections", { count: selections.length });
    return {
      selections,
      candidates: preFilterResult.candidates
    };
  } catch (err) {
    log32.error("screener orchestration failed", {
      runId,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

// src/datasources/sectors/sectorPerformance.ts
init_logger();
var log33 = logger.child({ component: "sector-performance" });
var HEALTH_CHECK_SYMBOL2 = "XLK";
var SECTOR_ETF_MAP = {
  "Technology": "XLK",
  "Financials": "XLF",
  "Energy": "XLE",
  "Healthcare": "XLV",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  "Industrials": "XLI",
  "Materials": "XLB",
  "Real Estate": "XLRE",
  "Utilities": "XLU",
  "Communication Services": "XLC"
};
var SECTOR_ETFS = Object.values(SECTOR_ETF_MAP);
var SectorPerformanceDataSource = class extends BaseDataSource {
  name = "Sector Performance";
  kind = "prices";
  provider = "finnhub";
  pricesRepo;
  constructor(options) {
    super();
    this.pricesRepo = options.pricesRepo;
  }
  async probe() {
    const bars = this.pricesRepo.listBySymbol(HEALTH_CHECK_SYMBOL2, 7);
    if (bars.length === 0) {
      throw new Error(`No cached price bars for ${HEALTH_CHECK_SYMBOL2}. Run price backfill first.`);
    }
    return `Found ${bars.length} cached bars for ${HEALTH_CHECK_SYMBOL2}`;
  }
  async fetch() {
    const results = [];
    for (const [sector, etfSymbol] of Object.entries(SECTOR_ETF_MAP)) {
      const bars = this.pricesRepo.listBySymbol(etfSymbol, 90);
      if (bars.length === 0) {
        log33.warn("no cached price data for sector etf", { etfSymbol, sector });
        continue;
      }
      const priceData = bars.map((b) => ({
        date: new Date(b.barDate).getTime(),
        close: b.closeCents / 100
      }));
      results.push({
        sector,
        etfSymbol,
        return1d: this.calculateReturn(priceData, 1),
        return1w: this.calculateReturn(priceData, 7),
        return1m: this.calculateReturn(priceData, 30),
        return3m: this.calculateReturn(priceData, 90),
        avgPE: null,
        avgVolatility: null
      });
    }
    log33.info("sector performance fetched", { sectorCount: results.length });
    return results;
  }
  calculateReturn(priceData, days) {
    if (priceData.length < 2) return 0;
    const cutoffTime = Date.now() - days * 86400 * 1e3;
    let startPrice = priceData[0].close;
    for (const p of priceData) {
      if (p.date <= cutoffTime) {
        startPrice = p.close;
      }
    }
    const endPrice = priceData[priceData.length - 1].close;
    const ret = (endPrice - startPrice) / startPrice * 100;
    return Math.round(ret * 100) / 100;
  }
};

// src/datasources/cache.ts
var RunCache = class {
  store = /* @__PURE__ */ new Map();
  inflight = /* @__PURE__ */ new Map();
  /**
   * Get a value from cache or fetch it if missing/expired.
   * Deduplicates concurrent requests for the same key.
   *
   * @param key Cache key
   * @param ttlMs Time to live in milliseconds
   * @param fetch Function that returns the value if not cached
   * @returns The cached or freshly fetched value
   */
  async getOrFetch(key, ttlMs, fetch2) {
    const now = Date.now();
    const entry = this.store.get(key);
    if (entry && entry.expiresAt > now) {
      return entry.value;
    }
    const existing = this.inflight.get(key);
    if (existing) {
      return existing;
    }
    const promise = fetch2().then((value) => {
      this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
      this.inflight.delete(key);
      return value;
    }).catch((err) => {
      this.inflight.delete(key);
      throw err;
    });
    this.inflight.set(key, promise);
    return promise;
  }
};

// src/services/watchlistCurationService.ts
var log34 = logger.child({ component: "watchlist-curation" });
function classifySymbol(dividendYield, dividendGrowthRate) {
  const yld = dividendYield ?? 0;
  const growth = dividendGrowthRate ?? 0;
  if (yld > 0.04) return "INCOME_BOOSTER";
  if (yld > 0.01 && growth > 0.05) return "DIVIDEND_GROWTH";
  return "GROWTH_CORE";
}
async function runWatchlistCuration(db2) {
  const settings = getSettings();
  const runsRepo = new RunsRepo(db2);
  const summary = {
    symbolsAdded: [],
    symbolsUpdated: [],
    totalInWatchlist: 0,
    screenerSelections: 0
  };
  const runId = runsRepo.create({
    trigger: "watchlist_curation",
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    model: settings.llm.model,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null
  });
  try {
    if (settings.watchlist.mode !== "dynamic") {
      runsRepo.setSkipped(runId, "watchlist not in dynamic mode");
      return summary;
    }
    const pricesRepo = new PricesRepo(db2);
    const screenerSelectionsRepo = new ScreenerSelectionsRepo(db2);
    const messagesRepo = new AgentMessagesRepo(db2);
    const artifactsRepo = new ArtifactsRepo(db2);
    const decisionsRepo = new DecisionsRepo(db2);
    const positionsRepo = new PositionsRepo(db2);
    const portfolioRepo = new PortfolioRepo(db2);
    const watchlistRepo = new WatchlistRepo(db2);
    const symbolCategoriesRepo = new SymbolCategoriesRepo(db2);
    const runCache = new RunCache();
    const sectorSource = new SectorPerformanceDataSource({ pricesRepo });
    const priceService = new PriceService(pricesRepo);
    const portfolioService = new PortfolioServiceImpl(db2, priceService, positionsRepo, portfolioRepo);
    const toolsDeps = {
      newsSource: dataSourceRegistry.get("news"),
      fundamentalsSource: dataSourceRegistry.get("fundamentals"),
      macroSource: dataSourceRegistry.get("macro"),
      optionsSource: dataSourceRegistry.get("options"),
      sectorSource,
      pricesRepo,
      portfolioService,
      decisionsRepo,
      cache: runCache,
      llmLimits: getLlmLimits(settings.llm.localLlmMode)
    };
    const screenerDeps = {
      screenerSelectionsRepo,
      screenerAgentDeps: {
        toolsDeps: {
          sectorSource,
          fundamentalsSource: dataSourceRegistry.get("fundamentals"),
          optionsSource: dataSourceRegistry.get("options"),
          cache: runCache
        },
        messagesRepo,
        artifactsRepo
      },
      toolsDeps
    };
    log34.info("running screener for watchlist curation");
    const result = await runScreener(runId, settings, screenerDeps);
    if (!result || result.selections.length === 0) {
      runsRepo.setSkipped(runId, "screener returned no selections");
      return summary;
    }
    summary.screenerSelections = result.selections.length;
    log34.info("screener complete", { selections: result.selections.length });
    const now = Date.now();
    for (const selection of result.selections) {
      const candidate = result.candidates.find((c) => c.symbol === selection.symbol);
      const fundamentals = candidate?.fundamentals;
      const dividendYield = fundamentals?.dividendYield ?? null;
      const category = classifySymbol(dividendYield, null);
      const existing = watchlistRepo.get(selection.symbol);
      if (!existing) {
        watchlistRepo.addSymbol(selection.symbol, selection.rationale);
        summary.symbolsAdded.push(selection.symbol);
      } else {
        summary.symbolsUpdated.push(selection.symbol);
      }
      symbolCategoriesRepo.upsert({
        symbol: selection.symbol,
        category,
        sector: fundamentals?.sector ?? null,
        yieldPercent: dividendYield ? dividendYield * 100 : null,
        dividendGrowthPercent: null,
        // Not available from fundamentals
        estCagrPercent: null,
        lastScreenedAt: now
      });
    }
    summary.totalInWatchlist = watchlistRepo.list().length;
    runsRepo.updateStatus(runId, "succeeded");
    runsRepo.updateSummary(runId, JSON.stringify(summary));
    log34.info("watchlist curation complete", { ...summary });
    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, "failed", err instanceof Error ? err.message : String(err));
    log34.error("watchlist curation failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
async function backfillSectors(db2) {
  const watchlistRepo = new WatchlistRepo(db2);
  const symbolCategoriesRepo = new SymbolCategoriesRepo(db2);
  const watchlist = watchlistRepo.list();
  const result = { updated: 0, errors: 0, symbols: [] };
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    log34.warn("FINNHUB_API_KEY not set, skipping sector backfill");
    return result;
  }
  for (const item of watchlist) {
    const existing = symbolCategoriesRepo.get(item.symbol);
    if (existing?.sector) continue;
    try {
      const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(item.symbol)}&token=${apiKey}`;
      const response = await fetch(url);
      if (!response.ok) {
        log34.warn("finnhub profile2 failed", { symbol: item.symbol, status: response.status });
        result.errors++;
        continue;
      }
      const data = await response.json();
      const sector = data.finnhubIndustry ?? null;
      if (sector) {
        if (existing) {
          symbolCategoriesRepo.upsert({ ...existing, sector });
        } else {
          symbolCategoriesRepo.upsert({
            symbol: item.symbol,
            category: "GROWTH_CORE",
            sector,
            yieldPercent: null,
            dividendGrowthPercent: null,
            estCagrPercent: null,
            lastScreenedAt: null
          });
        }
        result.updated++;
        result.symbols.push(item.symbol);
        log34.debug("sector backfilled", { symbol: item.symbol, sector });
      }
      await new Promise((r) => setTimeout(r, 1100));
    } catch (err) {
      log34.warn("sector backfill error", { symbol: item.symbol, error: err instanceof Error ? err.message : String(err) });
      result.errors++;
    }
  }
  log34.info("sector backfill complete", result);
  return result;
}

// src/scheduler/jobs/watchlistCurator.ts
var log35 = logger.child({ component: "watchlist-curator-job" });
async function runWatchlistCuratorJob(db2) {
  const settings = getSettings();
  if (settings.watchlist.mode !== "dynamic") {
    log35.debug("watchlist curator skipped (not in dynamic mode)");
    return;
  }
  if (!settings.watchlist.curatorCron) {
    log35.debug("watchlist curator skipped (no cron set)");
    return;
  }
  try {
    log35.info("starting scheduled watchlist curation");
    const summary = await runWatchlistCuration(db2);
    log35.info("scheduled watchlist curation complete", { ...summary });
  } catch (err) {
    log35.error("scheduled watchlist curation failed", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

// src/scheduler/jobs/priceBackfill.ts
init_logger();

// src/config/staticSymbols.ts
import { readFileSync as readFileSync2 } from "fs";
import { fileURLToPath as fileURLToPath4 } from "url";
import { dirname as dirname2, join as join2 } from "path";
var cached = null;
function loadConfig() {
  if (cached) return cached;
  const __dirname6 = dirname2(fileURLToPath4(import.meta.url));
  const configPath = join2(__dirname6, "staticSymbols.json");
  const content = readFileSync2(configPath, "utf-8");
  cached = JSON.parse(content);
  return cached;
}
function getStaticSymbols() {
  const config = loadConfig();
  return [...config.sectorETFs, ...config.benchmarks];
}

// src/scheduler/jobs/priceBackfill.ts
init_http();
var log36 = logger.child({ component: "price-backfill" });
var BACKFILL_DAYS = 120;
function createAlpacaClient() {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_API_SECRET;
  if (!apiKey || !apiSecret) {
    return null;
  }
  return new HttpClient({
    name: "alpaca-backfill",
    baseUrl: "https://data.alpaca.markets/v2/",
    defaultHeaders: {
      "APCA-API-KEY-ID": apiKey,
      "APCA-API-SECRET-KEY": apiSecret,
      accept: "application/json"
    },
    rateLimit: { capacity: 10, refillPerSecond: 3 },
    // Alpaca allows 200/min
    retry: { retries: 2, baseDelayMs: 500, maxDelayMs: 5e3 }
  });
}
async function backfillSymbol(symbol, pricesRepo, startDate, http) {
  const path8 = `stocks/${encodeURIComponent(symbol)}/bars?timeframe=1Day&start=${startDate}&limit=1000`;
  try {
    const result = await http.json(path8);
    if (!result.bars || result.bars.length === 0) {
      log36.debug("no bar data", { symbol, startDate });
      return 0;
    }
    let count2 = 0;
    for (const bar of result.bars) {
      const barDate = bar.t.slice(0, 10);
      pricesRepo.upsert({
        symbol: symbol.toUpperCase(),
        barDate,
        openCents: Math.round(bar.o * 100),
        highCents: Math.round(bar.h * 100),
        lowCents: Math.round(bar.l * 100),
        closeCents: Math.round(bar.c * 100),
        adjCloseCents: Math.round(bar.c * 100),
        volume: bar.v ?? null,
        provider: "alpaca",
        fetchedAt: Date.now()
      });
      count2++;
    }
    return count2;
  } catch (err) {
    log36.warn("backfill failed for symbol", {
      symbol,
      startDate,
      error: err instanceof Error ? err.message : String(err)
    });
    return 0;
  }
}
function getAllTrackedSymbols(db2) {
  const watchlistRepo = new WatchlistRepo(db2);
  const watchlistSymbols = watchlistRepo.list().map((w) => w.symbol);
  const staticSymbols = getStaticSymbols();
  const all = new Set([...watchlistSymbols, ...staticSymbols].map((s) => s.toUpperCase()));
  return Array.from(all).sort();
}
async function runPriceBackfillJob(db2, options = {}, trigger = "price_backfill") {
  const settings = getSettings();
  const runsRepo = new RunsRepo(db2);
  const startDate = options.startDate ?? new Date(Date.now() - (options.days ?? BACKFILL_DAYS) * 24 * 60 * 60 * 1e3).toISOString().slice(0, 10);
  const symbols = options.symbols ?? getAllTrackedSymbols(db2);
  const pricesRepo = new PricesRepo(db2);
  const summary = {
    total: symbols.length,
    succeeded: 0,
    bars: 0,
    symbols: [],
    startDate
  };
  const runId = runsRepo.create({
    trigger,
    status: "running",
    startedAt: Date.now(),
    finishedAt: null,
    model: null,
    settingsSnapshot: JSON.stringify(settings),
    error: null,
    tokenUsageJson: null,
    skipReason: null,
    summaryJson: null
  });
  try {
    const http = createAlpacaClient();
    if (!http) {
      const error = "ALPACA_API_KEY/SECRET not configured, cannot backfill";
      log36.error(error);
      runsRepo.setSkipped(runId, error);
      return summary;
    }
    log36.info("starting price backfill", { symbolCount: symbols.length, startDate });
    for (const symbol of symbols) {
      const bars = await backfillSymbol(symbol, pricesRepo, startDate, http);
      if (bars > 0) {
        summary.succeeded++;
        summary.bars += bars;
        summary.symbols.push(symbol);
        log36.debug("backfilled symbol", { symbol, bars });
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    runsRepo.updateStatus(runId, "succeeded");
    runsRepo.updateSummary(runId, JSON.stringify(summary));
    log36.info("price backfill complete", { total: summary.total, succeeded: summary.succeeded, bars: summary.bars });
    return summary;
  } catch (err) {
    runsRepo.updateStatus(runId, "failed", err instanceof Error ? err.message : String(err));
    log36.error("price backfill job failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

// src/repos/assessmentsRepo.ts
var AssessmentsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(assessment) {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db.prepare(
      `INSERT INTO assessments (id, run_id, symbol, score, confidence, thesis, risks, catalysts, evidence_ids_json, sentiment_summary, finbert_score, finbert_label, finbert_confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      assessment.runId,
      assessment.symbol,
      assessment.score,
      assessment.confidence,
      assessment.thesis,
      assessment.risks,
      assessment.catalysts,
      assessment.evidenceIdsJson,
      assessment.sentimentSummary,
      assessment.finbertScore,
      assessment.finbertLabel,
      assessment.finbertConfidence,
      createdAt
    );
    return id;
  }
  get(id) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, score, confidence, thesis, risks, catalysts,
                evidence_ids_json as evidenceIdsJson, sentiment_summary as sentimentSummary,
                finbert_score as finbertScore, finbert_label as finbertLabel,
                finbert_confidence as finbertConfidence, created_at as createdAt
         FROM assessments WHERE id = ?`
    ).get(id);
  }
  listByRun(runId) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, score, confidence, thesis, risks, catalysts,
                evidence_ids_json as evidenceIdsJson, sentiment_summary as sentimentSummary,
                finbert_score as finbertScore, finbert_label as finbertLabel,
                finbert_confidence as finbertConfidence, created_at as createdAt
         FROM assessments WHERE run_id = ? ORDER BY symbol`
    ).all(runId);
  }
  getByRunAndSymbol(runId, symbol) {
    return this.db.prepare(
      `SELECT id, run_id as runId, symbol, score, confidence, thesis, risks, catalysts,
                evidence_ids_json as evidenceIdsJson, sentiment_summary as sentimentSummary,
                finbert_score as finbertScore, finbert_label as finbertLabel,
                finbert_confidence as finbertConfidence, created_at as createdAt
         FROM assessments WHERE run_id = ? AND symbol = ?`
    ).get(runId, symbol);
  }
};

// src/repos/rejectionsRepo.ts
import { randomUUID as randomUUID5 } from "crypto";
var RejectionsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(rejection, runId) {
    const id = randomUUID5();
    const stmt = this.db.prepare(`
      INSERT INTO rejections (
        id, run_id, decision_id, symbol, action, confidence, target_weight, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      runId,
      rejection.decisionId ?? null,
      rejection.symbol,
      rejection.action,
      rejection.confidence,
      rejection.targetWeight ?? null,
      rejection.reason,
      Date.now()
    );
    return id;
  }
  listByRun(runId) {
    const stmt = this.db.prepare("SELECT * FROM rejections WHERE run_id = ? ORDER BY created_at ASC");
    return stmt.all(runId);
  }
  deleteByRun(runId) {
    const stmt = this.db.prepare("DELETE FROM rejections WHERE run_id = ?");
    stmt.run(runId);
  }
};

// src/services/tradingCycleService.ts
import { getLlmLimits as getLlmLimits2 } from "@atn-trd/shared";

// src/agent/analystAgent.ts
import { z as z5 } from "zod";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage as HumanMessage4, SystemMessage as SystemMessage4, AIMessage as AIMessage2 } from "@langchain/core/messages";

// src/llm/prompts/analyst.ts
var ANALYST_SYSTEM_PROMPT = `You are a quantitative equity analyst for a daily automated trading system.

Your role is to conduct thorough, evidence-based investment research and provide a structured assessment of individual stocks. You have access to the following tools and must use all of them to form a complete view:

**Available Tools:**
- get_price_history: Fetch historical price bars for trend and momentum analysis
- get_fundamentals: Retrieve company valuation metrics (P/E, EV/EBITDA, revenue growth, margins, earnings quality)
- get_news: Fetch recent news articles to assess sentiment and near-term catalysts
- get_macro: Retrieve macroeconomic indicators (interest rates, VIX, inflation, unemployment, Fed policy)
- get_options_snapshot: Get options chain data for volatility, skew, and market sentiment signals
- get_portfolio: Review current positions, portfolio weight, and existing exposure
- get_prior_decisions: Check previous trading decisions for this symbol to avoid thrashing

**Research Framework:**

1. **Price Action & Momentum**
   - Analyze recent price trends (20, 50, 200-day moving averages if available)
   - Assess momentum indicators and relative strength
   - Identify support/resistance and technical breakout levels

2. **Fundamental Analysis**
   - Review valuation multiples (P/E, PEG, EV/EBITDA, Price-to-Book)
   - Analyze growth rates (revenue, earnings, FCF) and quality (margins, ROIC)
   - Assess relative value versus peers and historical averages
   - Identify accounting red flags or quality issues

3. **News & Sentiment**
   - Synthesize recent news themes, earnings announcements, and guidance changes
   - Assess news sentiment and materiality of recent events
   - Identify upcoming earnings dates and major catalysts

4. **Macroeconomic Context**
   - Consider Fed policy, interest rates (10Y/2Y curve), and inflation trends
   - Evaluate sector sensitivity to macro conditions
   - Assess VIX, credit spreads, and market regime

5. **Options Market Signals**
   - Review implied volatility and term structure
   - Analyze put/call ratio and skew (market hedging intent)
   - Note unusual options activity or expiration dynamics (OpEx dates)

6. **Portfolio Context**
   - Check if you already own this stock; if so, review rationale for current position
   - Avoid churn: only recommend changes if the thesis has materially changed

7. **Prior Decisions**
   - Review any prior analysis and trades to ensure consistency
   - Flag if new research contradicts recent decisions

**Output Requirements:**

Conduct research in a conversational, step-by-step manner. Cite specific data points (prices, ratios, news headlines, macro levels) as evidence. Do NOT output structured JSON during research\u2014that is handled in a separate synthesis step. Focus on depth and evidence-based reasoning, not speed.

After calling your tools and analyzing the data, you will be asked to provide a final structured assessment with your investment score, confidence level, thesis, risks, and catalysts. That structured format will be requested separately after this research phase is complete.`;

// src/agent/tools.ts
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z as z4 } from "zod";

// src/services/volatilityService.ts
init_logger();
var log37 = logger.child({ component: "volatility-service" });
var cachedChartFn = null;
var defaultChartFn = async (symbol, periodDays, interval) => {
  if (!cachedChartFn) {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey", "ripHistorical"] });
    cachedChartFn = async (s, days, i) => {
      const period1 = new Date(Date.now() - days * 24 * 60 * 60 * 1e3);
      return await yf.chart(s, { period1, interval: i }, { validateResult: false });
    };
  }
  return cachedChartFn(symbol, periodDays, interval);
};
function calculateHistoricalVolatility(prices, _days) {
  if (!prices || prices.length < 2) {
    return null;
  }
  const dailyReturns = [];
  for (let i = 1; i < prices.length; i++) {
    const prevPrice = prices[i - 1];
    if (prevPrice > 0) {
      const dailyReturn = (prices[i] - prevPrice) / prevPrice;
      dailyReturns.push(dailyReturn);
    }
  }
  if (dailyReturns.length < 1) {
    return null;
  }
  if (dailyReturns.length === 1) {
    return 0;
  }
  const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((sum2, ret) => sum2 + Math.pow(ret - mean, 2), 0) / dailyReturns.length;
  const stdDev = Math.sqrt(variance);
  const annualizedVol = stdDev * Math.sqrt(252);
  return annualizedVol;
}
async function getVolatilityMetrics(symbol) {
  const normalized = symbol.trim().toUpperCase();
  let historicalVol20d = null;
  let historicalVol60d = null;
  let beta = null;
  let impliedVol = null;
  try {
    const priceChart = await defaultChartFn(normalized, 90, "1d");
    const prices = extractPrices(priceChart);
    if (prices && prices.length > 0) {
      if (prices.length >= 20) {
        const last20 = prices.slice(-20);
        historicalVol20d = calculateHistoricalVolatility(last20, 20);
      }
      if (prices.length >= 60) {
        const last60 = prices.slice(-60);
        historicalVol60d = calculateHistoricalVolatility(last60, 60);
      } else if (prices.length >= 2) {
        historicalVol60d = calculateHistoricalVolatility(prices, prices.length);
      }
    }
    const fundamentalsSource = new YahooFundamentalsDataSource();
    const fundamentalsResult = await fundamentalsSource.fetch({ symbol: normalized });
    beta = fundamentalsResult.data.beta;
    const optionsSource = new YahooOptionsDataSource();
    const optionsResult = await optionsSource.fetch({ symbol: normalized });
    const atmIv = extractAtmImpliedVolatility(optionsResult.data);
    impliedVol = atmIv;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log37.debug("volatility metrics fetch failed", { symbol: normalized, error: errorMsg });
  }
  return {
    symbol: normalized,
    historicalVol20d,
    historicalVol60d,
    beta,
    impliedVol
  };
}
function extractPrices(chartRaw) {
  if (!chartRaw?.chart?.result?.[0]) {
    return null;
  }
  const result = chartRaw.chart.result[0];
  const closes = result.indicators?.quote?.[0]?.close;
  if (!Array.isArray(closes)) {
    return null;
  }
  const prices = [];
  for (const close of closes) {
    if (typeof close === "number" && close > 0) {
      prices.push(close);
    }
  }
  return prices.length > 0 ? prices : null;
}
function extractAtmImpliedVolatility(optionsData) {
  if (!optionsData.underlyingPrice || optionsData.calls.length === 0) {
    return null;
  }
  const underlyingPrice = optionsData.underlyingPrice;
  let atmCall = null;
  let minDiff = Infinity;
  for (const call of optionsData.calls) {
    const diff = Math.abs(call.strike - underlyingPrice);
    if (diff < minDiff && call.impliedVolatility !== null) {
      minDiff = diff;
      atmCall = call;
    }
  }
  return atmCall?.impliedVolatility ?? null;
}

// src/agent/tools.ts
function makeGetNews(deps) {
  const maxArticles = deps.llmLimits?.maxNewsArticles ?? 50;
  const maxDays = deps.llmLimits?.maxNewsDays ?? 90;
  const schema = z4.object({
    symbol: z4.string().describe("Stock ticker symbol"),
    days: z4.number().int().optional().describe(`Days back to search (1\u2013${maxDays}, default 7)`),
    limit: z4.number().int().optional().describe(`Max articles to return (1\u2013${maxArticles}, default 20)`)
  });
  return new DynamicStructuredTool({
    name: "get_news",
    description: "Fetch recent news articles for a given symbol",
    schema,
    func: async (input) => {
      try {
        const symbol = input.symbol;
        const days = input.days ?? 7;
        const limit = input.limit ?? Math.min(20, maxArticles);
        const clampedDays = Math.max(1, Math.min(maxDays, days));
        const clampedLimit = Math.max(1, Math.min(maxArticles, limit));
        const cacheKey = `news:${symbol}`;
        const result = await deps.cache.getOrFetch(cacheKey, 3e5, async () => {
          const now = Date.now();
          const fromMs = now - clampedDays * 864e5;
          const from = toIsoDate(fromMs);
          const to = toIsoDate(now);
          return await deps.newsSource.fetch({
            symbol,
            from,
            to,
            limit: clampedLimit
          });
        });
        const truncateLen = deps.llmLimits?.truncateNewsSummary ?? 0;
        const truncated = {
          ...result.data,
          articles: result.data.articles.map((a) => ({
            headline: a.headline,
            summary: truncateLen > 0 && a.summary ? a.summary.slice(0, truncateLen) : a.summary,
            source: a.source,
            publishedAt: a.publishedAt
          }))
        };
        return JSON.stringify(truncated);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function makeGetFundamentals(deps) {
  const schema = z4.object({
    symbol: z4.string().describe("Stock ticker symbol")
  });
  return new DynamicStructuredTool({
    name: "get_fundamentals",
    description: "Fetch fundamental company data including valuations, earnings, and ratios",
    schema,
    func: async (input) => {
      try {
        const symbol = input.symbol;
        const cacheKey = `fundamentals:${symbol}`;
        const result = await deps.cache.getOrFetch(cacheKey, 6e4, async () => {
          return await deps.fundamentalsSource.fetch({ symbol });
        });
        return JSON.stringify(result.data);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function makeGetMacro(deps) {
  const schema = z4.object({
    seriesIds: z4.array(z4.string()).optional().describe(
      "FRED series IDs to fetch. Omit for defaults: DGS10, DGS2, T10Y2Y, CPIAUCSL, UNRATE, FEDFUNDS, VIXCLS, UMCSENT"
    )
  }).passthrough();
  return new DynamicStructuredTool({
    name: "get_macro",
    description: "Fetch macroeconomic indicators from FRED",
    schema,
    func: async (input) => {
      try {
        const seriesIds = input.seriesIds ?? void 0;
        const seriesKey = seriesIds ? seriesIds.sort().join(",") : "default";
        const cacheKey = `macro:${seriesKey}`;
        const result = await deps.cache.getOrFetch(cacheKey, 3e5, async () => {
          return await deps.macroSource.fetch({ seriesIds });
        });
        return JSON.stringify(result.data);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function makeGetOptionsSnapshot(deps) {
  const schema = z4.object({
    symbol: z4.string().describe("Stock ticker symbol")
  });
  return new DynamicStructuredTool({
    name: "get_options_snapshot",
    description: "Fetch current options chain snapshot for a given symbol",
    schema,
    func: async (input) => {
      try {
        const symbol = input.symbol;
        const cacheKey = `options:${symbol}`;
        const result = await deps.cache.getOrFetch(cacheKey, 3e5, async () => {
          return await deps.optionsSource.fetch({ symbol });
        });
        return JSON.stringify(result.data);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function makeGetPriceHistory(deps) {
  const schema = z4.object({
    symbol: z4.string().describe("Stock ticker symbol"),
    days: z4.number().int().optional().describe("Days of history to return (1\u2013504, default 90)")
  });
  return new DynamicStructuredTool({
    name: "get_price_history",
    description: "Fetch cached historical price bars for a given symbol",
    schema,
    func: async (input) => {
      try {
        const symbol = input.symbol;
        const days = input.days ?? 90;
        const clampedDays = Math.max(1, Math.min(504, days));
        const bars = deps.pricesRepo.listBySymbol(symbol, clampedDays);
        const mapped = bars.map((bar) => ({
          barDate: bar.barDate,
          open: bar.openCents / 100,
          high: bar.highCents / 100,
          low: bar.lowCents / 100,
          close: bar.closeCents / 100,
          adjClose: bar.adjCloseCents / 100,
          volume: bar.volume
        }));
        return JSON.stringify({ symbol, bars: mapped });
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function makeGetPortfolio(deps) {
  const schema = z4.object({}).passthrough();
  return new DynamicStructuredTool({
    name: "get_portfolio",
    description: "Get the current portfolio state including positions, NAV, and P&L",
    schema,
    func: async (_input) => {
      try {
        const portfolio = await deps.portfolioService.getPortfolio();
        const mapped = {
          asOfDate: portfolio.asOfDate,
          cash: portfolio.cashCents / 100,
          positionsValue: portfolio.positionsValueCents / 100,
          totalValue: portfolio.totalValueCents / 100,
          totalUnrealizedPnl: portfolio.totalUnrealizedPnlCents / 100,
          totalRealizedPnl: portfolio.totalRealizedPnlCents / 100,
          totalPnl: portfolio.totalPnlCents / 100,
          totalReturnPercent: portfolio.totalReturnPercent,
          positions: portfolio.positions.map((detail) => ({
            symbol: detail.symbol,
            qty: detail.qty,
            avgCost: detail.avgCostCents / 100,
            currentPrice: detail.currentPriceCents / 100,
            costBasis: detail.costBasisCents / 100,
            marketValue: detail.marketValueCents / 100,
            weightPercent: detail.weightPercent,
            unrealizedPnl: detail.unrealizedPnlCents / 100,
            realizedPnl: detail.realizedPnlCents / 100
          }))
        };
        return JSON.stringify(mapped);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function makeGetPriorDecisions(deps) {
  const schema = z4.object({
    symbol: z4.string().describe("Stock ticker symbol"),
    limit: z4.number().int().optional().describe("Max decisions to return (1\u201320, default 5)")
  });
  return new DynamicStructuredTool({
    name: "get_prior_decisions",
    description: "Fetch prior trading decisions for a given symbol",
    schema,
    func: async (input) => {
      try {
        const symbol = input.symbol;
        const limit = input.limit ?? 5;
        const clampedLimit = Math.max(1, Math.min(20, limit));
        const rows = deps.decisionsRepo.listBySymbol(symbol, clampedLimit);
        return JSON.stringify(rows);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function makeGetSectorPerformance(deps) {
  const schema = z4.object({
    limit: z4.number().int().optional().describe("Max sectors to return (default all)")
  });
  return new DynamicStructuredTool({
    name: "get_sector_performance",
    description: "Fetch sector performance metrics (returns, PE, volatility) for sector rotation signals",
    schema,
    func: async (input) => {
      try {
        const cacheKey = "sectors:all";
        const sectors = await deps.cache.getOrFetch(cacheKey, 3e5, async () => {
          return await deps.sectorSource.fetch();
        });
        const limit = input.limit ?? sectors.length;
        return JSON.stringify(sectors.slice(0, limit));
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function makeGetSimilarSituations(deps) {
  const schema = z4.object({
    symbol: z4.string().describe("Stock ticker symbol"),
    description: z4.string().describe("Description of the current situation to find similar historical cases"),
    limit: z4.number().int().optional().describe("Max results to return (1\u201310, default 5)")
  });
  return new DynamicStructuredTool({
    name: "get_similar_situations",
    description: "Find similar historical situations for a symbol based on semantic similarity. Use this to learn from past assessments and research.",
    schema,
    func: async (input) => {
      try {
        if (!deps.semanticMemory) {
          return JSON.stringify({ error: "Semantic memory not available" });
        }
        const symbol = input.symbol;
        const description = input.description;
        const limit = Math.max(1, Math.min(10, input.limit ?? 5));
        const results = await deps.semanticMemory.getSimilarSituations({
          symbol,
          description,
          limit
        });
        return JSON.stringify(results);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function makeGetVolatility(deps) {
  const schema = z4.object({
    symbol: z4.string().describe("Stock ticker symbol")
  });
  return new DynamicStructuredTool({
    name: "get_volatility",
    description: "Fetch volatility metrics including historical volatility (20d, 60d), beta, and implied volatility",
    schema,
    func: async (input) => {
      try {
        const symbol = input.symbol;
        const cacheKey = `volatility:${symbol}`;
        const result = await deps.cache.getOrFetch(cacheKey, 3e5, async () => {
          const metrics = await getVolatilityMetrics(symbol);
          return { data: metrics };
        });
        return JSON.stringify(result.data);
      } catch (err) {
        return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
function createAgentTools(deps) {
  const tools = [
    makeGetNews(deps),
    makeGetFundamentals(deps),
    makeGetMacro(deps),
    makeGetOptionsSnapshot(deps),
    makeGetSectorPerformance(deps),
    makeGetPriceHistory(deps),
    makeGetPortfolio(deps),
    makeGetPriorDecisions(deps),
    makeGetVolatility(deps)
  ];
  if (deps.semanticMemory) {
    tools.push(makeGetSimilarSituations(deps));
  }
  return tools;
}
async function prefetchForSymbol(symbol, deps) {
  const maxDays = deps.llmLimits?.maxNewsDays ?? 90;
  const maxArticles = deps.llmLimits?.maxNewsArticles ?? 50;
  const now = Date.now();
  const from = toIsoDate(now - Math.min(7, maxDays) * 864e5);
  const to = toIsoDate(now);
  await Promise.allSettled([
    deps.cache.getOrFetch(
      `news:${symbol}`,
      3e5,
      () => deps.newsSource.fetch({ symbol, from, to, limit: Math.min(20, maxArticles) })
    ),
    deps.cache.getOrFetch(
      `fundamentals:${symbol}`,
      6e4,
      () => deps.fundamentalsSource.fetch({ symbol })
    ),
    deps.cache.getOrFetch(
      `options:${symbol}`,
      3e5,
      () => deps.optionsSource.fetch({ symbol })
    ),
    deps.cache.getOrFetch(
      `volatility:${symbol}`,
      3e5,
      () => getVolatilityMetrics(symbol)
    ),
    deps.cache.getOrFetch(
      "macro:default",
      3e5,
      () => deps.macroSource.fetch({})
    ),
    deps.cache.getOrFetch(
      "sectors:all",
      3e5,
      () => deps.sectorSource.fetch()
    )
  ]);
}

// src/agent/analystAgent.ts
init_logger();
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
var DEFAULT_MAX_CONTEXT_TOKENS = 28e3;
var AssessmentSchema = z5.object({
  score: z5.number().min(-1).max(1).describe("Directional view: -1 very bearish \u2192 +1 very bullish"),
  confidence: z5.number().min(0).max(1).describe("Confidence in the assessment, 0\u20131"),
  thesis: z5.string().describe("Primary investment thesis, 2\u20134 sentences, evidence-backed"),
  risks: z5.string().nullable().describe("Key risks; null if none identified"),
  catalysts: z5.string().nullable().describe("Near-term catalysts; null if none identified"),
  sentimentSummary: z5.string().describe("1-2 sentence summary of market sentiment for FinBERT scoring")
});
var log38 = logger.child({ component: "analyst-agent" });
async function runAnalystAgent(runId, symbol, deps, config) {
  try {
    const rateLimitedLlm = getRateLimitedLlm();
    const synthesisLlm = getSynthesisLlm();
    const resolved = resolveConfigForAgent("analyst", { model: config?.model, temperature: config?.temperature });
    const isGemini = isGeminiModel();
    const tools = createAgentTools(deps.toolsDeps);
    const collector = new RunCollector(runId, symbol, deps.messagesRepo, deps.artifactsRepo);
    let humanContent = `Research ${symbol} and provide a thorough investment assessment.`;
    if (config?.investorProfile) {
      const profile = config.investorProfile;
      const profileStr = [
        "",
        "INVESTOR PROFILE",
        "=================",
        `Style weights: growth=${profile.styleWeights.growth}%, value=${profile.styleWeights.value}%, stability=${profile.styleWeights.stability}%, cashFlow=${profile.styleWeights.cashFlow}%, momentum=${profile.styleWeights.momentum}%`,
        `Max volatility tolerance: ${profile.maxVolatility.toFixed(2)}%`
      ].join("\n");
      humanContent += profileStr;
    }
    collector.writeInitialMessages([
      { role: "system", content: ANALYST_SYSTEM_PROMPT },
      { role: "human", content: humanContent }
    ]);
    const recursionLimit = config?.recursionLimit ?? 10;
    log38.debug("starting analyst agent", {
      runId,
      symbol,
      model: resolved.model,
      recursionLimit
    });
    const agent = createReactAgent({
      llm: rateLimitedLlm,
      tools,
      stateModifier: ANALYST_SYSTEM_PROMPT
    });
    let finalReasoningText = "";
    let eventCount = 0;
    const stream = agent.streamEvents(
      { messages: [new HumanMessage4(humanContent)] },
      { version: "v2", recursionLimit }
    );
    for await (const event of stream) {
      eventCount++;
      if (event.event === "on_tool_start") {
        const toolName = event.name?.replace("get_", "") ?? "tool";
        emitProgress(runId, "analyst", `${symbol}: fetching ${toolName}`, { symbol, tool: event.name });
      }
      collector.handleEvent(event);
      if (event.event === "on_chat_model_end") {
        const output = event.data?.output;
        if (output && typeof output === "object" && "content" in output) {
          const c = output.content;
          finalReasoningText = typeof c === "string" ? c : "";
        }
      }
    }
    log38.debug("stream complete", { symbol, eventCount });
    emitProgress(runId, "analyst", `${symbol}: synthesizing assessment`, { symbol });
    const maxTokens = config?.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS;
    let reasoningText = finalReasoningText || "(No reasoning captured)";
    const reasoningTokens = estimateTokens(reasoningText);
    if (reasoningTokens > maxTokens * 0.6) {
      const targetChars = Math.floor(maxTokens * 0.6 * 4);
      reasoningText = "..." + reasoningText.slice(-targetChars);
      log38.debug("trimmed reasoning text", { symbol, originalTokens: reasoningTokens, targetChars });
    }
    const synthesisPrompt = `Based on your research above, provide your final assessment as a JSON object with this exact structure:
{
  "score": <number from -1 to 1, where -1=very bearish, 0=neutral, 1=very bullish>,
  "confidence": <number from 0 to 1>,
  "thesis": "<2-4 sentence investment thesis>",
  "risks": "<key risks or null>",
  "catalysts": "<near-term catalysts or null>",
  "sentimentSummary": "<1-2 sentence summary of overall market sentiment for this stock, suitable for sentiment analysis>"
}
Respond ONLY with the JSON object, no markdown or explanation.`;
    const synthesisMessages = [
      new SystemMessage4(ANALYST_SYSTEM_PROMPT),
      new HumanMessage4(humanContent),
      new AIMessage2(reasoningText),
      new HumanMessage4(synthesisPrompt)
    ];
    const totalContent = synthesisMessages.map(
      (m) => typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    ).join("");
    const estimatedTotal = estimateTokens(totalContent);
    if (estimatedTotal > maxTokens) {
      log38.warn("synthesis prompt exceeds token limit", {
        symbol,
        estimatedTokens: estimatedTotal,
        maxTokens
      });
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let raw;
        if (!isGemini) {
          try {
            log38.debug("attempting withStructuredOutput", { symbol });
            raw = await synthesisLlm.withStructuredOutput(AssessmentSchema).invoke(
              synthesisMessages
            );
            if (raw && typeof raw === "object" && "score" in raw) {
              const parsed2 = AssessmentSchema.parse(raw);
              log38.debug("assessment complete", { symbol, score: parsed2.score, confidence: parsed2.confidence });
              return { symbol, ...parsed2 };
            }
          } catch (structuredErr) {
            log38.debug("withStructuredOutput failed, trying manual extraction", {
              symbol,
              error: structuredErr instanceof Error ? structuredErr.message : String(structuredErr)
            });
          }
        }
        const response = await synthesisLlm.invoke(synthesisMessages);
        const content = typeof response.content === "string" ? response.content : Array.isArray(response.content) ? response.content.map((c) => typeof c === "string" ? c : c.text ?? "").join("") : "";
        log38.debug("synthesis response", { symbol, contentLength: content.length });
        let jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
        if (jsonMatch) {
          raw = JSON.parse(jsonMatch[1].trim());
        } else {
          jsonMatch = content.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error("No JSON found in response");
          raw = JSON.parse(jsonMatch[0]);
        }
        const parsed = AssessmentSchema.parse(raw);
        log38.debug("assessment complete", { symbol, score: parsed.score, confidence: parsed.confidence });
        return { symbol, ...parsed };
      } catch (err) {
        if (attempt === 0) {
          log38.warn("synthesis attempt failed, retrying", {
            symbol,
            error: err instanceof Error ? err.message : String(err)
          });
          continue;
        }
        throw err;
      }
    }
    return null;
  } catch (err) {
    log38.warn("analyst agent failed", {
      runId,
      symbol,
      error: err instanceof Error ? err.message : String(err)
    });
    return null;
  }
}

// src/services/riskService.ts
import { randomUUID as randomUUID6 } from "crypto";
init_logger();
var log39 = logger.child({ component: "risk-service" });
function createRiskService(constraints, priceFeed) {
  return new RiskServiceImpl(constraints, priceFeed);
}
var RiskServiceImpl = class {
  constructor(constraints, priceFeed) {
    this.constraints = constraints;
    this.priceFeed = priceFeed;
  }
  constraints;
  priceFeed;
  async evaluate(input) {
    const { decisionSet, portfolio, runId, earningsBlackoutSymbols, volatilityBySymbol } = input;
    if (portfolio.totalValueCents === 0) {
      const rejections2 = decisionSet.decisions.filter((d) => d.action !== "hold").map((d) => ({
        decisionId: d.id,
        symbol: d.symbol,
        action: d.action,
        confidence: d.confidence,
        targetWeight: d.targetWeight,
        reason: "portfolio has zero total value"
      }));
      log39.warn("rejecting all decisions: portfolio has zero value", {
        runId,
        rejectionCount: rejections2.length
      });
      return { orders: [], rejections: rejections2 };
    }
    const sortedDecisions = this.sortDecisions(decisionSet.decisions);
    const orders = [];
    const rejections = [];
    let simulatedCashCents = portfolio.cashCents;
    let newPositionsThisRun = 0;
    for (const decision of sortedDecisions) {
      if (decision.action === "hold") {
        continue;
      }
      const prepriceRejection = this.checkPrepriceGuardrails(
        decision,
        portfolio,
        earningsBlackoutSymbols,
        newPositionsThisRun,
        volatilityBySymbol
      );
      if (prepriceRejection) {
        rejections.push(prepriceRejection);
        log39.debug("decision rejected in prephase checks", {
          symbol: decision.symbol,
          reason: prepriceRejection.reason
        });
        continue;
      }
      const priceCents = await this.fetchPrice(decision.symbol);
      if (priceCents === null) {
        const rejection2 = {
          decisionId: decision.id,
          symbol: decision.symbol,
          action: decision.action,
          confidence: decision.confidence,
          targetWeight: decision.targetWeight,
          reason: "price unavailable for symbol"
        };
        rejections.push(rejection2);
        log39.debug("decision rejected: price unavailable", { symbol: decision.symbol });
        continue;
      }
      if (priceCents <= 0) {
        const rejection2 = {
          decisionId: decision.id,
          symbol: decision.symbol,
          action: decision.action,
          confidence: decision.confidence,
          targetWeight: decision.targetWeight,
          reason: "price is invalid (zero or negative)"
        };
        rejections.push(rejection2);
        log39.debug("decision rejected: invalid price", { symbol: decision.symbol, priceCents });
        continue;
      }
      const currentPosition = portfolio.positions.find((p) => p.symbol === decision.symbol);
      const currentQty = currentPosition?.qty ?? 0;
      const currentNotionalCents = currentPosition?.marketValueCents ?? 0;
      const { qty, sizingDetails, rejection } = this.computeQtyWithGuardrails(
        decision,
        priceCents,
        portfolio.totalValueCents,
        currentQty,
        currentNotionalCents,
        simulatedCashCents
      );
      if (rejection) {
        rejections.push(rejection);
        log39.debug("decision rejected in sizing/guardrails", {
          symbol: decision.symbol,
          reason: rejection.reason
        });
        continue;
      }
      const side = decision.action === "sell" || decision.action === "trim" ? "sell" : "buy";
      const order = {
        clientOrderId: randomUUID6(),
        decisionId: decision.id,
        runId,
        broker: this.constraints.broker,
        symbol: decision.symbol,
        side,
        qty,
        type: "market",
        tif: "day",
        status: "pending"
      };
      const orderProposal = { order, sizingDetails };
      orders.push(orderProposal);
      const orderNotionalCents = notionalCents(qty, priceCents);
      log39.debug("order accepted", {
        symbol: decision.symbol,
        side,
        qty,
        priceCents,
        notionalCents: orderNotionalCents
      });
      if (side === "buy") {
        simulatedCashCents -= orderNotionalCents;
      } else {
        simulatedCashCents += orderNotionalCents;
      }
      if ((decision.action === "buy" || decision.action === "add" && !currentPosition) && !portfolio.positions.find((p) => p.symbol === decision.symbol)) {
        newPositionsThisRun++;
      }
    }
    log39.info("risk evaluation completed", {
      runId,
      orderCount: orders.length,
      rejectionCount: rejections.length,
      newPositionsOpened: newPositionsThisRun
    });
    return { orders, rejections };
  }
  /**
   * Sort decisions: sell/trim first, then buy/add (by confidence desc), then hold.
   */
  sortDecisions(decisions) {
    const sells = decisions.filter((d) => d.action === "sell" || d.action === "trim");
    const buys = decisions.filter((d) => d.action === "buy" || d.action === "add").sort((a, b) => b.confidence - a.confidence);
    const holds = decisions.filter((d) => d.action === "hold");
    return [...sells, ...buys, ...holds];
  }
  /**
   * Check all pre-price guardrails (checks 1-9).
   */
  checkPrepriceGuardrails(decision, portfolio, earningsBlackoutSymbols, newPositionsThisRun, volatilityBySymbol) {
    if (this.constraints.symbolBlocklist.some((s) => s.toUpperCase() === decision.symbol.toUpperCase())) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: "symbol is on the blocklist"
      };
    }
    if (decision.confidence < this.constraints.minConfidenceThreshold) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: `confidence ${decision.confidence.toFixed(2)} below threshold ${this.constraints.minConfidenceThreshold.toFixed(2)}`
      };
    }
    if (earningsBlackoutSymbols?.has(decision.symbol)) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: "symbol is in earnings blackout window"
      };
    }
    if ((decision.action === "buy" || decision.action === "add") && volatilityBySymbol) {
      const symbolVolatility = volatilityBySymbol.get(decision.symbol);
      if (symbolVolatility !== null && symbolVolatility !== void 0 && symbolVolatility > this.constraints.maxVolatility) {
        return {
          decisionId: decision.id,
          symbol: decision.symbol,
          action: decision.action,
          confidence: decision.confidence,
          targetWeight: decision.targetWeight,
          reason: `volatility ${symbolVolatility.toFixed(4)} exceeds max ${this.constraints.maxVolatility.toFixed(4)}`
        };
      }
    }
    const currentPosition = portfolio.positions.find((p) => p.symbol === decision.symbol);
    if ((decision.action === "sell" || decision.action === "trim") && !currentPosition) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: "no position to sell"
      };
    }
    if ((decision.action === "buy" || decision.action === "add") && decision.targetWeight === void 0) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: "buy/add decision missing targetWeight"
      };
    }
    if (decision.action === "trim" && decision.targetWeight === void 0) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: "trim decision missing targetWeight"
      };
    }
    const isNewPosition = (decision.action === "buy" || decision.action === "add" && !currentPosition) && !portfolio.positions.find((p) => p.symbol === decision.symbol);
    if (isNewPosition && portfolio.positions.length + newPositionsThisRun >= this.constraints.maxConcurrentPositions) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: `would exceed max concurrent positions (${this.constraints.maxConcurrentPositions})`
      };
    }
    if (isNewPosition && newPositionsThisRun >= this.constraints.maxNewPositionsPerRun) {
      return {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: `would exceed max new positions per run (${this.constraints.maxNewPositionsPerRun})`
      };
    }
    return null;
  }
  /**
   * Fetch price from price feed, converting to cents.
   */
  async fetchPrice(symbol) {
    const price = await this.priceFeed.getPrice(symbol);
    if (price === null || price === void 0) {
      return null;
    }
    return toCents(price);
  }
  /**
   * Compute order qty with all guardrails and return sizing details.
   * Returns { qty, sizingDetails, rejection }.
   */
  computeQtyWithGuardrails(decision, priceCents, totalValueCents, currentQty, currentNotionalCents, simulatedCashCents) {
    let qty = 0;
    let targetNotionalCents = 0;
    let deltaNotionalCents = 0;
    let rawQty = 0;
    let cappedByWeight = false;
    let cappedByNotional = false;
    let cappedByCash = false;
    let cappedByPosition = false;
    if (decision.action === "buy" || decision.action === "add") {
      const targetWeight = decision.targetWeight;
      targetNotionalCents = Math.round(targetWeight * totalValueCents);
      deltaNotionalCents = targetNotionalCents - currentNotionalCents;
      rawQty = deltaNotionalCents / priceCents;
      qty = floorQty(rawQty);
    } else if (decision.action === "sell") {
      qty = currentQty;
      targetNotionalCents = 0;
      deltaNotionalCents = currentNotionalCents;
      rawQty = qty;
    } else if (decision.action === "trim") {
      const targetWeight = decision.targetWeight;
      targetNotionalCents = Math.round(targetWeight * totalValueCents);
      deltaNotionalCents = currentNotionalCents - targetNotionalCents;
      rawQty = deltaNotionalCents / priceCents;
      qty = ceilQty(rawQty);
      qty = Math.min(qty, currentQty);
      if (qty < ceilQty(rawQty)) {
        cappedByPosition = true;
      }
    }
    if (decision.action === "sell") {
      qty = Math.min(qty, currentQty);
      if (qty < currentQty) {
        cappedByPosition = true;
      }
    }
    const targetWeightDecimal = decision.targetWeight ?? 0;
    const finalQty = qty;
    if (qty <= 0) {
      const rejection = {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: "computed order qty is zero after sizing"
      };
      const sizingDetails2 = {
        targetWeightDecimal,
        targetNotionalCents,
        currentNotionalCents,
        deltaNotionalCents,
        priceCents,
        rawQty,
        finalQty,
        cappedByWeight,
        cappedByNotional,
        cappedByCash,
        cappedByPosition
      };
      return { qty: 0, sizingDetails: sizingDetails2, rejection };
    }
    if (decision.action === "buy" || decision.action === "add") {
      const maxAllowedNotionalCents = Math.floor(
        this.constraints.maxPositionWeightPercent / 100 * totalValueCents
      );
      const projectedNotionalCents = currentNotionalCents + qty * priceCents;
      if (projectedNotionalCents > maxAllowedNotionalCents) {
        const cappedQty = floorQty((maxAllowedNotionalCents - currentNotionalCents) / priceCents);
        if (cappedQty <= 0) {
          const rejection = {
            decisionId: decision.id,
            symbol: decision.symbol,
            action: decision.action,
            confidence: decision.confidence,
            targetWeight: decision.targetWeight,
            reason: `position already at or above max weight (${this.constraints.maxPositionWeightPercent}%)`
          };
          const sizingDetails2 = {
            targetWeightDecimal,
            targetNotionalCents,
            currentNotionalCents,
            deltaNotionalCents,
            priceCents,
            rawQty,
            finalQty: qty,
            cappedByWeight: true,
            cappedByNotional,
            cappedByCash,
            cappedByPosition
          };
          return { qty: 0, sizingDetails: sizingDetails2, rejection };
        }
        qty = cappedQty;
        cappedByWeight = true;
      }
    }
    const orderNotionalCents = qty * priceCents;
    if (orderNotionalCents > this.constraints.maxOrderNotionalCents) {
      const cappedQty = floorQty(this.constraints.maxOrderNotionalCents / priceCents);
      if (cappedQty <= 0) {
        const rejection = {
          decisionId: decision.id,
          symbol: decision.symbol,
          action: decision.action,
          confidence: decision.confidence,
          targetWeight: decision.targetWeight,
          reason: "order notional exceeds limit and qty is zero after cap"
        };
        const sizingDetails2 = {
          targetWeightDecimal,
          targetNotionalCents,
          currentNotionalCents,
          deltaNotionalCents,
          priceCents,
          rawQty,
          finalQty: qty,
          cappedByWeight,
          cappedByNotional: true,
          cappedByCash,
          cappedByPosition
        };
        return { qty: 0, sizingDetails: sizingDetails2, rejection };
      }
      qty = cappedQty;
      cappedByNotional = true;
    }
    if (decision.action === "buy" || decision.action === "add") {
      const requiredReserveCents = Math.ceil(this.constraints.minCashReservePercent / 100 * totalValueCents);
      const availableCashCents = simulatedCashCents - requiredReserveCents;
      const orderNotionalCents2 = qty * priceCents;
      if (orderNotionalCents2 > availableCashCents) {
        const cappedQty = floorQty(availableCashCents / priceCents);
        if (cappedQty <= 0) {
          const rejection = {
            decisionId: decision.id,
            symbol: decision.symbol,
            action: decision.action,
            confidence: decision.confidence,
            targetWeight: decision.targetWeight,
            reason: "insufficient cash after reserve requirement"
          };
          const sizingDetails2 = {
            targetWeightDecimal,
            targetNotionalCents,
            currentNotionalCents,
            deltaNotionalCents,
            priceCents,
            rawQty,
            finalQty: qty,
            cappedByWeight,
            cappedByNotional,
            cappedByCash: true,
            cappedByPosition
          };
          return { qty: 0, sizingDetails: sizingDetails2, rejection };
        }
        qty = cappedQty;
        cappedByCash = true;
      }
    }
    if (qty <= 0) {
      const rejection = {
        decisionId: decision.id,
        symbol: decision.symbol,
        action: decision.action,
        confidence: decision.confidence,
        targetWeight: decision.targetWeight,
        reason: "computed order qty is zero after sizing"
      };
      const sizingDetails2 = {
        targetWeightDecimal,
        targetNotionalCents,
        currentNotionalCents,
        deltaNotionalCents,
        priceCents,
        rawQty,
        finalQty: qty,
        cappedByWeight,
        cappedByNotional,
        cappedByCash,
        cappedByPosition
      };
      return { qty: 0, sizingDetails: sizingDetails2, rejection };
    }
    const sizingDetails = {
      targetWeightDecimal,
      targetNotionalCents,
      currentNotionalCents,
      deltaNotionalCents,
      priceCents,
      rawQty,
      finalQty: qty,
      cappedByWeight,
      cappedByNotional,
      cappedByCash,
      cappedByPosition
    };
    return { qty, sizingDetails, rejection: null };
  }
};

// src/services/tradingCycleService.ts
init_logger();
var log40 = logger.child({ component: "trading-cycle" });
var MIN_CONFIDENCE_THRESHOLD = 0.6;
var MIN_SENTIMENT_THRESHOLD = 0.15;
var MAX_POSITION_WEIGHT = 0.05;
var CONVICTION_HURDLE = 0.65;
function allocateBudgetKnapsack(candidates, budgetPercent) {
  const allocations = /* @__PURE__ */ new Map();
  const sorted = [...candidates].sort((a, b) => b.conviction - a.conviction);
  let remainingBudget = budgetPercent;
  for (const candidate of sorted) {
    if (candidate.conviction < CONVICTION_HURDLE) continue;
    if (remainingBudget <= 0) break;
    const desiredWeight = Math.min(
      candidate.conviction * MAX_POSITION_WEIGHT,
      // Scale by conviction
      MAX_POSITION_WEIGHT,
      remainingBudget
    );
    if (desiredWeight > 5e-3) {
      allocations.set(candidate.symbol, desiredWeight);
      remainingBudget -= desiredWeight;
    }
  }
  return allocations;
}
function generateDecisionsFromFinBERT(assessments, currentPositions, constraints, budgetContext) {
  const positionSet = new Set(currentPositions.map((s) => s.toUpperCase()));
  const decisions = [];
  const buyCandidates = [];
  for (const a of assessments) {
    const symbol = a.symbol.toUpperCase();
    const isHolding = positionSet.has(symbol);
    const confidence = Number.isFinite(a.finbertConfidence) ? a.finbertConfidence : 0;
    const sentiment = Number.isFinite(a.finbertScore) ? a.finbertScore : 0;
    if (constraints.symbolBlocklist.includes(symbol)) continue;
    if (!isHolding && confidence >= MIN_CONFIDENCE_THRESHOLD && sentiment > MIN_SENTIMENT_THRESHOLD) {
      buyCandidates.push({
        symbol,
        sentiment,
        confidence,
        label: a.finbertLabel,
        conviction: Math.abs(sentiment) * confidence
      });
    }
  }
  const effectiveBudget = budgetContext ? Math.min(budgetContext.availableCashPercent, budgetContext.maxNewAllocationPercent) : 100;
  const buyAllocations = allocateBudgetKnapsack(buyCandidates, effectiveBudget / 100);
  for (const a of assessments) {
    const symbol = a.symbol.toUpperCase();
    const isHolding = positionSet.has(symbol);
    const confidence = Number.isFinite(a.finbertConfidence) ? a.finbertConfidence : 0;
    const sentiment = Number.isFinite(a.finbertScore) ? a.finbertScore : 0;
    if (constraints.symbolBlocklist.includes(symbol)) continue;
    let action;
    let targetWeight;
    let rationale;
    if (confidence < MIN_CONFIDENCE_THRESHOLD || Math.abs(sentiment) < MIN_SENTIMENT_THRESHOLD) {
      action = "hold";
      rationale = `FinBERT: confidence=${confidence.toFixed(2)}, sentiment=${sentiment.toFixed(2)} - below thresholds`;
    } else if (sentiment > MIN_SENTIMENT_THRESHOLD) {
      if (isHolding) {
        action = "add";
        targetWeight = Math.min(MAX_POSITION_WEIGHT, sentiment * confidence * MAX_POSITION_WEIGHT);
        rationale = `FinBERT positive (${a.finbertLabel}): score=${sentiment.toFixed(2)}, conf=${confidence.toFixed(2)} \u2192 add to ${(targetWeight * 100).toFixed(1)}%`;
      } else {
        const allocated = buyAllocations.get(symbol);
        if (allocated) {
          action = "buy";
          targetWeight = allocated;
          const conviction = Math.abs(sentiment) * confidence;
          rationale = `FinBERT positive (${a.finbertLabel}): conviction=${conviction.toFixed(2)} \u2192 allocated ${(targetWeight * 100).toFixed(1)}%`;
        } else {
          action = "hold";
          const conviction = Math.abs(sentiment) * confidence;
          rationale = `FinBERT positive but skipped: conviction=${conviction.toFixed(2)} below hurdle or budget exhausted`;
        }
      }
    } else {
      action = isHolding ? "trim" : "hold";
      targetWeight = isHolding ? 0.01 : void 0;
      rationale = `FinBERT negative (${a.finbertLabel}): score=${sentiment.toFixed(2)}, conf=${confidence.toFixed(2)}`;
    }
    decisions.push({
      symbol,
      action,
      targetWeight,
      confidence,
      rationale,
      runId: ""
    });
  }
  decisions.sort((a, b) => b.confidence - a.confidence);
  return {
    decisions,
    timestamp: Date.now()
  };
}
var RUN_TIMEOUT_MS = 60 * 60 * 1e3;
function createTradingCycleService(deps) {
  return new TradingCycleServiceImpl(deps);
}
var TradingCycleServiceImpl = class {
  constructor(deps) {
    this.deps = deps;
  }
  deps;
  computeAndSaveTelemetry(runId, analystModel, pmModel, assessmentCount, cycleStartTime, analystStartTime) {
    try {
      const cycleEndTime = Date.now();
      const analystLatency = analystStartTime ? cycleEndTime - analystStartTime : 0;
      const pmLatency = cycleEndTime - cycleStartTime - analystLatency;
      const analystTokensIn = Math.ceil(assessmentCount * 1300);
      const analystTokensOut = Math.ceil(assessmentCount * 200);
      const pmTokensIn = assessmentCount > 0 ? 2e3 : 0;
      const pmTokensOut = assessmentCount > 0 ? 200 : 0;
      const modelPricing = {
        "gpt-4o": { inputPer1k: 3e-3, outputPer1k: 6e-3 },
        "gpt-4o-mini": { inputPer1k: 15e-5, outputPer1k: 6e-4 },
        "gpt-4-turbo": { inputPer1k: 0.01, outputPer1k: 0.03 },
        "gpt-4": { inputPer1k: 0.03, outputPer1k: 0.06 }
      };
      const getPricing = (model) => modelPricing[model] || modelPricing["gpt-4-turbo"];
      const analystPricing = getPricing(analystModel);
      const pmPricing = getPricing(pmModel);
      const analystCost = (analystTokensIn * analystPricing.inputPer1k + analystTokensOut * analystPricing.outputPer1k) / 1e3;
      const pmCost = (pmTokensIn * pmPricing.inputPer1k + pmTokensOut * pmPricing.outputPer1k) / 1e3;
      const totalCost = analystCost + pmCost;
      const tokenUsageJson = JSON.stringify({
        models: { analyst: analystModel, portfolioManager: pmModel },
        tokens: {
          analyst: { input: analystTokensIn, output: analystTokensOut },
          portfolioManager: { input: pmTokensIn, output: pmTokensOut }
        },
        cost: {
          analyst: Number(analystCost.toFixed(6)),
          portfolioManager: Number(pmCost.toFixed(6)),
          total: Number(totalCost.toFixed(6))
        },
        latency_ms: {
          analyst: analystLatency,
          portfolioManager: pmLatency,
          total: cycleEndTime - cycleStartTime
        }
      });
      this.deps.runsRepo.updateTokenUsage(runId, tokenUsageJson);
    } catch (err) {
      log40.warn("failed to save telemetry", { runId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  async execute(trigger) {
    const settings = this.deps.getSettings();
    if (settings.trading.killSwitch) {
      const id = this.deps.runsRepo.create({
        trigger,
        status: "running",
        startedAt: Date.now(),
        finishedAt: null,
        model: settings.llm.model,
        settingsSnapshot: JSON.stringify(settings),
        error: null,
        tokenUsageJson: null,
        skipReason: null,
        summaryJson: null
      });
      this.deps.runsRepo.setSkipped(id, "kill switch is active");
      return;
    }
    if (!settings.trading.enabled) {
      const id = this.deps.runsRepo.create({
        trigger,
        status: "running",
        startedAt: Date.now(),
        finishedAt: null,
        model: settings.llm.model,
        settingsSnapshot: JSON.stringify(settings),
        error: null,
        tokenUsageJson: null,
        skipReason: null,
        summaryJson: null
      });
      this.deps.runsRepo.setSkipped(id, "trading is disabled");
      return;
    }
    const recentRuns = this.deps.runsRepo.list(10);
    const activeRun = recentRuns.find((r) => r.status === "running");
    if (activeRun) {
      if (Date.now() - activeRun.startedAt > RUN_TIMEOUT_MS) {
        this.deps.runsRepo.updateStatus(activeRun.id, "failed", "run timed out (stale lock)");
      } else {
        log40.warn("another run is active, skipping", { activeRunId: activeRun.id });
        return;
      }
    }
    const runId = this.deps.runsRepo.create({
      trigger,
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      model: settings.llm.model,
      settingsSnapshot: JSON.stringify(settings),
      error: null,
      tokenUsageJson: null,
      skipReason: null,
      summaryJson: null
    });
    const cycleStartTime = Date.now();
    let analystStartTime;
    let assessmentCount = 0;
    const analystModel = resolveConfigForAgent("analyst").model;
    const pmModel = resolveConfigForAgent("portfolioManager").model;
    try {
      if (this.deps.broker.processPendingOrders) {
        try {
          await this.deps.broker.processPendingOrders();
        } catch (err) {
          log40.warn("processPendingOrders failed", {
            runId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
      const portfolio = await this.deps.portfolioService.getPortfolio();
      let symbols = [];
      if (this.deps.runScreener && this.deps.screenerDeps) {
        try {
          emitProgress(runId, "screener", "Running screener...");
          const screenerResult = await this.deps.runScreener(runId, settings, this.deps.screenerDeps);
          if (screenerResult?.selections && screenerResult.selections.length > 0) {
            symbols = screenerResult.selections.map((s) => s.symbol);
            log40.info("screener selected symbols", { runId, count: symbols.length });
          }
        } catch (err) {
          log40.warn("screener failed, falling back to manual watchlist", {
            runId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
      if (symbols.length === 0) {
        symbols = this.deps.watchlistRepo.list().filter((s) => s.enabled).map((s) => s.symbol);
      }
      if (symbols.length === 0) {
        this.deps.runsRepo.setSkipped(runId, "no symbols to analyze");
        return;
      }
      const llmLimits = getLlmLimits2(settings.llm.localLlmMode);
      const analystConfig = {
        investorProfile: settings.investorProfile,
        maxContextTokens: llmLimits.maxContextTokens
      };
      emitProgress(runId, "analyst", `Prefetching data for ${symbols.length} symbols`);
      await Promise.all(symbols.map((symbol) => prefetchForSymbol(symbol, this.deps.analystDeps.toolsDeps)));
      emitProgress(runId, "analyst", `Starting analysis for ${symbols.length} symbols`);
      analystStartTime = Date.now();
      const rawResults = await runWithConcurrency(symbols, llmLimits.concurrency, async (symbol) => {
        try {
          return await runAnalystAgent(runId, symbol, this.deps.analystDeps, analystConfig);
        } catch (err) {
          log40.warn("analyst agent threw unexpectedly", {
            symbol,
            runId,
            error: err instanceof Error ? err.message : String(err)
          });
          return null;
        }
      });
      const assessments = rawResults.filter((a) => a !== null);
      assessmentCount = assessments.length;
      log40.info("analyst phase complete", {
        runId,
        total: symbols.length,
        succeeded: assessments.length
      });
      if (assessments.length === 0) {
        this.deps.runsRepo.updateStatus(runId, "failed", "all analyst agents failed");
        return;
      }
      emitProgress(runId, "finbert", "Running FinBERT sentiment analysis");
      const enhancedAssessments = [];
      for (const assessment of assessments) {
        try {
          const finbertResult = await scoreFinBERT(assessment.sentimentSummary);
          enhancedAssessments.push({
            ...assessment,
            finbertScore: finbertResult.normalizedScore,
            finbertLabel: finbertResult.label,
            finbertConfidence: finbertResult.score
          });
          log40.debug("FinBERT scored assessment", {
            symbol: assessment.symbol,
            llmScore: assessment.score,
            finbertScore: finbertResult.normalizedScore,
            finbertLabel: finbertResult.label
          });
        } catch (err) {
          log40.warn("FinBERT scoring failed, using LLM score", {
            symbol: assessment.symbol,
            error: err instanceof Error ? err.message : String(err)
          });
          enhancedAssessments.push({
            ...assessment,
            finbertScore: assessment.score,
            finbertLabel: assessment.score > 0.15 ? "positive" : assessment.score < -0.15 ? "negative" : "neutral",
            finbertConfidence: assessment.confidence
          });
        }
      }
      log40.info("FinBERT scoring complete", { runId, count: enhancedAssessments.length });
      const assessmentIdBySymbol = /* @__PURE__ */ new Map();
      for (const a of enhancedAssessments) {
        const id = this.deps.assessmentsRepo.create({
          runId,
          symbol: a.symbol,
          score: a.score,
          confidence: a.confidence,
          thesis: a.thesis,
          risks: a.risks ?? null,
          catalysts: a.catalysts ?? null,
          evidenceIdsJson: null,
          sentimentSummary: a.sentimentSummary,
          finbertScore: a.finbertScore,
          finbertLabel: a.finbertLabel,
          finbertConfidence: a.finbertConfidence
        });
        assessmentIdBySymbol.set(a.symbol, id);
        if (this.deps.semanticMemory) {
          this.deps.semanticMemory.storeAssessmentEmbedding({
            assessmentId: id,
            runId,
            symbol: a.symbol,
            score: a.score,
            thesis: a.thesis,
            risks: a.risks,
            catalysts: a.catalysts
          }).catch((err) => {
            log40.warn("failed to store assessment embedding", {
              assessmentId: id,
              error: err instanceof Error ? err.message : String(err)
            });
          });
        }
      }
      const positionWeights = {};
      for (const position of portfolio.positions) {
        positionWeights[position.symbol] = portfolio.totalValueCents > 0 ? position.marketValueCents / portfolio.totalValueCents : 0;
      }
      const portfolioContext = {
        cashPercent: portfolio.totalValueCents > 0 ? portfolio.cashCents / portfolio.totalValueCents * 100 : 100,
        currentPositions: portfolio.positions.map((p) => p.symbol),
        positionCount: portfolio.positions.length,
        positionWeights
      };
      const portfolioConstraints = {
        maxPositionWeightPercent: settings.risk.maxPositionWeightPercent,
        maxConcurrentPositions: settings.risk.maxConcurrentPositions,
        maxNewPositionsPerRun: settings.risk.maxNewPositionsPerRun,
        minCashReservePercent: settings.risk.minCashReservePercent,
        minConfidenceThreshold: settings.risk.minConfidenceThreshold,
        symbolBlocklist: settings.risk.symbolBlocklist,
        investorProfile: settings.investorProfile
      };
      emitProgress(runId, "portfolio-manager", "Generating decisions from FinBERT scores");
      const budgetContext = {
        availableCashPercent: Math.max(0, portfolioContext.cashPercent - settings.risk.minCashReservePercent),
        maxNewAllocationPercent: settings.risk.maxNewAllocationPercentPerRun
      };
      log40.info("budget context for knapsack allocation", {
        runId,
        availableCashPercent: budgetContext.availableCashPercent.toFixed(1),
        maxNewAllocationPercent: budgetContext.maxNewAllocationPercent,
        effectiveBudget: Math.min(budgetContext.availableCashPercent, budgetContext.maxNewAllocationPercent).toFixed(1)
      });
      const decisionSet = generateDecisionsFromFinBERT(
        enhancedAssessments,
        portfolioContext.currentPositions,
        portfolioConstraints,
        budgetContext
      );
      for (const d of decisionSet.decisions) {
        d.runId = runId;
      }
      log40.info("rule-based decisions generated", {
        runId,
        count: decisionSet.decisions.length,
        actions: decisionSet.decisions.map((d) => `${d.symbol}:${d.action}`).join(", ")
      });
      const persistedDecisions = decisionSet.decisions.map((d) => {
        const id = this.deps.decisionsRepo.create({
          runId,
          symbol: d.symbol,
          action: d.action,
          targetWeight: d.targetWeight ?? null,
          confidence: d.confidence,
          rationale: d.rationale,
          assessmentId: assessmentIdBySymbol.get(d.symbol) ?? null
        });
        return { ...d, id };
      });
      const decisionSetWithIds = { decisions: persistedDecisions, timestamp: decisionSet.timestamp };
      if (this.deps.calibrationRepo) {
        for (const d of persistedDecisions) {
          const predictedDirection = d.action === "buy" || d.action === "add" ? "long" : d.action === "sell" || d.action === "trim" ? "short" : "hold";
          this.deps.calibrationRepo.create({
            runId,
            symbol: d.symbol,
            predictedDirection,
            confidence: d.confidence
          });
        }
      }
      emitProgress(runId, "risk", "Computing volatility metrics");
      const volatilityBySymbol = /* @__PURE__ */ new Map();
      for (const symbol of symbols) {
        volatilityBySymbol.set(symbol, null);
      }
      emitProgress(runId, "risk", "Evaluating risk constraints");
      const riskConstraints = {
        maxPositionWeightPercent: settings.risk.maxPositionWeightPercent,
        maxConcurrentPositions: settings.risk.maxConcurrentPositions,
        maxNewPositionsPerRun: settings.risk.maxNewPositionsPerRun,
        minCashReservePercent: settings.risk.minCashReservePercent,
        maxOrderNotionalCents: settings.risk.maxOrderNotionalCents,
        minConfidenceThreshold: settings.risk.minConfidenceThreshold,
        symbolBlocklist: settings.risk.symbolBlocklist,
        maxVolatility: settings.investorProfile.maxVolatility,
        broker: settings.trading.mode
      };
      const riskService = createRiskService(riskConstraints, this.deps.priceFeed);
      const { orders, rejections } = await riskService.evaluate({
        decisionSet: decisionSetWithIds,
        portfolio,
        runId,
        earningsBlackoutSymbols: void 0,
        volatilityBySymbol
      });
      const rejectionsRepo = new RejectionsRepo(this.deps.db);
      for (const r of rejections) {
        rejectionsRepo.create(r, runId);
        log40.debug("order rejected", { symbol: r.symbol, reason: r.reason });
      }
      let ordersSubmitted = 0;
      for (const proposal of orders) {
        try {
          const req = {
            clientOrderId: proposal.order.clientOrderId,
            symbol: proposal.order.symbol,
            side: proposal.order.side,
            qty: proposal.order.qty,
            type: proposal.order.type,
            tif: proposal.order.tif
          };
          const orderState = await this.deps.broker.submitOrder(req);
          const localOrderId = this.deps.ordersRepo.create({
            clientOrderId: req.clientOrderId,
            decisionId: proposal.order.decisionId ?? null,
            runId,
            broker: "alpaca",
            brokerOrderId: orderState.id,
            mode: "paper",
            symbol: req.symbol,
            side: req.side,
            qty: req.qty,
            type: req.type,
            limitPriceCents: req.limitPriceCents ?? null,
            tif: req.tif,
            status: orderState.status,
            rejectReason: orderState.rejectReason,
            submittedAt: orderState.submittedAt
          });
          ordersSubmitted++;
          log40.info("order submitted", {
            runId,
            symbol: proposal.order.symbol,
            side: proposal.order.side,
            qty: proposal.order.qty,
            status: orderState.status,
            brokerOrderId: orderState.id,
            localOrderId
          });
        } catch (err) {
          log40.warn("order submission failed", {
            symbol: proposal.order.symbol,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      }
      this.deps.runsRepo.updateStatus(runId, "succeeded");
      emitProgress(runId, "complete", `Run complete: ${ordersSubmitted} orders submitted`);
      log40.info("trading cycle complete", {
        runId,
        ordersSubmitted,
        totalOrders: orders.length,
        rejections: rejections.length
      });
    } catch (err) {
      this.deps.runsRepo.updateStatus(
        runId,
        "failed",
        err instanceof Error ? err.message : String(err)
      );
      log40.error("trading cycle failed", {
        runId,
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      this.computeAndSaveTelemetry(runId, analystModel, pmModel, assessmentCount, cycleStartTime, analystStartTime);
    }
  }
};

// src/llm/embeddingService.ts
init_logger();
var log41 = logger.child({ component: "embedding" });
var DEFAULT_OPENAI_MODEL = "text-embedding-3-large";
var DEFAULT_GEMINI_MODEL = "gemini-embedding-001";
function createEmbeddingService(config = {}) {
  const settings = getSettings();
  const provider = config.provider ?? settings.semanticMemory.provider ?? "openai";
  const useGemini = provider === "gemini";
  const embeddingModel = config.model || settings.semanticMemory.model?.trim() || (useGemini ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL);
  async function embed(text) {
    const [result] = await embedBatch([text]);
    return result;
  }
  async function embedBatch(texts) {
    if (texts.length === 0) return [];
    const apiKey = resolveApiKey(config.apiKey);
    if (!apiKey) throw new LlmNotConfiguredError();
    log41.debug("generating embeddings", { count: texts.length, model: embeddingModel, provider });
    if (useGemini) {
      return embedBatchGemini(texts, apiKey, embeddingModel);
    } else {
      return embedBatchOpenAI(texts, apiKey, embeddingModel);
    }
  }
  return { embed, embedBatch };
}
async function embedBatchOpenAI(texts, apiKey, model) {
  const url = "https://api.openai.com/v1/embeddings";
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({ model, input: texts })
  });
  if (!response.ok) {
    const errorText = await response.text();
    log41.error("embedding API error", { status: response.status, error: errorText });
    throw new Error(`Embedding API error: ${response.status} ${errorText}`);
  }
  const data = await response.json();
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}
async function embedBatchGemini(texts, apiKey, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: { parts: [{ text }] }
      }))
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    log41.error("embedding API error", { status: response.status, error: errorText });
    throw new Error(`Embedding API error: ${response.status} ${errorText}`);
  }
  const data = await response.json();
  return data.embeddings.map((e) => e.values);
}
function truncateForEmbedding(text, maxChars = 24e3) {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + "...";
}
function assessmentToEmbeddingText(assessment) {
  const parts = [
    `Symbol: ${assessment.symbol}`,
    `Score: ${assessment.score}`,
    `Thesis: ${assessment.thesis}`
  ];
  if (assessment.risks) parts.push(`Risks: ${assessment.risks}`);
  if (assessment.catalysts) parts.push(`Catalysts: ${assessment.catalysts}`);
  return truncateForEmbedding(parts.join("\n"));
}
function tradeOutcomeToEmbeddingText(outcome) {
  const pnlDollars = (outcome.realizedPnlCents / 100).toFixed(2);
  const returnPercent = outcome.avgCostCents !== 0 ? ((outcome.exitPriceCents - outcome.avgCostCents) / outcome.avgCostCents * 100).toFixed(2) : "0.00";
  const holdingDays = outcome.holdingPeriodMs != null ? Math.max(0, Math.round(outcome.holdingPeriodMs / 864e5)) : null;
  const parts = [
    `Symbol: ${outcome.symbol}`,
    `Outcome: ${outcome.side.toUpperCase()} ${outcome.qty} shares realized P&L $${pnlDollars} (${returnPercent}%)`,
    `Entry: $${(outcome.avgCostCents / 100).toFixed(2)}, Exit: $${(outcome.exitPriceCents / 100).toFixed(2)}`
  ];
  if (holdingDays !== null) parts.push(`Held: ${holdingDays} day(s)`);
  if (outcome.thesis) parts.push(`Original thesis: ${outcome.thesis}`);
  return truncateForEmbedding(parts.join("\n"));
}

// src/repos/embeddingsRepo.ts
import { randomUUID as randomUUID7 } from "crypto";
var EmbeddingsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(input) {
    const id = randomUUID7();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO embeddings (id, source_type, source_id, run_id, symbol, text_content, embedding_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.sourceType,
      input.sourceId,
      input.runId,
      input.symbol ?? null,
      input.textContent,
      JSON.stringify(input.embedding),
      now
    );
    return id;
  }
  /**
   * Find similar embeddings using cosine similarity.
   * Pure JS implementation - no sqlite-vss extension required.
   */
  findSimilar(queryEmbedding, opts) {
    const { symbol, limit = 5, excludeRunId } = opts;
    let sql = `SELECT id, source_type, source_id, run_id, symbol, text_content, embedding_json FROM embeddings WHERE 1=1`;
    const params = [];
    if (symbol) {
      sql += ` AND symbol = ?`;
      params.push(symbol);
    }
    if (excludeRunId) {
      sql += ` AND run_id != ?`;
      params.push(excludeRunId);
    }
    const rows = this.db.prepare(sql).all(...params);
    const scored = rows.map((row) => {
      const embedding = JSON.parse(row.embedding_json);
      const similarity = cosineSimilarity(queryEmbedding, embedding);
      return {
        id: row.id,
        sourceType: row.source_type,
        sourceId: row.source_id,
        runId: row.run_id,
        symbol: row.symbol,
        textContent: row.text_content,
        similarity
      };
    });
    return scored.sort((a, b) => b.similarity - a.similarity).slice(0, limit);
  }
  getBySourceId(sourceType, sourceId) {
    const row = this.db.prepare(`
      SELECT id, source_type, source_id, run_id, symbol, text_content, embedding_json, created_at
      FROM embeddings WHERE source_type = ? AND source_id = ?
    `).get(sourceType, sourceId);
    if (!row) return null;
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      runId: row.run_id,
      symbol: row.symbol,
      textContent: row.text_content,
      embedding: JSON.parse(row.embedding_json),
      createdAt: row.created_at
    };
  }
  countBySymbol(symbol) {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM embeddings WHERE symbol = ?`).get(symbol);
    return row.count;
  }
};
function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

// src/services/semanticMemoryService.ts
init_logger();
var log42 = logger.child({ component: "semantic-memory" });
function createSemanticMemoryService(db2, embeddingService) {
  const repo = new EmbeddingsRepo(db2);
  const embedder = embeddingService ?? createEmbeddingService();
  return {
    async getSimilarSituations(params) {
      const { symbol, description, limit = 5, excludeRunId } = params;
      try {
        const queryText = `Symbol: ${symbol}
Description: ${description}`;
        const queryEmbedding = await embedder.embed(queryText);
        const results = repo.findSimilar(queryEmbedding, {
          symbol,
          limit,
          excludeRunId
        });
        return results.map((r) => ({
          runId: r.runId,
          symbol: r.symbol,
          sourceType: r.sourceType,
          content: r.textContent,
          similarity: r.similarity
        }));
      } catch (err) {
        log42.warn("failed to get similar situations", {
          symbol,
          error: err instanceof Error ? err.message : String(err)
        });
        return [];
      }
    },
    async storeAssessmentEmbedding(params) {
      try {
        const text = assessmentToEmbeddingText({
          symbol: params.symbol,
          score: params.score,
          thesis: params.thesis,
          risks: params.risks,
          catalysts: params.catalysts
        });
        const embedding = await embedder.embed(text);
        repo.create({
          sourceType: "assessment",
          sourceId: params.assessmentId,
          runId: params.runId,
          symbol: params.symbol,
          textContent: text,
          embedding
        });
        log42.debug("stored assessment embedding", {
          assessmentId: params.assessmentId,
          symbol: params.symbol
        });
      } catch (err) {
        log42.warn("failed to store assessment embedding", {
          assessmentId: params.assessmentId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    },
    async storeArtifactEmbedding(params) {
      try {
        if (!params.summary) return;
        const text = [
          params.symbol ? `Symbol: ${params.symbol}` : null,
          `Source: ${params.source}`,
          `Provider: ${params.provider}`,
          `Summary: ${params.summary}`
        ].filter(Boolean).join("\n");
        const embedding = await embedder.embed(text);
        repo.create({
          sourceType: "artifact",
          sourceId: params.artifactId,
          runId: params.runId,
          symbol: params.symbol ?? void 0,
          textContent: text,
          embedding
        });
        log42.debug("stored artifact embedding", {
          artifactId: params.artifactId,
          symbol: params.symbol
        });
      } catch (err) {
        log42.warn("failed to store artifact embedding", {
          artifactId: params.artifactId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    },
    async storeTradeOutcomeEmbedding(params) {
      try {
        const text = tradeOutcomeToEmbeddingText({
          symbol: params.symbol,
          side: params.side,
          qty: params.qty,
          avgCostCents: params.avgCostCents,
          exitPriceCents: params.exitPriceCents,
          realizedPnlCents: params.realizedPnlCents,
          holdingPeriodMs: params.holdingPeriodMs,
          thesis: params.thesis
        });
        const embedding = await embedder.embed(text);
        repo.create({
          sourceType: "trade_outcome",
          sourceId: params.orderId,
          runId: params.runId,
          symbol: params.symbol,
          textContent: text,
          embedding
        });
        log42.debug("stored trade outcome embedding", {
          orderId: params.orderId,
          symbol: params.symbol,
          assessmentId: params.assessmentId ?? null
        });
      } catch (err) {
        log42.warn("failed to store trade outcome embedding", {
          orderId: params.orderId,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  };
}

// src/scheduler/index.ts
var log43 = logger.child({ component: "scheduler" });
var activeJob = null;
var snapshotCronJob = null;
var priceBackfillJob = null;
var signalCollectionJob = null;
var regimeDetectionJob = null;
var weeklyPlannerJob = null;
var trancheExecutorJob = null;
var watchlistCuratorJob = null;
function stopAllJobs() {
  if (activeJob) {
    activeJob.stop();
    activeJob = null;
  }
  if (snapshotCronJob) {
    snapshotCronJob.stop();
    snapshotCronJob = null;
  }
  if (priceBackfillJob) {
    priceBackfillJob.stop();
    priceBackfillJob = null;
  }
  if (signalCollectionJob) {
    signalCollectionJob.stop();
    signalCollectionJob = null;
  }
  if (regimeDetectionJob) {
    regimeDetectionJob.stop();
    regimeDetectionJob = null;
  }
  if (weeklyPlannerJob) {
    weeklyPlannerJob.stop();
    weeklyPlannerJob = null;
  }
  if (trancheExecutorJob) {
    trancheExecutorJob.stop();
    trancheExecutorJob = null;
  }
  if (watchlistCuratorJob) {
    watchlistCuratorJob.stop();
    watchlistCuratorJob = null;
  }
}
function registerAllJobs() {
  const db2 = getDatabase();
  const settings = getSettings();
  stopAllJobs();
  log43.info("re-registering all scheduler jobs");
  const { cron, timezone } = settings.schedule;
  try {
    activeJob = new Cron(cron, { timezone, protect: true }, async () => {
      const currentSettings = getSettings();
      if (currentSettings.execution.enabled) {
        log43.info("trading cycle skipped (strategic execution enabled, use plan-based trading)");
        return;
      }
      try {
        const db3 = getDatabase();
        const settings2 = getSettings();
        const runsRepo = new RunsRepo(db3);
        const assessmentsRepo = new AssessmentsRepo(db3);
        const decisionsRepo = new DecisionsRepo(db3);
        const ordersRepo = new OrdersRepo(db3);
        const positionsRepo = new PositionsRepo(db3);
        const portfolioRepo = new PortfolioRepo(db3);
        const pricesRepo = new PricesRepo(db3);
        const messagesRepo = new AgentMessagesRepo(db3);
        const artifactsRepo = new ArtifactsRepo(db3);
        const watchlistRepo = new WatchlistRepo(db3);
        let semanticMemory;
        if (settings2.semanticMemory.enabled) {
          if (resolveApiKey()) {
            semanticMemory = createSemanticMemoryService(db3, createEmbeddingService());
          } else {
            log43.warn("semantic memory enabled but no LLM API key configured; skipping");
          }
        }
        const priceService = new PriceService(pricesRepo);
        const portfolioService = new PortfolioServiceImpl(db3, priceService, positionsRepo, portfolioRepo);
        const apiKey = process.env.ALPACA_API_KEY;
        const apiSecret = process.env.ALPACA_API_SECRET;
        if (!apiKey || !apiSecret) {
          throw new Error("ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required for Alpaca paper trading");
        }
        const broker = new AlpacaBroker({
          apiKey,
          apiSecret,
          paperTrading: true
        });
        const runCache = new RunCache();
        const sectorSource = new SectorPerformanceDataSource({ pricesRepo });
        const analystDeps = {
          toolsDeps: {
            newsSource: dataSourceRegistry.get("news"),
            fundamentalsSource: dataSourceRegistry.get("fundamentals"),
            macroSource: dataSourceRegistry.get("macro"),
            optionsSource: dataSourceRegistry.get("options"),
            sectorSource,
            pricesRepo,
            portfolioService,
            decisionsRepo,
            cache: runCache,
            semanticMemory,
            llmLimits: getLlmLimits3(settings2.llm.localLlmMode)
          },
          messagesRepo,
          artifactsRepo
        };
        const screenerSelectionsRepo = new ScreenerSelectionsRepo(db3);
        const screenerAgentDeps = {
          toolsDeps: {
            sectorSource,
            fundamentalsSource: dataSourceRegistry.get("fundamentals"),
            optionsSource: dataSourceRegistry.get("options"),
            cache: runCache
          },
          messagesRepo,
          artifactsRepo
        };
        if (!portfolioRepo.read()) {
          portfolioRepo.write({
            cashCents: settings2.trading.startingCashCents,
            startingCashCents: settings2.trading.startingCashCents,
            startedAt: Date.now(),
            resetAt: null,
            baseCurrency: settings2.trading.baseCurrency
          });
        }
        const tradingCycle = createTradingCycleService({
          db: db3,
          runsRepo,
          assessmentsRepo,
          decisionsRepo,
          ordersRepo,
          portfolioService,
          broker,
          analystDeps,
          priceFeed: priceService,
          getSettings,
          watchlistRepo,
          semanticMemory,
          screenerDeps: {
            screenerSelectionsRepo,
            screenerAgentDeps,
            toolsDeps: analystDeps.toolsDeps
          },
          runScreener
        });
        await tradingCycle.execute("scheduled");
      } catch (err) {
        log43.error("trading cycle job failed", { error: err instanceof Error ? err.message : String(err) });
      }
    });
    log43.info("trading-cycle job registered", { cron, timezone, nextRun: activeJob.nextRun()?.toISOString() ?? null });
  } catch (err) {
    log43.error("failed to register trading-cycle job", { error: err instanceof Error ? err.message : String(err) });
    activeJob = null;
  }
  const snapshotCron = settings.jobSchedules?.snapshot || "30 16 * * 1-5";
  try {
    snapshotCronJob = new Cron(snapshotCron, { timezone: "America/New_York", protect: true }, async () => {
      await runSnapshotJob(db2);
    });
    log43.info("snapshot job registered", { cron: snapshotCron, nextRun: snapshotCronJob.nextRun()?.toISOString() ?? null });
  } catch (err) {
    log43.error("failed to register snapshot job", { error: err instanceof Error ? err.message : String(err) });
    snapshotCronJob = null;
  }
  const priceBackfillCron = settings.jobSchedules?.priceBackfill || "55 15 * * 1-5";
  try {
    priceBackfillJob = new Cron(priceBackfillCron, { timezone: "America/New_York", protect: true }, async () => {
      await runPriceBackfillJob(db2, { days: 7 });
    });
    log43.info("price-backfill job registered", { cron: priceBackfillCron, nextRun: priceBackfillJob.nextRun()?.toISOString() ?? null });
  } catch (err) {
    log43.error("failed to register price-backfill job", { error: err instanceof Error ? err.message : String(err) });
    priceBackfillJob = null;
  }
  const signalCron = settings.jobSchedules?.signalCollection || "0 16 * * 1-5";
  try {
    signalCollectionJob = new Cron(signalCron, { timezone: "America/New_York", protect: true }, async () => {
      await runSignalCollectionJob(db2);
    });
    log43.info("signal-collection job registered", { cron: signalCron });
  } catch (err) {
    log43.error("failed to register signal-collection job", { error: err instanceof Error ? err.message : String(err) });
    signalCollectionJob = null;
  }
  const regimeCron = settings.jobSchedules?.regimeDetection || "5 16 * * 1-5";
  try {
    regimeDetectionJob = new Cron(regimeCron, { timezone: "America/New_York", protect: true }, async () => {
      await runRegimeDetectionJob(db2);
    });
    log43.info("regime-detection job registered", { cron: regimeCron });
  } catch (err) {
    log43.error("failed to register regime-detection job", { error: err instanceof Error ? err.message : String(err) });
    regimeDetectionJob = null;
  }
  const plannerCron = settings.jobSchedules?.weeklyPlanner || "10 16 * * 1";
  try {
    weeklyPlannerJob = new Cron(plannerCron, { timezone: "America/New_York", protect: true }, async () => {
      await runWeeklyPlannerJob(db2);
    });
    log43.info("weekly-planner job registered", { cron: plannerCron });
  } catch (err) {
    log43.error("failed to register weekly-planner job", { error: err instanceof Error ? err.message : String(err) });
    weeklyPlannerJob = null;
  }
  const trancheCron = settings.jobSchedules?.trancheExecutor || "15 16 * * 1-5";
  try {
    trancheExecutorJob = new Cron(trancheCron, { timezone: "America/New_York", protect: true }, async () => {
      await runTrancheExecutorJob(db2);
    });
    log43.info("tranche-executor job registered", { cron: trancheCron });
  } catch (err) {
    log43.error("failed to register tranche-executor job", { error: err instanceof Error ? err.message : String(err) });
    trancheExecutorJob = null;
  }
  const curatorCron = settings.watchlist.curatorCron?.trim();
  if (curatorCron && settings.watchlist.mode === "dynamic") {
    try {
      watchlistCuratorJob = new Cron(curatorCron, { timezone: "America/New_York", protect: true }, async () => {
        await runWatchlistCuratorJob(db2);
      });
      log43.info("watchlist-curator job registered", { cron: curatorCron, nextRun: watchlistCuratorJob.nextRun()?.toISOString() ?? null });
    } catch (err) {
      log43.error("failed to register watchlist-curator job", { error: err instanceof Error ? err.message : String(err) });
      watchlistCuratorJob = null;
    }
  } else {
    log43.debug("watchlist curator not scheduled", { reason: !curatorCron ? "no cron set" : "not in dynamic mode" });
  }
}
function startScheduler() {
  registerAllJobs();
  settingsEvents.on("change", () => registerAllJobs());
}
function stopScheduler() {
  stopAllJobs();
  log43.info("scheduler stopped");
}
function getNextRuns(n) {
  if (!activeJob) return [];
  try {
    return activeJob.nextRuns(n).map((d) => d.toISOString());
  } catch {
    return [];
  }
}
function getJobSchedules() {
  const settings = getSettings();
  const jobSchedules = settings.jobSchedules || {};
  const jobs = [];
  const priceBackfillCron = jobSchedules.priceBackfill || "55 15 * * 1-5";
  if (priceBackfillJob) {
    jobs.push({
      name: "Price Backfill",
      cron: priceBackfillCron,
      nextRun: priceBackfillJob.nextRun()?.toISOString() ?? null,
      enabled: true
      // Always enabled
    });
  }
  const signalCron = jobSchedules.signalCollection || "0 16 * * 1-5";
  if (signalCollectionJob) {
    jobs.push({
      name: "Signal Collection",
      cron: signalCron,
      nextRun: signalCollectionJob.nextRun()?.toISOString() ?? null,
      enabled: settings.signals.enabled
    });
  }
  const regimeCron = jobSchedules.regimeDetection || "5 16 * * 1-5";
  if (regimeDetectionJob) {
    jobs.push({
      name: "Regime Detection",
      cron: regimeCron,
      nextRun: regimeDetectionJob.nextRun()?.toISOString() ?? null,
      enabled: settings.regime.enabled
    });
  }
  const plannerCron = jobSchedules.weeklyPlanner || "10 16 * * 1";
  if (weeklyPlannerJob) {
    jobs.push({
      name: "Weekly Planner",
      cron: plannerCron,
      nextRun: weeklyPlannerJob.nextRun()?.toISOString() ?? null,
      enabled: settings.execution.enabled
    });
  }
  const trancheCron = jobSchedules.trancheExecutor || "15 16 * * 1-5";
  if (trancheExecutorJob) {
    jobs.push({
      name: "Tranche Executor",
      cron: trancheCron,
      nextRun: trancheExecutorJob.nextRun()?.toISOString() ?? null,
      enabled: settings.execution.enabled
    });
  }
  const curatorCron = settings.watchlist.curatorCron;
  const curatorEnabled = settings.watchlist.mode === "dynamic" && !!curatorCron;
  jobs.push({
    name: "Watchlist Curator",
    cron: curatorCron || "disabled",
    nextRun: watchlistCuratorJob?.nextRun()?.toISOString() ?? null,
    enabled: curatorEnabled
  });
  const snapshotCron = jobSchedules.snapshot || "30 16 * * 1-5";
  if (snapshotCronJob) {
    jobs.push({
      name: "Snapshot",
      cron: snapshotCron,
      nextRun: snapshotCronJob.nextRun()?.toISOString() ?? null,
      enabled: true
      // Always enabled
    });
  }
  if (activeJob) {
    jobs.push({
      name: "Trading Cycle",
      cron: settings.schedule.cron,
      nextRun: activeJob.nextRun()?.toISOString() ?? null,
      enabled: settings.trading.enabled && !settings.execution.enabled
    });
  }
  return jobs;
}

// src/routes/scheduler.ts
function nextRunsHandler(req, res) {
  const n = Math.min(Math.max(parseInt(req.query["n"] || "5", 10), 1), 20);
  res.json({ nextRuns: getNextRuns(n) });
}
function jobSchedulesHandler(_req, res) {
  res.json({ jobs: getJobSchedules() });
}

// src/routes/trigger.ts
import { getLlmLimits as getLlmLimits4 } from "@atn-trd/shared";
init_logger();
import { JOB_REGISTRY, resolveExecutionOrder } from "@atn-trd/shared";
var log44 = logger.child({ component: "trigger-route" });
function validateJobSelection(jobIds) {
  if (!Array.isArray(jobIds)) {
    return { valid: false, error: "jobIds must be an array" };
  }
  if (jobIds.length === 0) {
    return { valid: false, error: "At least one job must be selected" };
  }
  const stringJobIds = jobIds.map((id) => String(id));
  const unknown = stringJobIds.filter((id) => !JOB_REGISTRY[id]);
  if (unknown.length > 0) {
    return { valid: false, error: `Unknown job IDs: ${unknown.join(", ")}` };
  }
  try {
    const executionOrder = resolveExecutionOrder(stringJobIds);
    return { valid: true, executionOrder };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Failed to resolve execution order"
    };
  }
}
function verifySchedulerAuth(req, res, next) {
  if (process.env.NODE_ENV !== "production") {
    return next();
  }
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization header" });
    return;
  }
  next();
}
async function triggerTradingCycleHandler(_req, res, next) {
  const startTime = Date.now();
  log44.info("trading cycle triggered by scheduler");
  try {
    const db2 = getDatabase();
    const settings = getSettings();
    const runsRepo = new RunsRepo(db2);
    const assessmentsRepo = new AssessmentsRepo(db2);
    const decisionsRepo = new DecisionsRepo(db2);
    const ordersRepo = new OrdersRepo(db2);
    const positionsRepo = new PositionsRepo(db2);
    const portfolioRepo = new PortfolioRepo(db2);
    const pricesRepo = new PricesRepo(db2);
    const messagesRepo = new AgentMessagesRepo(db2);
    const artifactsRepo = new ArtifactsRepo(db2);
    const watchlistRepo = new WatchlistRepo(db2);
    const screenerSelectionsRepo = new ScreenerSelectionsRepo(db2);
    let semanticMemory;
    if (settings.semanticMemory.enabled && resolveApiKey()) {
      semanticMemory = createSemanticMemoryService(db2, createEmbeddingService());
    }
    const priceService = new PriceService(pricesRepo);
    const portfolioService = new PortfolioServiceImpl(db2, priceService, positionsRepo, portfolioRepo);
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new Error("ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required for Alpaca paper trading");
    }
    const broker = new AlpacaBroker({
      apiKey,
      apiSecret,
      paperTrading: true
    });
    const runCache = new RunCache();
    const sectorSource = new SectorPerformanceDataSource({ pricesRepo });
    const analystDeps = {
      toolsDeps: {
        newsSource: dataSourceRegistry.get("news"),
        fundamentalsSource: dataSourceRegistry.get("fundamentals"),
        macroSource: dataSourceRegistry.get("macro"),
        optionsSource: dataSourceRegistry.get("options"),
        sectorSource,
        pricesRepo,
        portfolioService,
        decisionsRepo,
        cache: runCache,
        semanticMemory,
        llmLimits: getLlmLimits4(settings.llm.localLlmMode)
      },
      messagesRepo,
      artifactsRepo
    };
    if (!portfolioRepo.read()) {
      portfolioRepo.write({
        cashCents: settings.trading.startingCashCents,
        startingCashCents: settings.trading.startingCashCents,
        startedAt: Date.now(),
        resetAt: null,
        baseCurrency: settings.trading.baseCurrency
      });
    }
    const tradingCycle = createTradingCycleService({
      db: db2,
      runsRepo,
      assessmentsRepo,
      decisionsRepo,
      ordersRepo,
      portfolioService,
      broker,
      analystDeps,
      priceFeed: priceService,
      getSettings,
      watchlistRepo,
      semanticMemory,
      screenerDeps: {
        screenerSelectionsRepo,
        screenerAgentDeps: { messagesRepo, artifactsRepo },
        toolsDeps: analystDeps.toolsDeps
      },
      runScreener
    });
    await tradingCycle.execute("scheduled");
    const latestRun = runsRepo.list(1, 0)[0];
    const durationMs = Date.now() - startTime;
    log44.info("trading cycle completed", { runId: latestRun?.id, durationMs });
    res.json({ ok: true, runId: latestRun?.id, durationMs });
  } catch (err) {
    log44.error("trading cycle failed", { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
async function triggerSnapshotHandler(_req, res, next) {
  log44.info("snapshot triggered by scheduler");
  try {
    const db2 = getDatabase();
    await runSnapshotJob(db2);
    res.json({ ok: true });
  } catch (err) {
    log44.error("snapshot failed", { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
async function triggerSignalCollectionHandler(_req, res, next) {
  log44.info("signal collection triggered manually");
  try {
    const db2 = getDatabase();
    const summary = await runSignalCollectionJob(db2, "manual");
    res.json({ ok: true, summary });
  } catch (err) {
    log44.error("signal collection failed", { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
async function triggerPlanReviewHandler(_req, res, next) {
  log44.info("plan review triggered manually");
  try {
    const db2 = getDatabase();
    const summary = await runPlanReviewJob(db2, "manual");
    res.json({ ok: true, summary });
  } catch (err) {
    log44.error("plan review failed", { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
async function triggerTrancheExecutionHandler(_req, res, next) {
  log44.info("tranche execution triggered manually");
  try {
    const db2 = getDatabase();
    const summary = await runTrancheExecutorJob(db2, "manual");
    res.json({ ok: true, summary });
  } catch (err) {
    log44.error("tranche execution failed", { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
async function triggerWatchlistCurationHandler(_req, res, next) {
  log44.info("watchlist curation triggered manually");
  try {
    const db2 = getDatabase();
    const summary = await runWatchlistCuration(db2);
    res.json({ ok: true, summary });
  } catch (err) {
    log44.error("watchlist curation failed", { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
async function triggerBackfillSectorsHandler(_req, res, next) {
  log44.info("sector backfill triggered manually");
  try {
    const db2 = getDatabase();
    const result = await backfillSectors(db2);
    res.json({ ok: true, ...result });
  } catch (err) {
    log44.error("sector backfill failed", { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}
async function triggerRunSelectedHandler(req, res, next) {
  const startTime = Date.now();
  const db2 = getDatabase();
  const runsRepo = new RunsRepo(db2);
  try {
    const { jobIds } = req.body;
    const validation = validateJobSelection(jobIds);
    if (!validation.valid) {
      res.status(400).json({ ok: false, error: validation.error });
      return;
    }
    const executionOrder = validation.executionOrder || [];
    log44.info("selective job execution triggered", { jobCount: executionOrder.length });
    const parentRunId = runsRepo.create({
      trigger: "manual",
      status: "running",
      startedAt: Date.now(),
      finishedAt: null,
      model: null,
      settingsSnapshot: JSON.stringify({}),
      error: null,
      tokenUsageJson: null,
      skipReason: null,
      summaryJson: JSON.stringify({ selectedJobs: jobIds, executedJobs: [] })
    });
    emitProgress(parentRunId, "starting", `Starting selective job execution (${executionOrder.length} jobs)`);
    const runIds = [];
    const executedJobs = [];
    let lastError = null;
    for (const job of executionOrder) {
      emitProgress(parentRunId, "job-start", `Starting job: ${job.label}`, { jobId: job.id, jobName: job.label });
      try {
        let jobRunId;
        if (job.id === "price-backfill") {
          await runPriceBackfillJob(db2, { days: 7 }, "price_backfill");
          const latestRun = runsRepo.listByTrigger("price_backfill", 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === "signal-collection") {
          await runSignalCollectionJob(db2, "signal_collection");
          const latestRun = runsRepo.listByTrigger("signal_collection", 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === "plan-review") {
          await runPlanReviewJob(db2, "plan_review");
          const latestRun = runsRepo.listByTrigger("plan_review", 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === "tranche-execution") {
          await runTrancheExecutorJob(db2, "tranche_execution");
          const latestRun = runsRepo.listByTrigger("tranche_execution", 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === "watchlist-curation") {
          await runWatchlistCuration(db2);
          const latestRun = runsRepo.listByTrigger("watchlist_curation", 1)[0];
          jobRunId = latestRun?.id;
        } else if (job.id === "snapshot") {
          await runSnapshotJob(db2);
          const latestRun = runsRepo.listByTrigger("snapshot", 1)[0];
          jobRunId = latestRun?.id;
        }
        if (jobRunId) {
          runIds.push(jobRunId);
          executedJobs.push(job.id);
          const jobRun = runsRepo.get(jobRunId);
          const jobStatus = jobRun?.status || "unknown";
          if (jobStatus === "failed" || jobStatus === "skipped") {
            lastError = jobRun?.error || jobRun?.skipReason || `Job failed: ${job.id}`;
            emitProgress(parentRunId, "job-complete", `Job failed: ${job.label}`, { jobId: job.id, jobName: job.label });
            for (const remainingJob of executionOrder) {
              if (executionOrder.indexOf(remainingJob) > executionOrder.indexOf(job)) {
                const deps = JOB_REGISTRY[remainingJob.id]?.dependencies || [];
                if (deps.includes(job.id)) {
                  emitProgress(parentRunId, "job-complete", `Skipped (dependency failed): ${remainingJob.label}`, { jobId: remainingJob.id, jobName: remainingJob.label });
                }
              }
            }
            break;
          } else {
            emitProgress(parentRunId, "job-complete", `Completed: ${job.label}`, { jobId: job.id, jobName: job.label });
          }
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        log44.error(`Job execution failed: ${job.id}`, { error: lastError });
        emitProgress(parentRunId, "job-complete", `Error: ${lastError}`, { jobId: job.id, jobName: job.label });
        for (const remainingJob of executionOrder) {
          if (executionOrder.indexOf(remainingJob) > executionOrder.indexOf(job)) {
            const deps = JOB_REGISTRY[remainingJob.id]?.dependencies || [];
            if (deps.includes(job.id)) {
              emitProgress(parentRunId, "job-complete", `Skipped (dependency failed): ${remainingJob.label}`, { jobId: remainingJob.id, jobName: remainingJob.label });
            }
          }
        }
        break;
      }
    }
    const finalStatus = lastError ? "failed" : "succeeded";
    runsRepo.updateStatus(parentRunId, finalStatus, lastError || void 0);
    runsRepo.updateSummary(parentRunId, JSON.stringify({
      selectedJobs: jobIds,
      executedJobs,
      completedSuccessfully: !lastError,
      error: lastError
    }));
    emitProgress(parentRunId, "complete", `Job execution ${finalStatus}`, { jobId: parentRunId });
    const durationMs = Date.now() - startTime;
    log44.info("selective job execution completed", { runIds, durationMs, finalStatus });
    res.json({
      ok: !lastError,
      runIds,
      executionOrder: executionOrder.map((job) => ({
        id: job.id,
        label: job.label,
        description: job.description,
        estimatedRuntimeSeconds: job.estimatedRuntimeSeconds
      })),
      error: lastError || void 0
    });
  } catch (err) {
    log44.error("selective job execution handler failed", { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}

// src/routes/runs.ts
import { getLlmLimits as getLlmLimits5 } from "@atn-trd/shared";
init_errors();

// src/services/coverageService.ts
init_logger();
var log45 = logger.child({ component: "coverage-service" });
var COVERAGE_SOURCES = ["news", "fundamentals", "macro", "options", "prices"];
var COVERAGE_THRESHOLD_PERCENT = 80;
var CoverageServiceImpl = class {
  constructor(artifactsRepo, assessmentsRepo) {
    this.artifactsRepo = artifactsRepo;
    this.assessmentsRepo = assessmentsRepo;
  }
  artifactsRepo;
  assessmentsRepo;
  getCoverage(runId) {
    const artifacts = this.artifactsRepo.listByRun(runId);
    const assessments = this.assessmentsRepo.listByRun(runId);
    const symbolSet = /* @__PURE__ */ new Set();
    for (const a of artifacts) {
      if (a.symbol) {
        symbolSet.add(a.symbol);
      }
    }
    for (const ass of assessments) {
      symbolSet.add(ass.symbol);
    }
    const symbols = Array.from(symbolSet).sort();
    if (symbols.length === 0) {
      return {
        ok: true,
        data: {
          runId,
          thresholdPercent: COVERAGE_THRESHOLD_PERCENT,
          overallCoveragePercent: 100,
          belowThreshold: false,
          sources: COVERAGE_SOURCES,
          symbols: [],
          matrix: [],
          sourceSummary: COVERAGE_SOURCES.map((source) => ({
            source,
            okCount: 0,
            errorCount: 0,
            missingCount: 0,
            coveragePercent: 100
          }))
        }
      };
    }
    const matrix = [];
    const sourceTotals = {
      news: { ok: 0, error: 0, missing: 0 },
      fundamentals: { ok: 0, error: 0, missing: 0 },
      macro: { ok: 0, error: 0, missing: 0 },
      options: { ok: 0, error: 0, missing: 0 },
      prices: { ok: 0, error: 0, missing: 0 }
    };
    for (const symbol of symbols) {
      const cells = [];
      for (const source of COVERAGE_SOURCES) {
        const symbolArtifacts = artifacts.filter((a) => a.symbol === symbol && a.source === source);
        if (symbolArtifacts.length === 0) {
          cells.push({ source, status: "missing" });
          sourceTotals[source].missing++;
        } else {
          const sorted = [...symbolArtifacts].sort((a, b) => b.fetchedAt - a.fetchedAt);
          let successfulArtifact = sorted.find((a) => this.isPayloadSuccess(a.payloadJson, source));
          if (successfulArtifact) {
            cells.push({
              source,
              status: "ok",
              provider: successfulArtifact.provider,
              fetchedAt: successfulArtifact.fetchedAt
            });
            sourceTotals[source].ok++;
          } else {
            const latestArtifact = sorted[0];
            const errorMsg = this.extractErrorMessage(latestArtifact.payloadJson);
            cells.push({
              source,
              status: "error",
              provider: latestArtifact.provider,
              fetchedAt: latestArtifact.fetchedAt,
              error: errorMsg
            });
            sourceTotals[source].error++;
          }
        }
      }
      const okCount = cells.filter((c) => c.status === "ok").length;
      const coveragePercent = okCount / COVERAGE_SOURCES.length * 100;
      matrix.push({
        symbol,
        coveragePercent,
        cells
      });
    }
    const totalCells = symbols.length * COVERAGE_SOURCES.length;
    const totalOk = Object.values(sourceTotals).reduce((sum2, t) => sum2 + t.ok, 0);
    const overallCoveragePercent = totalCells > 0 ? totalOk / totalCells * 100 : 100;
    const sourceSummary = COVERAGE_SOURCES.map((source) => {
      const totals = sourceTotals[source];
      const sourceTotal = symbols.length;
      const sourceCoveragePercent = sourceTotal > 0 ? totals.ok / sourceTotal * 100 : 100;
      return {
        source,
        okCount: totals.ok,
        errorCount: totals.error,
        missingCount: totals.missing,
        coveragePercent: sourceCoveragePercent
      };
    });
    log45.debug("coverage calculated", {
      runId,
      symbolCount: symbols.length,
      overallCoveragePercent,
      belowThreshold: overallCoveragePercent < COVERAGE_THRESHOLD_PERCENT
    });
    return {
      ok: true,
      data: {
        runId,
        thresholdPercent: COVERAGE_THRESHOLD_PERCENT,
        overallCoveragePercent,
        belowThreshold: overallCoveragePercent < COVERAGE_THRESHOLD_PERCENT,
        sources: COVERAGE_SOURCES,
        symbols,
        matrix,
        sourceSummary
      }
    };
  }
  /**
   * Check if payload_json represents a successful data fetch.
   * Success = valid JSON object/array without an error field.
   */
  isPayloadSuccess(payloadJson, _source) {
    try {
      const payload = JSON.parse(payloadJson);
      if (Array.isArray(payload)) {
        return true;
      }
      if (typeof payload === "object" && payload !== null) {
        if ("error" in payload && payload.error) {
          return false;
        }
        if ("lc" in payload && "kwargs" in payload) {
          const kwargs = payload.kwargs;
          if (typeof kwargs.content === "string") {
            try {
              const inner = JSON.parse(kwargs.content);
              if (typeof inner === "object" && inner !== null && "error" in inner && inner.error) {
                return false;
              }
              return true;
            } catch {
              return false;
            }
          }
        }
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
  /**
   * Extract error message from payload JSON.
   * If it contains an error field, use that. Otherwise, return "unparseable payload".
   */
  extractErrorMessage(payloadJson) {
    try {
      const payload = JSON.parse(payloadJson);
      if (typeof payload === "object" && payload !== null && "error" in payload) {
        const errorField = payload.error;
        if (typeof errorField === "string") {
          return errorField;
        }
      }
      return "unparseable payload";
    } catch {
      return "unparseable payload";
    }
  }
};

// src/routes/runs.ts
init_logger();
var log46 = logger.child({ component: "runs-route" });
function listRunsHandler(req, res, next) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 200);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
    const db2 = getDatabase();
    const runsRepo = new RunsRepo(db2);
    const runs = runsRepo.list(limit, offset);
    res.json({ ok: true, data: runs });
  } catch (err) {
    next(err);
  }
}
function getRunHandler(req, res, next) {
  try {
    const { id } = req.params;
    const db2 = getDatabase();
    const runsRepo = new RunsRepo(db2);
    const assessmentsRepo = new AssessmentsRepo(db2);
    const decisionsRepo = new DecisionsRepo(db2);
    const ordersRepo = new OrdersRepo(db2);
    const messagesRepo = new AgentMessagesRepo(db2);
    const artifactsRepo = new ArtifactsRepo(db2);
    const rejectionsRepo = new RejectionsRepo(db2);
    const screenerSelectionsRepo = new ScreenerSelectionsRepo(db2);
    const signalSnapshotsRepo = new SignalSnapshotsRepo(db2);
    const run = runsRepo.get(id);
    if (!run) {
      throw new NotFoundError(`Run "${id}" not found`);
    }
    const assessments = assessmentsRepo.listByRun(id);
    const decisions = decisionsRepo.listByRun(id);
    const orders = ordersRepo.listByRun(id);
    const messages = messagesRepo.listByRun(id);
    const artifacts = artifactsRepo.listByRun(id);
    const rejectionsRaw = rejectionsRepo.listByRun(id);
    const rejections = rejectionsRaw.map((r) => ({
      id: r.id,
      runId: r.run_id,
      decisionId: r.decision_id,
      symbol: r.symbol,
      action: r.action,
      confidence: r.confidence,
      targetWeight: r.target_weight,
      reason: r.reason,
      createdAt: r.created_at
    }));
    const screenerSelections = screenerSelectionsRepo.listByRun(id);
    let signalSnapshots = [];
    if (run.trigger === "signal_collection") {
      const runDate = new Date(run.startedAt).toISOString().split("T")[0];
      signalSnapshots = signalSnapshotsRepo.listByDate(runDate);
    }
    res.json({
      ok: true,
      data: {
        run,
        assessments,
        decisions,
        orders,
        rejections,
        messages,
        artifacts,
        screenerSelections,
        signalSnapshots
      }
    });
  } catch (err) {
    next(err);
  }
}
function getRunCoverageHandler(req, res, next) {
  try {
    const { id } = req.params;
    const db2 = getDatabase();
    const runsRepo = new RunsRepo(db2);
    const artifactsRepo = new ArtifactsRepo(db2);
    const assessmentsRepo = new AssessmentsRepo(db2);
    const run = runsRepo.get(id);
    if (!run) {
      throw new NotFoundError(`Run "${id}" not found`);
    }
    const coverageService = new CoverageServiceImpl(artifactsRepo, assessmentsRepo);
    const coverage = coverageService.getCoverage(id);
    res.json(coverage);
  } catch (err) {
    next(err);
  }
}
async function triggerRunHandler(_req, res, next) {
  try {
    const db2 = getDatabase();
    const settings = getSettings();
    const runsRepo = new RunsRepo(db2);
    const assessmentsRepo = new AssessmentsRepo(db2);
    const decisionsRepo = new DecisionsRepo(db2);
    const ordersRepo = new OrdersRepo(db2);
    const positionsRepo = new PositionsRepo(db2);
    const portfolioRepo = new PortfolioRepo(db2);
    const pricesRepo = new PricesRepo(db2);
    const messagesRepo = new AgentMessagesRepo(db2);
    const artifactsRepo = new ArtifactsRepo(db2);
    const watchlistRepo = new WatchlistRepo(db2);
    const calibrationRepo = new CalibrationRepo(db2);
    const screenerSelectionsRepo = new ScreenerSelectionsRepo(db2);
    let semanticMemory;
    if (settings.semanticMemory.enabled) {
      if (resolveApiKey()) {
        semanticMemory = createSemanticMemoryService(db2, createEmbeddingService());
      } else {
        log46.warn("semantic memory enabled but no LLM API key configured; skipping");
      }
    }
    const priceService = new PriceService(pricesRepo);
    const portfolioService = new PortfolioServiceImpl(db2, priceService, positionsRepo, portfolioRepo);
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new Error("ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required for Alpaca paper trading");
    }
    const broker = new AlpacaBroker({
      apiKey,
      apiSecret,
      paperTrading: true
    });
    const runCache = new RunCache();
    const sectorSource = new SectorPerformanceDataSource({ pricesRepo });
    const analystDeps = {
      toolsDeps: {
        newsSource: dataSourceRegistry.get("news"),
        fundamentalsSource: dataSourceRegistry.get("fundamentals"),
        macroSource: dataSourceRegistry.get("macro"),
        optionsSource: dataSourceRegistry.get("options"),
        sectorSource,
        pricesRepo,
        portfolioService,
        decisionsRepo,
        cache: runCache,
        semanticMemory,
        llmLimits: getLlmLimits5(settings.llm.localLlmMode)
      },
      messagesRepo,
      artifactsRepo
    };
    if (!portfolioRepo.read()) {
      portfolioRepo.write({
        cashCents: settings.trading.startingCashCents,
        startingCashCents: settings.trading.startingCashCents,
        startedAt: Date.now(),
        resetAt: null,
        baseCurrency: settings.trading.baseCurrency
      });
    }
    const tradingCycle = createTradingCycleService({
      db: db2,
      runsRepo,
      assessmentsRepo,
      decisionsRepo,
      ordersRepo,
      portfolioService,
      broker,
      analystDeps,
      priceFeed: priceService,
      getSettings,
      watchlistRepo,
      calibrationRepo,
      semanticMemory,
      screenerDeps: {
        screenerSelectionsRepo,
        screenerAgentDeps: {
          messagesRepo,
          artifactsRepo
        },
        toolsDeps: analystDeps.toolsDeps
      },
      runScreener
    });
    await tradingCycle.execute("manual");
    const latestRun = runsRepo.list(1, 0)[0];
    if (!latestRun) {
      throw new Error("Failed to retrieve created run");
    }
    res.json({ ok: true, runId: latestRun.id });
  } catch (err) {
    next(err);
  }
}
function cancelRunHandler(req, res, next) {
  try {
    const { id } = req.params;
    const db2 = getDatabase();
    const runsRepo = new RunsRepo(db2);
    const run = runsRepo.get(id);
    if (!run) {
      throw new NotFoundError(`Run "${id}" not found`);
    }
    if (run.status !== "running") {
      res.status(400).json({ ok: false, error: `Run is not running (status: ${run.status})` });
      return;
    }
    runsRepo.updateStatus(id, "failed", "cancelled by user");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

// src/routes/portfolio.ts
import { z as z6 } from "zod";

// src/repos/auditLogRepo.ts
var AuditLogRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(entry) {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO audit_log (id, action, actor, details, created_at)
         VALUES (?, ?, ?, ?, ?)`
    ).run(id, entry.action, entry.actor, entry.details, now);
    return id;
  }
  list(limit = 100) {
    return this.db.prepare(
      `SELECT id, action, actor, details, created_at as createdAt
         FROM audit_log ORDER BY created_at DESC LIMIT ?`
    ).all(limit);
  }
};

// src/routes/portfolio.ts
init_errors();
init_logger();
var log47 = logger.child({ component: "portfolio-routes" });
async function getPortfolioHandler(_req, res, next) {
  try {
    const db2 = getDatabase();
    const pricesRepo = new PricesRepo(db2);
    const priceService = new PriceService(pricesRepo);
    const positionsRepo = new PositionsRepo(db2);
    const portfolioRepo = new PortfolioRepo(db2);
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const alpacaAccount = await broker.getAccount();
        const alpacaPositions = await broker.getPositions();
        const currentPortfolio = portfolioRepo.read();
        if (currentPortfolio) {
          portfolioRepo.write({
            ...currentPortfolio,
            cashCents: alpacaAccount.cashCents
          });
        }
        const alpacaSymbols = new Set(alpacaPositions.map((p) => p.symbol));
        const localPositions = positionsRepo.listAll();
        for (const localPos of localPositions) {
          if (!alpacaSymbols.has(localPos.symbol) && localPos.qty !== 0) {
            positionsRepo.upsert({
              ...localPos,
              qty: 0,
              updatedAt: Date.now()
            });
          }
        }
        for (const pos of alpacaPositions) {
          const existing = positionsRepo.get(pos.symbol);
          positionsRepo.upsert({
            symbol: pos.symbol,
            qty: pos.qty,
            avgCostCents: pos.avgCostCents,
            realizedPnlCents: existing?.realizedPnlCents ?? 0,
            openedAt: existing?.openedAt ?? Date.now(),
            updatedAt: Date.now()
          });
        }
      } catch (err) {
        log47.warn("failed to sync Alpaca account data", {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    const portfolioService = new PortfolioServiceImpl(db2, priceService, positionsRepo, portfolioRepo);
    const portfolio = await portfolioService.getPortfolio();
    res.json({ ok: true, data: portfolio });
  } catch (err) {
    next(err);
  }
}
function getPortfolioHistoryHandler(req, res, next) {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || "30", 10), 1), 1e3);
    const db2 = getDatabase();
    const snapshotsRepo = new SnapshotsRepo(db2);
    const snapshots = snapshotsRepo.listPortfolioSnapshots(limit);
    res.json({ ok: true, data: snapshots });
  } catch (err) {
    next(err);
  }
}
var TransferSchema = z6.object({
  amountCents: z6.number().int(),
  type: z6.enum(["deposit", "withdrawal"])
});
var InitSchema = z6.object({
  seedCents: z6.number().int().min(1)
});
function initPortfolioHandler(req, res, next) {
  try {
    const parsed = InitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid init request", parsed.error.issues);
    }
    const { seedCents } = parsed.data;
    const db2 = getDatabase();
    const portfolioRepo = new PortfolioRepo(db2);
    const cashFlowsRepo = new CashFlowsRepo(db2);
    const existing = portfolioRepo.read();
    if (existing) {
      throw new ValidationError("Portfolio already initialized");
    }
    const now = Date.now();
    portfolioRepo.write({
      cashCents: seedCents,
      startingCashCents: seedCents,
      startedAt: now,
      resetAt: null,
      baseCurrency: "USD"
    });
    cashFlowsRepo.insertFlow("deposit", seedCents, now, "Initial seed deposit");
    res.json({ ok: true, data: { cashCents: seedCents } });
  } catch (err) {
    next(err);
  }
}
function transferFundsHandler(req, res, next) {
  try {
    const parsed = TransferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid transfer request", parsed.error.issues);
    }
    const { amountCents, type } = parsed.data;
    if (amountCents <= 0) {
      throw new ValidationError("Amount must be positive");
    }
    const db2 = getDatabase();
    const portfolioRepo = new PortfolioRepo(db2);
    const cashFlowsRepo = new CashFlowsRepo(db2);
    const portfolio = portfolioRepo.read();
    if (!portfolio) {
      throw new ValidationError("Portfolio not initialized");
    }
    const newCashCents = type === "deposit" ? portfolio.cashCents + amountCents : portfolio.cashCents - amountCents;
    if (newCashCents < 0) {
      throw new ValidationError("Insufficient funds for withdrawal");
    }
    portfolioRepo.write({
      ...portfolio,
      cashCents: newCashCents
    });
    const now = Date.now();
    cashFlowsRepo.insertFlow(type, amountCents, now);
    res.json({ ok: true, data: { cashCents: newCashCents } });
  } catch (err) {
    next(err);
  }
}
var ResetSchema = z6.object({
  confirm: z6.literal(true),
  preserveHistory: z6.boolean().default(false),
  newCashCents: z6.number().int().positive().optional()
});
function resetPortfolioHandler(req, res, next) {
  try {
    const parsed = ResetSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid reset request", parsed.error.issues);
    }
    const { preserveHistory, newCashCents } = parsed.data;
    const db2 = getDatabase();
    const portfolioRepo = new PortfolioRepo(db2);
    const positionsRepo = new PositionsRepo(db2);
    const cashFlowsRepo = new CashFlowsRepo(db2);
    const auditLogRepo = new AuditLogRepo(db2);
    const portfolio = portfolioRepo.read();
    if (!portfolio) {
      throw new ValidationError("Portfolio not initialized");
    }
    const resetCashCents = newCashCents ?? portfolio.startingCashCents;
    const now = Date.now();
    const user = req.user?.username || "unknown";
    const positions = positionsRepo.list();
    db2.transaction(() => {
      positionsRepo.clear();
      portfolioRepo.write({
        ...portfolio,
        cashCents: resetCashCents,
        startingCashCents: resetCashCents,
        resetAt: now
      });
      if (!preserveHistory) {
        db2.prepare("DELETE FROM orders").run();
        db2.prepare("DELETE FROM fills").run();
        db2.prepare("DELETE FROM portfolio_snapshots").run();
        cashFlowsRepo.deleteAll();
      }
      auditLogRepo.create({
        action: "portfolio_reset",
        actor: user,
        details: JSON.stringify({
          previousCashCents: portfolio.cashCents,
          newCashCents: resetCashCents,
          positionsCleared: positions.length,
          historyPreserved: preserveHistory
        })
      });
    })();
    log47.info("portfolio reset", { user, newCashCents: resetCashCents, preserveHistory });
    res.json({
      ok: true,
      data: {
        cashCents: resetCashCents,
        positionsCleared: positions.length,
        historyPreserved: preserveHistory
      }
    });
  } catch (err) {
    next(err);
  }
}
var ManualOrderSchema = z6.object({
  symbol: z6.string().min(1).max(10).toUpperCase(),
  side: z6.enum(["buy", "sell"]),
  qty: z6.number().positive(),
  type: z6.enum(["market", "limit"]).default("market"),
  limitPriceCents: z6.number().int().positive().optional()
});
async function manualOrderHandler(req, res, next) {
  try {
    const parsed = ManualOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError("Invalid order request", parsed.error.issues);
    }
    const { symbol, side, qty, type, limitPriceCents } = parsed.data;
    if (!isMarketHours(/* @__PURE__ */ new Date())) {
      throw new ValidationError("Market is closed. Orders can only be placed during market hours (9:30 AM - 4:00 PM ET, Mon-Fri).");
    }
    if (type === "limit" && !limitPriceCents) {
      throw new ValidationError("Limit price required for limit orders");
    }
    const db2 = getDatabase();
    const auditLogRepo = new AuditLogRepo(db2);
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new ValidationError("ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required");
    }
    const broker = new AlpacaBroker({
      apiKey,
      apiSecret,
      paperTrading: true
    });
    const clientOrderId = `manual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const user = req.user?.username || "unknown";
    const orderState = await broker.submitOrder({
      clientOrderId,
      symbol,
      side,
      qty,
      type,
      limitPriceCents,
      tif: "day"
    });
    auditLogRepo.create({
      action: "manual_order",
      actor: user,
      details: JSON.stringify({
        orderId: orderState.id,
        symbol,
        side,
        qty,
        type,
        limitPriceCents,
        status: orderState.status,
        rejectReason: orderState.rejectReason
      })
    });
    log47.info("manual order placed", { user, orderId: orderState.id, symbol, side, qty, status: orderState.status });
    res.json({ ok: true, data: orderState });
  } catch (err) {
    next(err);
  }
}
function marketStatusHandler(_req, res, next) {
  try {
    const now = /* @__PURE__ */ new Date();
    res.json({
      isOpen: isMarketHours(now),
      nextOpen: nextSessionOpen(now).getTime(),
      nextClose: nextSessionClose(now).getTime()
    });
  } catch (err) {
    next(err);
  }
}

// src/repos/fillsRepo.ts
var FillsRepo = class {
  constructor(db2) {
    this.db = db2;
  }
  db;
  create(fill) {
    const id = crypto.randomUUID();
    this.db.prepare(
      `INSERT INTO fills (id, order_id, qty, price_cents, fee_cents, filled_at, bar_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      fill.orderId,
      fill.qty,
      fill.priceCents,
      fill.feeCents,
      fill.filledAt,
      fill.barDate
    );
    return id;
  }
  get(id) {
    return this.db.prepare(
      `SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills WHERE id = ?`
    ).get(id);
  }
  listByOrder(orderId) {
    return this.db.prepare(
      `SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills WHERE order_id = ? ORDER BY filled_at`
    ).all(orderId);
  }
  listByDate(barDate) {
    return this.db.prepare(
      `SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills WHERE bar_date = ? ORDER BY filled_at`
    ).all(barDate);
  }
  listAll(limit = 50, offset = 0) {
    return this.db.prepare(
      `SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills ORDER BY filled_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
  }
  listAllWithOrder(limit = 50, offset = 0) {
    return this.db.prepare(
      `SELECT f.id, f.order_id as orderId, f.qty, f.price_cents as priceCents,
                f.fee_cents as feeCents, f.filled_at as filledAt, f.bar_date as barDate,
                o.symbol, o.side, o.mode
         FROM fills f
         JOIN orders o ON o.id = f.order_id
         ORDER BY f.filled_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset);
  }
  countByOrder(orderId) {
    const result = this.db.prepare("SELECT COUNT(*) as count FROM fills WHERE order_id = ?").get(orderId);
    return result.count;
  }
};

// src/routes/trades.ts
init_errors();
init_logger();
var log48 = logger.child({ component: "trades-route" });
async function listTradesHandler(req, res, next) {
  try {
    const db2 = getDatabase();
    const ordersRepo = new OrdersRepo(db2);
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const allOrders = await broker.listOrders({});
        const fillsRepo = new FillsRepo(db2);
        for (const order of allOrders) {
          const existing = ordersRepo.getByClientOrderId(order.clientOrderId);
          if (existing) {
            if (existing.status !== order.status) {
              ordersRepo.updateStatus(existing.id, order.status, order.id);
              if (order.status === "filled" && order.fillPriceCents) {
                try {
                  fillsRepo.create({
                    orderId: existing.id,
                    qty: order.qty,
                    priceCents: order.fillPriceCents,
                    feeCents: 0,
                    filledAt: order.updatedAt || Date.now(),
                    barDate: new Date(order.updatedAt || Date.now()).toISOString().split("T")[0]
                  });
                } catch (err) {
                  log48.debug("fill record already exists or create failed", {
                    orderId: existing.id,
                    error: err instanceof Error ? err.message : String(err)
                  });
                }
              }
            }
          } else {
            try {
              ordersRepo.create({
                clientOrderId: order.clientOrderId,
                decisionId: null,
                runId: null,
                broker: "alpaca",
                brokerOrderId: order.id,
                mode: "paper",
                symbol: order.symbol,
                side: order.side,
                qty: order.qty,
                type: order.type,
                limitPriceCents: order.limitPriceCents,
                tif: order.tif,
                status: order.status,
                rejectReason: order.rejectReason,
                submittedAt: order.submittedAt
              });
            } catch (createErr) {
              if (createErr instanceof Error && createErr.message.includes("UNIQUE constraint")) {
                log48.debug("order already exists, skipping create", { clientOrderId: order.clientOrderId });
              } else {
                throw createErr;
              }
            }
          }
        }
      } catch (err) {
        log48.warn("failed to sync orders from Alpaca", {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit || "50", 10), 1), 200);
    const offset = Math.max(parseInt(req.query.offset || "0", 10), 0);
    const allFills = db2.prepare(`
        SELECT
          fills.id, fills.order_id as orderId, fills.qty, fills.price_cents as priceCents,
          fills.fee_cents as feeCents, fills.filled_at as filledAt, fills.bar_date as barDate,
          orders.symbol, orders.side, orders.mode
        FROM fills
        JOIN orders ON fills.order_id = orders.id
        WHERE orders.broker = 'alpaca'
        ORDER BY fills.filled_at DESC
      `).all();
    const paginatedFills = allFills.slice(offset, offset + limit);
    res.json({ ok: true, data: paginatedFills, total: allFills.length });
  } catch (err) {
    next(err);
  }
}
async function listPendingOrdersHandler(_req, res, next) {
  try {
    const db2 = getDatabase();
    const ordersRepo = new OrdersRepo(db2);
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const allOrders = await broker.listOrders({});
        const fillsRepo = new FillsRepo(db2);
        for (const order of allOrders) {
          const existing = ordersRepo.getByClientOrderId(order.clientOrderId);
          if (existing) {
            if (existing.status !== order.status) {
              ordersRepo.updateStatus(existing.id, order.status, order.id);
              if (order.status === "filled" && order.fillPriceCents) {
                try {
                  fillsRepo.create({
                    orderId: existing.id,
                    qty: order.qty,
                    priceCents: order.fillPriceCents,
                    feeCents: 0,
                    filledAt: order.updatedAt || Date.now(),
                    barDate: new Date(order.updatedAt || Date.now()).toISOString().split("T")[0]
                  });
                } catch (err) {
                  log48.debug("fill record already exists or create failed", {
                    orderId: existing.id,
                    error: err instanceof Error ? err.message : String(err)
                  });
                }
              }
            }
          } else {
            try {
              ordersRepo.create({
                clientOrderId: order.clientOrderId,
                decisionId: null,
                runId: null,
                broker: "alpaca",
                brokerOrderId: order.id,
                mode: "paper",
                symbol: order.symbol,
                side: order.side,
                qty: order.qty,
                type: order.type,
                limitPriceCents: order.limitPriceCents,
                tif: order.tif,
                status: order.status,
                rejectReason: order.rejectReason,
                submittedAt: order.submittedAt
              });
            } catch (createErr) {
              if (createErr instanceof Error && createErr.message.includes("UNIQUE constraint")) {
                log48.debug("order already exists, skipping create", { clientOrderId: order.clientOrderId });
              } else {
                throw createErr;
              }
            }
          }
        }
      } catch (err) {
        log48.warn("failed to sync orders from Alpaca", {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    const pending = ordersRepo.list({ status: ["pending", "accepted"] });
    res.json({ ok: true, data: pending });
  } catch (err) {
    next(err);
  }
}
async function cancelPendingOrderHandler(req, res, next) {
  try {
    const { id } = req.params;
    const db2 = getDatabase();
    const ordersRepo = new OrdersRepo(db2);
    const order = ordersRepo.get(id);
    if (!order) {
      throw new NotFoundError(`Order "${id}" not found`);
    }
    if (order.status !== "pending" && order.status !== "accepted") {
      res.status(400).json({ ok: false, error: "Order is not pending" });
      return;
    }
    if (order.broker === "alpaca" && order.brokerOrderId) {
      const apiKey = process.env.ALPACA_API_KEY;
      const apiSecret = process.env.ALPACA_API_SECRET;
      if (apiKey && apiSecret) {
        try {
          const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
          await broker.cancelOrder(order.brokerOrderId);
        } catch (err) {
          log48.warn("failed to cancel order on Alpaca", {
            orderId: id,
            brokerOrderId: order.brokerOrderId,
            error: err instanceof Error ? err.message : String(err)
          });
          throw new Error("Failed to cancel order on Alpaca");
        }
      }
    }
    ordersRepo.updateStatus(id, "canceled");
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
function cancelPendingOrdersBulkHandler(req, res, next) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ ok: false, error: "ids array required" });
      return;
    }
    const db2 = getDatabase();
    const ordersRepo = new OrdersRepo(db2);
    let canceled = 0;
    for (const id of ids) {
      const order = ordersRepo.get(id);
      if (order && (order.status === "pending" || order.status === "accepted")) {
        ordersRepo.updateStatus(id, "canceled");
        canceled++;
      }
    }
    res.json({ ok: true, canceled });
  } catch (err) {
    next(err);
  }
}
function getTradeHandler(req, res, next) {
  try {
    const { id } = req.params;
    const db2 = getDatabase();
    const fillsRepo = new FillsRepo(db2);
    const fill = fillsRepo.get(id);
    if (!fill) {
      throw new NotFoundError(`Trade "${id}" not found`);
    }
    res.json({ ok: true, data: fill });
  } catch (err) {
    next(err);
  }
}

// src/routes/calibration.ts
function getCalibrationHandler(_req, res, next) {
  try {
    const db2 = getDatabase();
    const calibrationRepo = new CalibrationRepo(db2);
    const bands = calibrationRepo.getCalibrationReport();
    const totalPending = calibrationRepo.countPending();
    res.json({ ok: true, data: { bands, totalPending } });
  } catch (err) {
    next(err);
  }
}

// src/routes/performance.ts
init_logger();
var log49 = logger.child({ component: "performance-route" });
function calculateDrawdown(values) {
  if (values.length === 0) return 0;
  let maxDrawdown = 0;
  let peak = values[0];
  for (const value of values) {
    if (value > peak) peak = value;
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return maxDrawdown;
}
function calculateSharpeRatio(returns, riskFreeRate = 0) {
  if (returns.length < 2) return 0;
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum2, r) => sum2 + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  return (meanReturn - riskFreeRate) / stdDev * Math.sqrt(252);
}
async function getPerformanceHandler(req, res, next) {
  try {
    const db2 = getDatabase();
    const snapshotsRepo = new SnapshotsRepo(db2);
    const pricesRepo = new PricesRepo(db2);
    const priceService = new PriceService(pricesRepo);
    const positionsRepo = new PositionsRepo(db2);
    const portfolioRepo = new PortfolioRepo(db2);
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const alpacaAccount = await broker.getAccount();
        const alpacaPositions = await broker.getPositions();
        const currentPortfolio = portfolioRepo.read();
        if (currentPortfolio) {
          portfolioRepo.write({
            ...currentPortfolio,
            cashCents: alpacaAccount.cashCents
          });
        }
        const alpacaSymbols = new Set(alpacaPositions.map((p) => p.symbol));
        const localPositions = positionsRepo.listAll();
        for (const localPos of localPositions) {
          if (!alpacaSymbols.has(localPos.symbol) && localPos.qty !== 0) {
            positionsRepo.upsert({ ...localPos, qty: 0, updatedAt: Date.now() });
          }
        }
        for (const pos of alpacaPositions) {
          const existing = positionsRepo.get(pos.symbol);
          positionsRepo.upsert({
            symbol: pos.symbol,
            qty: pos.qty,
            avgCostCents: pos.avgCostCents,
            realizedPnlCents: existing?.realizedPnlCents ?? 0,
            openedAt: existing?.openedAt ?? Date.now(),
            updatedAt: Date.now()
          });
        }
      } catch (err) {
        log49.warn("failed to sync Alpaca data for performance", {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    const portfolioService = new PortfolioServiceImpl(db2, priceService, positionsRepo, portfolioRepo);
    const fromDate = req.query.fromDate || "";
    const toDate = req.query.toDate || "";
    let portfolioSnapshots;
    let benchmarkSnapshots;
    if (fromDate && toDate) {
      portfolioSnapshots = snapshotsRepo.listPortfolioSnapshotsByDateRange(fromDate, toDate);
      benchmarkSnapshots = snapshotsRepo.listBenchmarkSnapshotsByDateRange("SPY", fromDate, toDate);
    } else {
      portfolioSnapshots = snapshotsRepo.listPortfolioSnapshots(252);
      benchmarkSnapshots = snapshotsRepo.listBenchmarkSnapshots("SPY", 252);
    }
    log49.info("fetched snapshots", { portfolio: portfolioSnapshots.length, benchmark: benchmarkSnapshots.length });
    portfolioSnapshots.reverse();
    benchmarkSnapshots.reverse();
    const benchmarkMap = /* @__PURE__ */ new Map();
    for (const snap of benchmarkSnapshots) {
      benchmarkMap.set(snap.asOfDate, snap);
    }
    const series = [];
    const strategyValues = [];
    const benchmarkValues = [];
    const dailyStrategyReturns = [];
    const costBaseCents = portfolioService.getCostBase();
    let initialStrategyValue = costBaseCents > 0 ? costBaseCents : null;
    let initialBenchmarkValue = null;
    for (const pSnapshot of portfolioSnapshots) {
      const bSnapshot = benchmarkMap.get(pSnapshot.asOfDate);
      if (!bSnapshot) {
        log49.debug("no benchmark for date", { date: pSnapshot.asOfDate });
        continue;
      }
      if (initialBenchmarkValue === null) {
        initialBenchmarkValue = bSnapshot.adjCloseCents;
        log49.debug("initialized values", { costBase: initialStrategyValue, benchmark: initialBenchmarkValue });
      }
      let strategyReturn = 0;
      if (initialStrategyValue !== null && initialStrategyValue > 0) {
        strategyReturn = (pSnapshot.totalValueCents - initialStrategyValue) / initialStrategyValue;
      }
      const benchmarkReturn = (bSnapshot.adjCloseCents - initialBenchmarkValue) / initialBenchmarkValue;
      series.push({
        date: pSnapshot.asOfDate,
        strategyReturn,
        benchmarkReturn
      });
      strategyValues.push(pSnapshot.totalValueCents);
      benchmarkValues.push(bSnapshot.adjCloseCents);
      if (strategyValues.length > 1) {
        const dailyReturn = (pSnapshot.totalValueCents - strategyValues[strategyValues.length - 2]) / strategyValues[strategyValues.length - 2];
        dailyStrategyReturns.push(dailyReturn);
      }
    }
    log49.info("calculated series", { points: series.length });
    const totalStrategyReturn = initialStrategyValue !== null && strategyValues.length > 0 ? (strategyValues[strategyValues.length - 1] - initialStrategyValue) / initialStrategyValue : 0;
    const totalBenchmarkReturn = initialBenchmarkValue !== null && benchmarkValues.length > 0 ? (benchmarkValues[benchmarkValues.length - 1] - initialBenchmarkValue) / initialBenchmarkValue : 0;
    const strategyMaxDrawdown = calculateDrawdown(strategyValues);
    const benchmarkMaxDrawdown = calculateDrawdown(benchmarkValues);
    const sharpeRatio = dailyStrategyReturns.length > 0 ? calculateSharpeRatio(dailyStrategyReturns) : void 0;
    const metrics = {
      totalStrategyReturn,
      totalBenchmarkReturn,
      strategyMaxDrawdown,
      benchmarkMaxDrawdown,
      ...sharpeRatio !== void 0 && { sharpeRatio },
      series
    };
    res.json({ ok: true, data: metrics });
  } catch (err) {
    log49.error("performance request failed", { error: err instanceof Error ? err.message : String(err) });
    next(err);
  }
}

// src/routes/runProgress.ts
function runProgressStreamHandler(req, res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const listener = (event) => {
    res.write(`data: ${JSON.stringify(event)}

`);
  };
  runProgress.on("progress", listener);
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 3e4);
  req.on("close", () => {
    clearInterval(heartbeat);
    runProgress.off("progress", listener);
  });
}

// src/routes/prices.ts
async function triggerBackfillHandler(req, res, next) {
  try {
    const db2 = getDatabase();
    const days = req.body.days ?? 120;
    const symbols = req.body.symbols;
    const result = await runPriceBackfillJob(db2, { days, symbols });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}
function listTrackedSymbolsHandler(_req, res, next) {
  try {
    const db2 = getDatabase();
    const symbols = getAllTrackedSymbols(db2);
    res.json({ ok: true, symbols });
  } catch (err) {
    next(err);
  }
}
function getBarsHandler(req, res, next) {
  try {
    const db2 = getDatabase();
    const pricesRepo = new PricesRepo(db2);
    const symbolsParam = req.query.symbols;
    const days = Math.min(Number(req.query.days) || 5, 30);
    if (!symbolsParam) {
      res.status(400).json({ ok: false, error: "symbols required" });
      return;
    }
    const symbols = symbolsParam.split(",").map((s) => s.trim().toUpperCase());
    const bars = {};
    for (const symbol of symbols) {
      const rows = pricesRepo.listBySymbol(symbol, days);
      bars[symbol] = rows.reverse().map((r) => r.closeCents / 100);
    }
    res.json({ ok: true, bars });
  } catch (err) {
    next(err);
  }
}

// src/routes/backtest.ts
import { Router } from "express";
import Database2 from "better-sqlite3";
import { spawn as spawn2 } from "node:child_process";
import fs3 from "node:fs";
import path5 from "node:path";
import { fileURLToPath as fileURLToPath5 } from "node:url";
import { z as z7 } from "zod";
init_logger();

// src/llm/prompts/backtestAnalyst.ts
var BACKTEST_ANALYST_SYSTEM_PROMPT = `You are a quantitative trading strategist analyzing backtest results.

Your task is to analyze the performance of a trading strategy and recommend parameter adjustments to improve results.

**Analysis Framework:**

1. **Performance Summary**
   - Compare strategy return vs benchmark (SPY)
   - Assess risk-adjusted returns (Sharpe, Sortino ratios)
   - Evaluate drawdown severity and recovery

2. **Trade Analysis**
   - Review win rate and average win/loss
   - Identify patterns in winning vs losing trades
   - Assess if the strategy is over-trading or under-trading

3. **Per-Symbol Attribution**
   - Which symbols contributed most to gains/losses?
   - Were there symbols that should have been avoided?

4. **Settings Evaluation**
   - Are the signal weights appropriate given the results?
   - Are buy/sell thresholds too aggressive or conservative?
   - Is position sizing (max positions, max weight) optimal?

5. **Recommendations**
   - Suggest specific parameter changes with rationale
   - Prioritize changes by expected impact
   - Consider trade-offs (e.g., higher returns vs more volatility)

**Output Format:**

Provide your analysis in clear sections with specific, actionable recommendations. Include concrete numbers when suggesting parameter changes (e.g., "increase buyThreshold from 0.7 to 0.75").

**IMPORTANT:** Do NOT use markdown tables. Use bullet lists instead for any tabular data. Tables do not render correctly in the UI.

**Parameter Constraints (recommendations MUST stay within these bounds):**
- buyThreshold: 0.50 to 0.95
- sellThreshold: 0.10 to 0.60
- pauseThreshold: 0.40 to 0.80
- cancelThreshold: 0.30 to 0.60
- Signal weights (ALL 5 must be specified, must sum to 1.0, use increments of 0.05):
  - sentiment: 0 to 1
  - sentimentTrend: 0 to 1
  - priceMomentum: 0 to 1
  - options: 0 to 1
  - fundamentals: 0 to 1
- Threshold ordering: buyThreshold > pauseThreshold > cancelThreshold`;
function buildBacktestAnalysisPrompt(data) {
  const { metrics, settings, trades, perSymbol, dateRange } = data;
  const fmt = (v) => v !== null ? (v * 100).toFixed(2) + "%" : "N/A";
  const fmtNum = (v) => v !== null ? v.toFixed(2) : "N/A";
  let prompt = `## Backtest Results Analysis Request

**Period:** ${dateRange.start} to ${dateRange.end}

### Performance Metrics
- Total Return: ${fmt(metrics.totalReturn)}
- Benchmark (SPY) Return: ${fmt(metrics.benchmarkReturn)}
- Alpha: ${fmt(metrics.totalReturn - metrics.benchmarkReturn)}
- Max Drawdown: ${fmt(metrics.maxDrawdown)}
- Sharpe Ratio: ${fmtNum(metrics.sharpeRatio)}
- Sortino Ratio: ${fmtNum(metrics.sortinoRatio)}
- Win Rate: ${fmt(metrics.winRate)}
- Total Trades: ${metrics.totalTrades}

### Strategy Settings Used
`;
  if (settings.signals?.weights) {
    prompt += `**Signal Weights (all 5 must sum to 1.0):**
`;
    const weightOrder = ["sentiment", "sentimentTrend", "priceMomentum", "options", "fundamentals"];
    for (const key of weightOrder) {
      const val = settings.signals.weights[key] ?? 0;
      prompt += `- ${key}: ${(val * 100).toFixed(0)}%
`;
    }
  }
  prompt += `
**Thresholds:**
- Buy Threshold: ${settings.signals?.buyThreshold ?? "N/A"}
- Sell Threshold: ${settings.signals?.sellThreshold ?? "N/A"}

**Risk Limits:**
- Max Concurrent Positions: ${settings.risk?.maxConcurrentPositions ?? "N/A"}
- Max Position Weight: ${settings.risk?.maxPositionWeightPercent ?? "N/A"}%
`;
  if (perSymbol && Object.keys(perSymbol).length > 0) {
    prompt += `
### Per-Symbol Attribution
`;
    const sorted = Object.entries(perSymbol).filter(([sym]) => sym !== "SPY").sort((a, b) => (b[1].return ?? -999) - (a[1].return ?? -999));
    for (const [symbol, data2] of sorted) {
      prompt += `- ${symbol}: ${data2.return !== null ? fmt(data2.return) : "N/A"} (${data2.trades} trades)
`;
    }
  }
  if (trades.length > 0) {
    prompt += `
### Trade Summary
`;
    const buys = trades.filter((t) => t.side === "buy").length;
    const sells = trades.filter((t) => t.side === "sell").length;
    prompt += `- Buy orders: ${buys}
`;
    prompt += `- Sell orders: ${sells}
`;
    const sortedTrades = [...trades].sort((a, b) => a.date.localeCompare(b.date));
    prompt += `- First trade: ${sortedTrades[0].date}
`;
    prompt += `- Last trade: ${sortedTrades[sortedTrades.length - 1].date}
`;
  }
  prompt += `
### Analysis Request

Please analyze these backtest results and provide:
1. A brief performance assessment (2-3 sentences)
2. Key observations about what worked and what didn't
3. Specific parameter recommendations to improve performance
4. Any warnings or caveats about the strategy

Focus on actionable insights. If the strategy outperformed the benchmark, suggest how to maintain that edge while reducing risk. If it underperformed, identify the likely causes and fixes.`;
  return prompt;
}

// src/routes/backtest.ts
var log50 = logger.child({ component: "backtest-routes" });
var __dirname4 = path5.dirname(fileURLToPath5(import.meta.url));
var LOG_DIR = process.env.BACKTEST_LOG_DIR || "/tmp";
function runBacktestCli(backtestId, config, repo) {
  const scriptPath = path5.join(__dirname4, "..", "..", "scripts", "backtest.ts");
  const cash = config.startingCashCents ? Math.floor(config.startingCashCents / 100) : 1e5;
  const logPath = path5.join(LOG_DIR, `backtest-${backtestId}.log`);
  const args = [
    scriptPath,
    "--start",
    config.startDate,
    "--end",
    config.endDate,
    "--symbols",
    config.symbols.join(","),
    "--cash",
    cash.toString()
  ];
  log50.info("spawning backtest CLI", { backtestId, args, logPath });
  const logStream = fs3.createWriteStream(logPath, { flags: "w" });
  logStream.write(`[${(/* @__PURE__ */ new Date()).toISOString()}] Starting backtest ${backtestId}
`);
  logStream.write(`[${(/* @__PURE__ */ new Date()).toISOString()}] Config: ${JSON.stringify(config)}

`);
  const child = spawn2("npx", ["tsx", ...args], {
    cwd: path5.join(__dirname4, "..", ".."),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BACKTEST_ID: backtestId }
  });
  let stderr = "";
  child.stdout?.on("data", (data) => {
    const text = data.toString();
    logStream.write(text);
  });
  child.stderr?.on("data", (data) => {
    const text = data.toString();
    stderr += text;
    logStream.write(`[STDERR] ${text}`);
  });
  child.on("close", (code) => {
    logStream.write(`
[${(/* @__PURE__ */ new Date()).toISOString()}] Process exited with code ${code}
`);
    logStream.end();
    if (code === 0) {
      log50.info("backtest CLI completed", { backtestId });
      const run = repo.getRun(backtestId);
      if (run?.status === "running") {
        repo.updateRunStatus(backtestId, "succeeded");
      }
    } else {
      const errorMsg = stderr || `CLI exited with code ${code}`;
      log50.error("backtest CLI failed", { backtestId, code, stderr: stderr.slice(-500) });
      repo.updateRunStatus(backtestId, "failed", errorMsg.slice(0, 1e3));
    }
  });
  child.on("error", (err) => {
    log50.error("backtest CLI spawn error", { backtestId, error: err.message });
    repo.updateRunStatus(backtestId, "failed", err.message);
  });
}
var BacktestRequestSchema = z7.object({
  name: z7.string().optional(),
  startDate: z7.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z7.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  symbols: z7.array(z7.string().toUpperCase()).min(1),
  startingCashCents: z7.number().int().positive().optional()
});
function createBacktestRoutes(db2) {
  const router = Router();
  const repo = new BacktestRepo(db2);
  router.get("/date-range", (_req, res) => {
    try {
      const fnspidDbPath = process.env.BACKTEST_DATA_DIR ? `${process.env.BACKTEST_DATA_DIR}/fnspid.db` : "/Volumes/JetDrive/atn-trd/fnspid/fnspid.db";
      const fnspidDb = new Database2(fnspidDbPath, { readonly: true });
      const row = fnspidDb.prepare(`
        SELECT 
          MAX(p.minDate, n.minDate) as minDate,
          MIN(p.maxDate, n.maxDate) as maxDate
        FROM 
          (SELECT MIN(date) as minDate, MAX(date) as maxDate FROM prices) p,
          (SELECT MIN(date) as minDate, MAX(date) as maxDate FROM news_sentiment) n
      `).get();
      fnspidDb.close();
      if (row?.minDate && row?.maxDate) {
        res.json({
          minDate: row.minDate,
          maxDate: row.maxDate
        });
      } else {
        res.json({
          minDate: "2021-01-01",
          maxDate: "2023-12-28"
        });
      }
    } catch {
      res.json({
        minDate: "2021-01-01",
        maxDate: "2023-12-28"
      });
    }
  });
  router.get("/", (_req, res) => {
    try {
      const runs = repo.listRuns(50);
      res.json({ runs });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  router.get("/:id", (req, res) => {
    try {
      const run = repo.getRun(req.params.id);
      if (!run) {
        res.status(404).json({ error: "Backtest not found" });
        return;
      }
      const metrics = repo.getMetrics(req.params.id);
      const snapshots = repo.getSnapshots(req.params.id);
      const rawTrades = repo.getTrades(req.params.id);
      const equityCurve = snapshots.map((s) => ({
        date: s.asOfDate,
        value: s.totalValueCents / 100,
        benchmark: s.benchmarkValueCents ? s.benchmarkValueCents / 100 : null
      }));
      const trades = rawTrades.map((t) => ({
        date: t.tradeDate,
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        price: t.priceCents / 100,
        rationale: t.rationale
      }));
      let settingsSnapshot = null;
      try {
        settingsSnapshot = JSON.parse(run.settingsSnapshot);
      } catch {
      }
      const startingValue = snapshots.length > 0 ? snapshots[0].totalValueCents / 100 : null;
      const endingValue = snapshots.length > 0 ? snapshots[snapshots.length - 1].totalValueCents / 100 : null;
      const metricsWithValues = metrics ? { ...metrics, startingValue, endingValue } : null;
      res.json({
        run: { ...run, settingsSnapshot },
        metrics: metricsWithValues,
        equityCurve,
        trades
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  router.post("/", (req, res) => {
    const parsed = BacktestRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      return;
    }
    const config = parsed.data;
    const allSymbols = config.symbols.includes("SPY") ? config.symbols : [...config.symbols, "SPY"];
    const backtestId = repo.createRun({
      name: config.name,
      startDate: config.startDate,
      endDate: config.endDate,
      symbols: allSymbols,
      settingsSnapshot: "{}"
    });
    res.status(202).json({ backtestId, status: "running" });
    runBacktestCli(backtestId, { ...config, symbols: allSymbols }, repo);
  });
  router.get("/:id/metrics", (req, res) => {
    try {
      const metrics = repo.getMetrics(req.params.id);
      if (!metrics) {
        res.status(404).json({ error: "Metrics not found" });
        return;
      }
      res.json(metrics);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  router.get("/:id/equity", (req, res) => {
    try {
      const snapshots = repo.getSnapshots(req.params.id);
      const equityCurve = snapshots.map((s) => ({
        date: s.asOfDate,
        value: s.totalValueCents / 100,
        benchmark: s.benchmarkValueCents ? s.benchmarkValueCents / 100 : null
      }));
      res.json({ equityCurve });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  router.get("/:id/trades", (req, res) => {
    try {
      const trades = repo.getTrades(req.params.id);
      const mapped = trades.map((t) => ({
        date: t.tradeDate,
        symbol: t.symbol,
        side: t.side,
        qty: t.qty,
        price: t.priceCents / 100,
        rationale: t.rationale
      }));
      res.json({ trades: mapped });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  router.get("/:id/log", (req, res) => {
    try {
      const logPath = path5.join(LOG_DIR, `backtest-${req.params.id}.log`);
      const tail = parseInt(req.query.tail) || 50;
      if (!fs3.existsSync(logPath)) {
        res.json({ lines: [], exists: false });
        return;
      }
      const content = fs3.readFileSync(logPath, "utf-8");
      const allLines = content.split("\n");
      const lines = allLines.slice(-tail).filter((line) => line.trim());
      res.json({ lines, exists: true, totalLines: allLines.length });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  router.post("/:id/analyze", async (req, res) => {
    try {
      const run = repo.getRun(req.params.id);
      if (!run) {
        res.status(404).json({ error: "Backtest not found" });
        return;
      }
      if (run.status !== "succeeded") {
        res.status(400).json({ error: "Can only analyze completed backtests" });
        return;
      }
      const metrics = repo.getMetrics(req.params.id);
      if (!metrics) {
        res.status(400).json({ error: "No metrics available for this backtest" });
        return;
      }
      const rawTrades = repo.getTrades(req.params.id);
      const trades = rawTrades.map((t) => ({
        date: t.tradeDate,
        symbol: t.symbol,
        side: t.side,
        price: t.priceCents / 100
      }));
      let settings = {};
      try {
        settings = JSON.parse(run.settingsSnapshot) || {};
      } catch {
      }
      const prompt = buildBacktestAnalysisPrompt({
        metrics: {
          totalReturn: metrics.totalReturn,
          benchmarkReturn: metrics.benchmarkReturn,
          sharpeRatio: metrics.sharpeRatio,
          sortinoRatio: metrics.sortinoRatio,
          maxDrawdown: metrics.maxDrawdown,
          winRate: metrics.winRate,
          totalTrades: metrics.totalTrades
        },
        settings,
        trades,
        perSymbol: metrics.perSymbol,
        dateRange: { start: run.startDate, end: run.endDate }
      });
      log50.info("analyzing backtest with LLM", { backtestId: req.params.id });
      const model = createOpenAIChatModel({ timeoutMs: 6e4 });
      const messages = promptMessages(prompt, BACKTEST_ANALYST_SYSTEM_PROMPT);
      const completion = await model.complete(messages);
      log50.info("backtest analysis complete", {
        backtestId: req.params.id,
        tokens: completion.tokens
      });
      repo.updateAnalysis(req.params.id, completion.content);
      res.json({
        analysis: completion.content,
        model: completion.model,
        tokens: completion.tokens
      });
    } catch (err) {
      log50.error("backtest analysis failed", {
        backtestId: req.params.id,
        error: err instanceof Error ? err.message : String(err)
      });
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  return router;
}

// src/routes/plans.ts
init_errors();
function listPlansHandler(_req, res, next) {
  try {
    const db2 = getDatabase();
    const plansRepo = new StrategicPlansRepo(db2);
    const active = plansRepo.listActive();
    const paused = plansRepo.listPaused();
    res.json({
      ok: true,
      data: {
        active,
        paused
      }
    });
  } catch (err) {
    next(err);
  }
}
function getPlanHandler(req, res, next) {
  try {
    const { id } = req.params;
    const db2 = getDatabase();
    const plansRepo = new StrategicPlansRepo(db2);
    const tranchesRepo = new PlanTranchesRepo(db2);
    const plan = plansRepo.get(id);
    if (!plan) {
      throw new NotFoundError("Plan not found");
    }
    const tranches = tranchesRepo.listByPlan(id);
    res.json({
      ok: true,
      data: {
        plan,
        tranches
      }
    });
  } catch (err) {
    next(err);
  }
}
function getCurrentRegimeHandler(_req, res, next) {
  try {
    const db2 = getDatabase();
    const regimeRepo = new MarketRegimeRepo(db2);
    const latest = regimeRepo.getLatest();
    if (!latest) {
      res.json({
        ok: true,
        data: null
      });
      return;
    }
    const streak = regimeRepo.getRegimeStreak(latest.regime);
    res.json({
      ok: true,
      data: {
        ...latest,
        streak
      }
    });
  } catch (err) {
    next(err);
  }
}
function getSignalHistoryHandler(req, res, next) {
  try {
    const { symbol } = req.params;
    const limit = Math.min(Math.max(parseInt(req.query.limit || "30", 10), 1), 100);
    const db2 = getDatabase();
    const signalsRepo = new SignalSnapshotsRepo(db2);
    const signals = signalsRepo.listBySymbol(symbol.toUpperCase(), limit);
    res.json({
      ok: true,
      data: signals
    });
  } catch (err) {
    next(err);
  }
}

// src/routes/reports.ts
import { randomUUID as randomUUID8 } from "crypto";
init_logger();
async function listReportsHandler(req, res, next) {
  try {
    const db2 = getDatabase();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const rows = db2.prepare(`
      SELECT id, period_start, period_end, title, tokens_used, created_at
      FROM reports ORDER BY created_at DESC LIMIT ?
    `).all(limit);
    res.json({
      ok: true,
      data: rows.map((r) => ({
        id: r.id,
        periodStart: r.period_start,
        periodEnd: r.period_end,
        title: r.title,
        tokensUsed: r.tokens_used,
        createdAt: r.created_at
      }))
    });
  } catch (err) {
    next(err);
  }
}
async function getReportHandler(req, res, next) {
  try {
    const db2 = getDatabase();
    const row = db2.prepare(`SELECT * FROM reports WHERE id = ?`).get(req.params.id);
    if (!row) {
      res.status(404).json({ ok: false, error: "Report not found" });
      return;
    }
    res.json({
      ok: true,
      data: {
        id: row.id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        title: row.title,
        content: row.content,
        tokensUsed: row.tokens_used,
        createdAt: row.created_at
      }
    });
  } catch (err) {
    next(err);
  }
}
async function generateReportHandler(req, res, next) {
  try {
    const { periodDays = 14 } = req.body;
    const db2 = getDatabase();
    const endDate = /* @__PURE__ */ new Date();
    const startDate = new Date(endDate.getTime() - periodDays * 24 * 60 * 60 * 1e3);
    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];
    const startTs = Math.floor(startDate.getTime() / 1e3);
    logger.info("generating report", { periodDays, startDate: startDateStr, endDate: endDateStr });
    const data = gatherReportData(db2, startTs, startDateStr, endDateStr);
    const prompt = buildReportPrompt(data, startDateStr, endDateStr);
    const llm = getSynthesisLlm();
    const response = await llm.invoke(prompt);
    const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);
    const tokensUsed = response.usage_metadata?.total_tokens ?? null;
    const title = `Portfolio Report: ${startDateStr} to ${endDateStr}`;
    const id = randomUUID8();
    db2.prepare(`
      INSERT INTO reports (id, period_start, period_end, title, content, tokens_used)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, startDateStr, endDateStr, title, content, tokensUsed);
    logger.info("report generated", { id, tokensUsed });
    res.json({
      ok: true,
      data: {
        id,
        periodStart: startDateStr,
        periodEnd: endDateStr,
        title,
        content,
        tokensUsed,
        createdAt: Math.floor(Date.now() / 1e3)
      }
    });
  } catch (err) {
    next(err);
  }
}
function gatherReportData(db2, startTs, startDateStr, endDateStr) {
  const portfolioSnapshots = db2.prepare(`
    SELECT as_of_date, total_value_cents, cash_cents
    FROM portfolio_snapshots
    WHERE as_of_date >= ? AND as_of_date <= ?
    ORDER BY as_of_date
  `).all(startDateStr, endDateStr);
  const signalSnapshots = db2.prepare(`
    SELECT symbol, snapshot_date, composite_score, sentiment_score
    FROM signal_snapshots
    WHERE snapshot_date >= ? AND snapshot_date <= ?
    ORDER BY snapshot_date DESC
    LIMIT 200
  `).all(startDateStr, endDateStr);
  const plans = db2.prepare(`
    SELECT symbol, direction, status, target_shares, executed_shares, created_at
    FROM strategic_plans
    WHERE created_at >= ?
    ORDER BY created_at DESC
  `).all(startTs);
  const tranches = db2.prepare(`
    SELECT p.symbol, t.tranche_number, t.shares, t.price_cents, t.order_status
    FROM plan_tranches t
    JOIN strategic_plans p ON t.plan_id = p.id
    WHERE t.executed_at >= ?
    ORDER BY t.executed_at DESC
  `).all(startTs);
  const regimeHistory = db2.prepare(`
    SELECT as_of_date, regime, risk_score
    FROM market_regime
    WHERE as_of_date >= ? AND as_of_date <= ?
    ORDER BY as_of_date
  `).all(startDateStr, endDateStr);
  const jobRows = db2.prepare(`
    SELECT trigger, status, COUNT(*) as cnt
    FROM agent_runs
    WHERE started_at >= ?
    GROUP BY trigger, status
  `).all(startTs);
  const jobStats = { total: 0, succeeded: 0, failed: 0, byType: {} };
  for (const row of jobRows) {
    jobStats.total += row.cnt;
    if (row.status === "succeeded") jobStats.succeeded += row.cnt;
    if (row.status === "failed") jobStats.failed += row.cnt;
    jobStats.byType[row.trigger] = (jobStats.byType[row.trigger] || 0) + row.cnt;
  }
  const positions = db2.prepare(`
    SELECT p.symbol, p.qty, p.avg_cost_cents, sc.sector
    FROM positions p
    LEFT JOIN symbol_categories sc ON p.symbol = sc.symbol
    WHERE p.qty > 0
  `).all();
  const latestPrices = db2.prepare(`
    SELECT symbol, adj_close_cents FROM prices
    WHERE (symbol, bar_date) IN (
      SELECT symbol, MAX(bar_date) FROM prices GROUP BY symbol
    )
  `).all();
  const priceMap = new Map(latestPrices.map((p) => [p.symbol, p.adj_close_cents]));
  const sectorValues = /* @__PURE__ */ new Map();
  let totalPositionValue = 0;
  for (const pos of positions) {
    const price = priceMap.get(pos.symbol) ?? pos.avg_cost_cents;
    const value = pos.qty * price;
    totalPositionValue += value;
    const sector = pos.sector ?? "Unknown";
    sectorValues.set(sector, (sectorValues.get(sector) ?? 0) + value);
  }
  const sectorExposure = Array.from(sectorValues.entries()).map(([sector, valueCents]) => ({
    sector,
    valueCents,
    percent: totalPositionValue > 0 ? valueCents / totalPositionValue : 0
  })).sort((a, b) => b.percent - a.percent);
  return {
    portfolioSnapshots: portfolioSnapshots.map((r) => ({ asOfDate: r.as_of_date, totalValueCents: r.total_value_cents, cashCents: r.cash_cents })),
    signalSnapshots: signalSnapshots.map((r) => ({ symbol: r.symbol, snapshotDate: r.snapshot_date, compositeScore: r.composite_score, sentimentScore: r.sentiment_score })),
    plans: plans.map((r) => ({ symbol: r.symbol, direction: r.direction, status: r.status, targetShares: r.target_shares, executedShares: r.executed_shares, createdAt: r.created_at })),
    tranches: tranches.map((r) => ({ symbol: r.symbol, trancheNumber: r.tranche_number, shares: r.shares, priceCents: r.price_cents, orderStatus: r.order_status })),
    regimeHistory: regimeHistory.map((r) => ({ asOfDate: r.as_of_date, regime: r.regime, riskScore: r.risk_score })),
    jobStats,
    positions: positions.map((r) => ({ symbol: r.symbol, qty: r.qty, avgCostCents: r.avg_cost_cents, sector: r.sector })),
    sectorExposure
  };
}
function buildReportPrompt(data, startDate, endDate) {
  const { portfolioSnapshots, signalSnapshots, plans, tranches, regimeHistory, jobStats, positions, sectorExposure } = data;
  let portfolioPerf = "No portfolio data available.";
  if (portfolioSnapshots.length >= 2) {
    const first = portfolioSnapshots[0];
    const last = portfolioSnapshots[portfolioSnapshots.length - 1];
    const returnPct = ((last.totalValueCents - first.totalValueCents) / first.totalValueCents * 100).toFixed(2);
    portfolioPerf = `Starting value: $${(first.totalValueCents / 100).toLocaleString()}, Ending value: $${(last.totalValueCents / 100).toLocaleString()}, Return: ${returnPct}%`;
  }
  const signalsBySymbol = /* @__PURE__ */ new Map();
  for (const s of signalSnapshots) {
    if (s.compositeScore !== null) {
      if (!signalsBySymbol.has(s.symbol)) signalsBySymbol.set(s.symbol, { scores: [], latest: null });
      const entry = signalsBySymbol.get(s.symbol);
      entry.scores.push(s.compositeScore);
      if (entry.latest === null) entry.latest = s.compositeScore;
    }
  }
  const signalSummary = Array.from(signalsBySymbol.entries()).map(([sym, { scores, latest }]) => {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return `${sym}: avg=${avg.toFixed(2)}, latest=${latest?.toFixed(2)}, samples=${scores.length}`;
  }).join("\n");
  const regimeCounts = { RISK_ON: 0, RISK_OFF: 0, NEUTRAL: 0 };
  for (const r of regimeHistory) {
    if (r.regime in regimeCounts) regimeCounts[r.regime]++;
  }
  const regimeSummary = `RISK_ON: ${regimeCounts.RISK_ON} days, RISK_OFF: ${regimeCounts.RISK_OFF} days, NEUTRAL: ${regimeCounts.NEUTRAL} days`;
  const plansSummary = plans.length > 0 ? plans.map((p) => `${p.symbol} ${p.direction} (${p.status}): ${p.executedShares}/${p.targetShares} shares`).join("\n") : "No plans created in this period.";
  const tranchesSummary = tranches.length > 0 ? `${tranches.length} tranches executed across ${new Set(tranches.map((t) => t.symbol)).size} symbols` : "No tranches executed.";
  const positionsSummary = positions.length > 0 ? positions.map((p) => `${p.symbol} (${p.sector ?? "Unknown"}): ${p.qty} shares @ $${(p.avgCostCents / 100).toFixed(2)} avg`).join("\n") : "No positions.";
  const sectorSummary = sectorExposure.length > 0 ? sectorExposure.map((s) => `${s.sector}: ${(s.percent * 100).toFixed(1)}% ($${(s.valueCents / 100).toLocaleString()})`).join("\n") : "No sector data.";
  return `You are a financial analyst assistant. Generate a comprehensive portfolio report for the period ${startDate} to ${endDate}.

## Data Summary

### Portfolio Performance
${portfolioPerf}

### Current Positions
${positionsSummary}

### Sector Exposure
${sectorSummary}

### Signal Trends (Composite Scores by Symbol)
${signalSummary || "No signal data available."}

### Market Regime
${regimeSummary}
${regimeHistory.length > 0 ? `Latest regime: ${regimeHistory[regimeHistory.length - 1].regime}` : ""}

### Strategic Plans
${plansSummary}

### Tranche Execution
${tranchesSummary}

### Job Statistics
Total jobs: ${jobStats.total}, Succeeded: ${jobStats.succeeded}, Failed: ${jobStats.failed}
By type: ${Object.entries(jobStats.byType).map(([k, v]) => `${k}: ${v}`).join(", ")}

## Instructions

Write a professional investment report with the following sections:
1. **Executive Summary** - Key highlights and overall assessment
2. **Portfolio Performance** - Analysis of returns and value changes
3. **Signal Analysis** - Notable sentiment trends and score changes
4. **Market Regime** - Impact of regime on strategy
5. **Plan Execution** - Summary of strategic plans and their progress
6. **Observations & Recommendations** - Key insights and suggested actions

Keep the report concise but insightful. Use specific numbers from the data. Format in Markdown.`;
}

// src/app.ts
function createApp(options = {}) {
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(cookieParser());
  app.use((req, _res, next) => {
    logger.debug("incoming request", {
      method: req.method,
      path: req.path
    });
    next();
  });
  app.get("/api/health", healthHandler);
  app.post("/api/auth/login", loginHandler);
  app.post("/api/auth/logout", logoutHandler);
  app.post("/api/trigger/trading-cycle", verifySchedulerAuth, triggerTradingCycleHandler);
  app.post("/api/trigger/snapshot", verifySchedulerAuth, triggerSnapshotHandler);
  app.post("/api/trigger/signal-collection", requireAuth, requireWrite, triggerSignalCollectionHandler);
  app.post("/api/trigger/plan-review", requireAuth, requireWrite, triggerPlanReviewHandler);
  app.post("/api/trigger/tranche-execution", requireAuth, requireWrite, triggerTrancheExecutionHandler);
  app.post("/api/trigger/watchlist-curation", requireAuth, requireWrite, triggerWatchlistCurationHandler);
  app.post("/api/trigger/backfill-sectors", requireAuth, requireWrite, triggerBackfillSectorsHandler);
  app.post("/api/trigger/run-selected", requireAuth, requireWrite, triggerRunSelectedHandler);
  app.get("/api/auth/me", requireAuth, meHandler);
  app.get("/api/settings", requireAuth, getSettingsHandler);
  app.get("/api/secrets", requireAuth, getSecretsHandler);
  app.get("/api/watchlist", requireAuth, listWatchlistHandler);
  app.get("/api/watchlist/enhanced", requireAuth, listEnhancedWatchlistHandler);
  app.get("/api/datasources", requireAuth, listDataSourcesHandler);
  app.get("/api/scheduler/next-runs", requireAuth, nextRunsHandler);
  app.get("/api/scheduler/jobs", requireAuth, jobSchedulesHandler);
  app.get("/api/runs", requireAuth, listRunsHandler);
  app.get("/api/runs/progress/stream", requireAuth, runProgressStreamHandler);
  app.get("/api/runs/:id", requireAuth, getRunHandler);
  app.get("/api/runs/:id/coverage", requireAuth, getRunCoverageHandler);
  app.get("/api/portfolio", requireAuth, getPortfolioHandler);
  app.get("/api/portfolio/history", requireAuth, getPortfolioHistoryHandler);
  app.get("/api/portfolio/market-status", requireAuth, marketStatusHandler);
  app.get("/api/trades", requireAuth, listTradesHandler);
  app.get("/api/trades/pending", requireAuth, listPendingOrdersHandler);
  app.get("/api/trades/:id", requireAuth, getTradeHandler);
  app.get("/api/calibration", requireAuth, getCalibrationHandler);
  app.get("/api/performance", requireAuth, getPerformanceHandler);
  app.get("/api/prices/symbols", requireAuth, listTrackedSymbolsHandler);
  app.get("/api/prices/bars", requireAuth, getBarsHandler);
  app.get("/api/plans", requireAuth, listPlansHandler);
  app.get("/api/plans/:id", requireAuth, getPlanHandler);
  app.get("/api/regime/current", requireAuth, getCurrentRegimeHandler);
  app.get("/api/signals/:symbol", requireAuth, getSignalHistoryHandler);
  app.get("/api/reports", requireAuth, listReportsHandler);
  app.get("/api/reports/:id", requireAuth, getReportHandler);
  app.patch("/api/settings", requireAuth, requireWrite, patchSettingsHandler);
  app.put("/api/secrets/:name", requireAuth, requireWrite, putSecretHandler);
  app.delete("/api/secrets/:name", requireAuth, requireWrite, deleteSecretHandler);
  app.post("/api/symbols/validate", requireAuth, requireWrite, validateSymbolHandler);
  app.post("/api/watchlist", requireAuth, requireWrite, addWatchlistHandler);
  app.patch("/api/watchlist/:symbol", requireAuth, requireWrite, patchWatchlistHandler);
  app.delete("/api/watchlist/:symbol", requireAuth, requireWrite, removeWatchlistHandler);
  app.post("/api/llm/test", requireAuth, requireWrite, testLlmHandler);
  app.post("/api/datasources/:id/test", requireAuth, requireWrite, testDataSourceHandler);
  app.post("/api/runs", requireAuth, requireWrite, triggerRunHandler);
  app.post("/api/runs/:id/cancel", requireAuth, requireWrite, cancelRunHandler);
  app.post("/api/portfolio/init", requireAuth, requireWrite, initPortfolioHandler);
  app.post("/api/portfolio/transfer", requireAuth, requireWrite, transferFundsHandler);
  app.post("/api/portfolio/reset", requireAuth, requireWrite, resetPortfolioHandler);
  app.post("/api/portfolio/order", requireAuth, requireWrite, manualOrderHandler);
  app.post("/api/trades/pending/cancel-bulk", requireAuth, requireWrite, cancelPendingOrdersBulkHandler);
  app.post("/api/trades/pending/:id/cancel", requireAuth, requireWrite, cancelPendingOrderHandler);
  app.post("/api/prices/backfill", requireAuth, requireWrite, triggerBackfillHandler);
  app.post("/api/reports/generate", requireAuth, requireWrite, generateReportHandler);
  app.use("/api/backtest", requireAuth, createBacktestRoutes(getDatabase()));
  if (options.viteDevMiddleware) {
    app.use(options.viteDevMiddleware);
  } else if (options.staticRoot) {
    app.use(express.static(options.staticRoot));
    app.get("*", (req, res) => {
      if (!req.path.startsWith("/api")) {
        res.sendFile(path6.join(options.staticRoot, "index.html"));
      } else {
        res.status(404).json({ error: "Not Found" });
      }
    });
  }
  app.use((err, req, res, _next) => {
    logger.error("request error", {
      path: req.path,
      method: req.method,
      error: err.message
    });
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
        ...err instanceof ValidationError && err.issues ? { issues: err.issues } : {}
      });
    } else {
      res.status(500).json({
        error: "Internal Server Error",
        code: "INTERNAL_ERROR"
      });
    }
  });
  return app;
}

// src/main.ts
init_logger();
var __dirname5 = path7.dirname(fileURLToPath6(import.meta.url));
var PORT = parseInt(process.env.PORT || "8080", 10);
var DATA_DIR = process.env.ATN_DATA_DIR || path7.join(__dirname5, "..", "..", "data");
var ATN_ROLE = process.env.ATN_ROLE || "all";
var VITE_DEV = process.env.ATN_VITE_DEV === "1";
async function main() {
  try {
    logger.info("Starting ATN server", { role: ATN_ROLE, port: PORT });
    const db2 = initializeDatabase(DATA_DIR);
    logger.info("Database initialized", { path: DATA_DIR });
    const migrationsDir = path7.join(__dirname5, "db", "migrations");
    runMigrations(db2, migrationsDir);
    logger.info("Migrations complete");
    const orphaned = db2.prepare(`
      UPDATE agent_runs 
      SET status = 'failed', error = 'interrupted by server restart', finished_at = ?
      WHERE status = 'running'
    `).run(Date.now());
    if (orphaned.changes > 0) {
      logger.info("Cleaned up orphaned running jobs", { count: orphaned.changes });
    }
    if (ATN_ROLE === "all" || ATN_ROLE === "web") {
      let staticRoot;
      let viteDevMiddleware;
      if (VITE_DEV) {
        try {
          const { createServer } = await import("vite");
          const vite = await createServer({
            appType: "spa"
          });
          viteDevMiddleware = vite.middlewares;
          logger.info("Vite dev middleware loaded");
        } catch (err) {
          logger.error("Failed to load Vite dev middleware", { error: String(err) });
          throw err;
        }
      } else {
        staticRoot = path7.join(__dirname5, "..", "public");
      }
      const app = createApp({ staticRoot, viteDevMiddleware });
      app.listen(PORT, () => {
        logger.info("Express server listening", { port: PORT });
      });
    }
    if (ATN_ROLE === "all" || ATN_ROLE === "worker") {
      startScheduler();
    }
    logger.info("Pre-warming FinBERT model in background...");
    prewarmFinBERT().then(() => logger.info("FinBERT model ready")).catch((err) => logger.error("Failed to pre-warm FinBERT", { error: String(err) }));
    const signals = ["SIGTERM", "SIGINT"];
    signals.forEach((sig) => {
      process.on(sig, async () => {
        logger.info("Received signal, shutting down", { signal: sig });
        stopScheduler();
        closeDatabase();
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error("Fatal error during startup", {
      error: error instanceof Error ? error.message : String(error)
    });
    process.exit(1);
  }
}
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : void 0
  });
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", {
    error: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : void 0
  });
});
main();
