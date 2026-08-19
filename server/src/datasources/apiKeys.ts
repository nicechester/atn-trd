/**
 * Credential lookup for data sources: encrypted secret store first, process
 * environment second.
 */

import { resolveSecret } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'datasource-keys' });

/**
 * Never throws. Precedence: encrypted secret store (DB) → env var. DB wins so
 * a key set in the UI always takes effect; env is the fallback when no DB key
 * is stored.
 */
export function resolveApiKey(name: string): string | undefined {
  try {
    const fromStore = resolveSecret(name)?.trim();
    if (fromStore) return fromStore;
  } catch (err) {
    log.debug('secret store unavailable', {
      name,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return process.env[name]?.trim() || undefined;
}

export type ApiKeyResolver = () => string | undefined;

export function apiKeyResolver(name: string): ApiKeyResolver {
  return () => resolveApiKey(name);
}
