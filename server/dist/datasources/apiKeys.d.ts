/**
 * Credential lookup for data sources: encrypted secret store first, process
 * environment second.
 */
/**
 * Never throws. Precedence: encrypted secret store (DB) → env var. DB wins so
 * a key set in the UI always takes effect; env is the fallback when no DB key
 * is stored.
 */
export declare function resolveApiKey(name: string): string | undefined;
export type ApiKeyResolver = () => string | undefined;
export declare function apiKeyResolver(name: string): ApiKeyResolver;
//# sourceMappingURL=apiKeys.d.ts.map