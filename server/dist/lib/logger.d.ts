/**
 * Logger with JSON output and redaction of sensitive values.
 * Redaction is key-name-based only; it won't catch secrets passed under innocuous key names.
 */
export declare const logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
    debug(msg: string, meta?: Record<string, unknown>): void;
    child(bindings: Record<string, unknown>): Logger;
};
export declare class Logger {
    private bindings;
    constructor(bindings: Record<string, unknown>);
}
export interface Logger {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
    debug(msg: string, meta?: Record<string, unknown>): void;
    child(bindings: Record<string, unknown>): Logger;
}
//# sourceMappingURL=logger.d.ts.map