/**
 * Credential lookup for data sources: encrypted secret store first, process
 * environment second.
 */

import { resolveSecret } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'datasource-keys' });

/**
 * Never throws. The secret store needs an open database and an encryption key;
 * when either is missing (worker boot order, CLI usage, tests) we still want the
 * environment fallback rather than a crash inside `isConfigured()`.
 */
export function resolveApiKey(name: string): string | undefined {
  let value: string | undefined;
  try {
    value = resolveSecret(name);
  } catch (err) {
    log.debug('secret store unavailable, falling back to env', {
      name,
      error: err instanceof Error ? err.message : String(err),
    });
    value = process.env[name];
  }
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export type ApiKeyResolver = () => string | undefined;

export function apiKeyResolver(name: string): ApiKeyResolver {
  return () => resolveApiKey(name);
}
