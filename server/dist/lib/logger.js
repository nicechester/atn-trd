/**
 * Logger with JSON output and redaction of sensitive values.
 * Redaction is key-name-based only; it won't catch secrets passed under innocuous key names.
 */
function redact(obj) {
    if (obj === null || obj === undefined) {
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
        if (lowerKey.includes("secret") ||
            lowerKey.includes("token") ||
            lowerKey.includes("apikey") ||
            lowerKey.includes("authorization") ||
            lowerKey.includes("value_enc")) {
            redacted[key] = "[REDACTED]";
        }
        else {
            redacted[key] = redact(value);
        }
    }
    return redacted;
}
function log(level, msg, meta) {
    const output = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...(meta ? redact(meta) : {}),
    };
    const line = JSON.stringify(output);
    if (level === "error" || level === "warn") {
        console.error(line);
    }
    else {
        console.log(line);
    }
}
export const logger = {
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
    },
};
export class Logger {
    bindings;
    constructor(bindings) {
        this.bindings = bindings;
    }
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
        return new Logger({ ...this.bindings, ...bindings });
    }
}
//# sourceMappingURL=logger.js.map