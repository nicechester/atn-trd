/**
 * Registry for the four research connectors.
 *
 * Owns provider selection (driven by `settings.dataSources.<id>.provider`) and
 * instance caching — connectors hold token buckets, so they must be reused
 * across requests rather than rebuilt per call.
 */

import { DEFAULT_SETTINGS, type Settings } from '@atn-trd/shared';
import {
  DATA_SOURCE_IDS,
  type DataSource,
  type DataSourceHealth,
  type DataSourceId,
} from './types.js';
import { getSettings } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';
import { NotFoundError } from '../lib/errors.js';
import { createNewsDataSource, FINNHUB_API_KEY_SECRET, type NewsProvider } from './news/index.js';
import { createFundamentalsDataSource, type FundamentalsProvider } from './fundamentals/index.js';
import { createMacroDataSource, FRED_API_KEY_SECRET, type MacroProvider } from './macro/index.js';
import { createOptionsDataSource, type OptionsProvider } from './options/index.js';

/** Erased connector type: enough for status and health, not for `fetch`. */
export type AnyDataSource = DataSource<never, unknown>;

export type DataSourcesSettings = Settings['dataSources'];

export interface DataSourceDescriptor {
  id: DataSourceId;
  /** Provider selected in settings, e.g. "finnhub". */
  provider: string;
  /** Connector implementing that provider, e.g. "finnhub-news". */
  name: string;
  configured: boolean;
  enabled: boolean;
  requiresKey: boolean;
  /** Secret the Settings page must collect, when one is required. */
  secretName: string | null;
}

export interface DataSourceRegistry {
  ids(): readonly DataSourceId[];
  get(id: DataSourceId): AnyDataSource;
  describe(id: DataSourceId): DataSourceDescriptor;
  list(): DataSourceDescriptor[];
  test(id: DataSourceId): Promise<DataSourceHealth>;
}

export interface DataSourceRegistryDeps {
  /** Overridable so tests never touch the database. */
  readSettings?: () => DataSourcesSettings;
  /** Overridable connector construction (tests). */
  createSource?: (id: DataSourceId, provider: string) => AnyDataSource;
}

/** Secrets a given connector cannot run without. */
const REQUIRED_SECRETS: Record<string, string> = {
  'finnhub-news': FINNHUB_API_KEY_SECRET,
  'fred-macro': FRED_API_KEY_SECRET,
};

const log = logger.child({ component: 'datasource-registry' });

function defaultReadSettings(): DataSourcesSettings {
  try {
    return getSettings().dataSources;
  } catch (err) {
    // Settings live in SQLite; if it is not open yet we still want the page to
    // render with defaults rather than 500.
    log.warn('falling back to default data source settings', {
      error: err instanceof Error ? err.message : String(err),
    });
    return DEFAULT_SETTINGS.dataSources;
  }
}

function defaultCreateSource(id: DataSourceId, provider: string): AnyDataSource {
  switch (id) {
    case 'news':
      return createNewsDataSource(provider as NewsProvider);
    case 'fundamentals':
      return createFundamentalsDataSource(provider as FundamentalsProvider);
    case 'macro':
      return createMacroDataSource(provider as MacroProvider);
    case 'options':
      return createOptionsDataSource(provider as OptionsProvider);
    default:
      throw new NotFoundError(`Unknown data source: ${String(id)}`);
  }
}

export function createDataSourceRegistry(deps: DataSourceRegistryDeps = {}): DataSourceRegistry {
  const readSettings = deps.readSettings ?? defaultReadSettings;
  const createSource = deps.createSource ?? defaultCreateSource;
  // Keyed by id + provider so flipping the provider in settings swaps the
  // instance instead of mutating a live one.
  const cache = new Map<string, AnyDataSource>();

  function settingsFor(id: DataSourceId): { provider: string; enabled: boolean } {
    const configured = readSettings()[id];
    return {
      provider: configured?.provider ?? DEFAULT_SETTINGS.dataSources[id].provider,
      enabled: configured?.enabled ?? DEFAULT_SETTINGS.dataSources[id].enabled,
    };
  }

  function get(id: DataSourceId): AnyDataSource {
    const { provider } = settingsFor(id);
    const key = `${id}:${provider}`;
    let source = cache.get(key);
    if (!source) {
      source = createSource(id, provider);
      cache.set(key, source);
    }
    return source;
  }

  function describe(id: DataSourceId): DataSourceDescriptor {
    const { provider, enabled } = settingsFor(id);
    const source = get(id);
    const secretName = REQUIRED_SECRETS[source.name] ?? null;
    const configured = source.isConfigured();
    return {
      id,
      provider,
      name: source.name,
      // `isConfigured` reads the secret store, so this reflects live state.
      configured,
      enabled,
      requiresKey: secretName !== null,
      secretName,
    };
  }

  return {
    ids: () => DATA_SOURCE_IDS,
    get,
    describe,
    list: () => DATA_SOURCE_IDS.map((id) => describe(id)),
    // `healthCheck` never throws: a dead provider yields `{ ok: false }`.
    test: (id) => get(id).healthCheck(),
  };
}

export const dataSourceRegistry = createDataSourceRegistry();
