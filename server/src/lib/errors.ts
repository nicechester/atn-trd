export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  readonly issues?: unknown;
  constructor(message: string, issues?: unknown) {
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
  constructor(message: string) {
    super(message, 404, "NOT_FOUND");
  }
}

/** An upstream data source failed in a way that is not the caller's fault. */
export class UpstreamError extends AppError {
  readonly source?: string;
  constructor(message: string, source?: string) {
    super(message, 502, "UPSTREAM_ERROR");
    this.source = source;
  }
}

/** A data source is missing a credential it cannot run without. */
export class DataSourceNotConfiguredError extends AppError {
  readonly source: string;
  readonly secretName: string;
  constructor(source: string, secretName: string) {
    super(
      `${source} is not configured. Add ${secretName} under Settings -> Secrets, or set the ${secretName} environment variable.`,
      503,
      "DATASOURCE_NOT_CONFIGURED"
    );
    this.source = source;
    this.secretName = secretName;
  }
}

/** The upstream provider has no instrument matching the requested symbol. */
export class SymbolNotFoundError extends AppError {
  readonly symbol: string;
  constructor(symbol: string) {
    super(`Unknown symbol: ${symbol}`, 404, "SYMBOL_NOT_FOUND");
    this.symbol = symbol;
  }
}
