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
