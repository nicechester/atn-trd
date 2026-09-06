export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code: string;
    constructor(message: string, statusCode: number, code: string);
}
export declare class ValidationError extends AppError {
    readonly issues?: unknown;
    constructor(message: string, issues?: unknown);
}
export declare class EncryptionUnavailableError extends AppError {
    constructor();
}
export declare class NotFoundError extends AppError {
    constructor(message: string);
}
/** An upstream data source failed in a way that is not the caller's fault. */
export declare class UpstreamError extends AppError {
    readonly source?: string;
    constructor(message: string, source?: string);
}
/** A data source is missing a credential it cannot run without. */
export declare class DataSourceNotConfiguredError extends AppError {
    readonly source: string;
    readonly secretName: string;
    constructor(source: string, secretName: string);
}
/** The upstream provider has no instrument matching the requested symbol. */
export declare class SymbolNotFoundError extends AppError {
    readonly symbol: string;
    constructor(symbol: string);
}
//# sourceMappingURL=errors.d.ts.map