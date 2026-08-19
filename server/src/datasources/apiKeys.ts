/**
 * Credential lookup for data sources: encrypted secret store first, process
 * environment second.
 */

import { resolveSecret } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'datasource-keys' });

/**
 * Never throws. Precedence: env var → encrypted secret store. Env vars win so
 * that .env / Docker env overrides always take effect without touching the DB.
 */
export function resolveApiKey(name: string): string | undefined {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;

  try {
    const fromStore = resolveSecret(name)?.trim();
    return fromStore && fromStore.length > 0 ? fromStore : undefined;
  } catch (err) {
    log.debug('secret store unavailable', {
      name,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

export type ApiKeyResolver = () => string | undefined;

export function apiKeyResolver(name: string): ApiKeyResolver {
  return () => resolveApiKey(name);
}
