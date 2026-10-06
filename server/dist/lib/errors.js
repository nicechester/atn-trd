export class AppError extends Error {
    statusCode;
    code;
    constructor(message, statusCode, code) {
        super(message);
        this.name = new.target.name;
        this.statusCode = statusCode;
        this.code = code;
    }
}
export class ValidationError extends AppError {
    issues;
    constructor(message, issues) {
        super(message, 400, "VALIDATION_ERROR");
        this.issues = issues;
    }
}
export class EncryptionUnavailableError extends AppError {
    constructor() {
        super("ATN_ENC_KEY is not set; secret storage is unavailable", 503, "ENCRYPTION_UNAVAILABLE");
    }
}
export class NotFoundError extends AppError {
    constructor(message) {
        super(message, 404, "NOT_FOUND");
    }
}
/** An upstream data source failed in a way that is not the caller's fault. */
export class UpstreamError extends AppError {
    source;
    constructor(message, source) {
        super(message, 502, "UPSTREAM_ERROR");
        this.source = source;
    }
}
/** A data source is missing a credential it cannot run without. */
export class DataSourceNotConfiguredError extends AppError {
    source;
    secretName;
    constructor(source, secretName) {
        super(`${source} is not configured. Add ${secretName} under Settings -> Secrets, or set the ${secretName} environment variable.`, 503, "DATASOURCE_NOT_CONFIGURED");
        this.source = source;
        this.secretName = secretName;
    }
}
/** The upstream provider has no instrument matching the requested symbol. */
export class SymbolNotFoundError extends AppError {
    symbol;
    constructor(symbol) {
        super(`Unknown symbol: ${symbol}`, 404, "SYMBOL_NOT_FOUND");
        this.symbol = symbol;
    }
}
//# sourceMappingURL=errors.js.map