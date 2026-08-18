/**
 * Logger with JSON output and redaction of sensitive values.
 * Redaction is key-name-based only; it won't catch secrets passed under innocuous key names.
 */

type LogLevel = "info" | "warn" | "error" | "debug";

function redact(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redact(item));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (
      lowerKey.includes("secret") ||
      lowerKey.includes("token") ||
      lowerKey.includes("apikey") ||
      lowerKey.includes("authorization") ||
      lowerKey.includes("value_enc")
    ) {
      redacted[key] = "[REDACTED]";
    } else {
      redacted[key] = redact(value);
    }
  }
  return redacted;
}

function log(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const output = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ? redact(meta) : {}),
  };

  const line = JSON.stringify(output);

  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(msg: string, meta?: Record<string, unknown>): void {
    log("info", msg, meta);
  },
  warn(msg: string, meta?: Record<string, unknown>): void {
    log("warn", msg, meta);
  },
  error(msg: string, meta?: Record<string, unknown>): void {
    log("error", msg, meta);
  },
  debug(msg: string, meta?: Record<string, unknown>): void {
    log("debug", msg, meta);
  },
  child(bindings: Record<string, unknown>): Logger {
    return new Logger(bindings);
  },
};

class Logger {
  constructor(private bindings: Record<string, unknown>) {}

  info(msg: string, meta?: Record<string, unknown>): void {
    log("info", msg, { ...this.bindings, ...meta });
  }

  warn(msg: string, meta?: Record<string, unknown>): void {
    log("warn", msg, { ...this.bindings, ...meta });
  }

  error(msg: string, meta?: Record<string, unknown>): void {
    log("error", msg, { ...this.bindings, ...meta });
  }

  debug(msg: string, meta?: Record<string, unknown>): void {
    log("debug", msg, { ...this.bindings, ...meta });
  }

  child(bindings: Record<string, unknown>): Logger {
    return new Logger({ ...this.bindings, ...bindings });
  }
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}
