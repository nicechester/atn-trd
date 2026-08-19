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
  console.log(`[DEBUG] resolveApiKey('${name}') - Starting resolution (DB > ENV precedence)`);

  try {
    const fromStore = resolveSecret(name)?.trim();
    console.log(`[DEBUG] resolveApiKey('${name}') - resolveSecret() returned:`, fromStore ? 'FOUND (length: ' + fromStore.length + ')' : 'NOT FOUND');
    if (fromStore) {
      console.log(`[DEBUG] resolveApiKey('${name}') - Returning from store`);
      return fromStore;
    }
  } catch (err) {
    console.log(`[DEBUG] resolveApiKey('${name}') - Error from resolveSecret:`, err instanceof Error ? err.message : String(err));
    log.debug('secret store unavailable', {
      name,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const fromEnv = process.env[name]?.trim();
  console.log(`[DEBUG] resolveApiKey('${name}') - process.env fallback:`, fromEnv ? 'FOUND (length: ' + fromEnv.length + ')' : 'NOT FOUND');
  const result = fromEnv || undefined;
  console.log(`[DEBUG] resolveApiKey('${name}') - Final result:`, result ? 'FOUND' : 'NOT FOUND');
  return result;
}

export type ApiKeyResolver = () => string | undefined;

export function apiKeyResolver(name: string): ApiKeyResolver {
  return () => resolveApiKey(name);
}
