/**
 * Registry for the four research connectors.
 *
 * Owns provider selection (driven by `settings.dataSources.<id>.provider`) and
 * instance caching — connectors hold token buckets, so they must be reused
 * across requests rather than rebuilt per call.
 */
import { DEFAULT_SETTINGS } from '@atn-trd/shared';
import { DATA_SOURCE_IDS, } from './types.js';
import { getSettings } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';
import { NotFoundError } from '../lib/errors.js';
import { createNewsDataSource, FINNHUB_API_KEY_SECRET } from './news/index.js';
import { createFundamentalsDataSource } from './fundamentals/index.js';
import { createMacroDataSource, FRED_API_KEY_SECRET } from './macro/index.js';
import { createOptionsDataSource } from './options/index.js';
/** Secrets a given connector cannot run without. */
const REQUIRED_SECRETS = {
    'finnhub-news': FINNHUB_API_KEY_SECRET,
    'fred-macro': FRED_API_KEY_SECRET,
};
const log = logger.child({ component: 'datasource-registry' });
function defaultReadSettings() {
    try {
        return getSettings().dataSources;
    }
    catch (err) {
        // Settings live in SQLite; if it is not open yet we still want the page to
        // render with defaults rather than 500.
        log.warn('falling back to default data source settings', {
            error: err instanceof Error ? err.message : String(err),
        });
        return DEFAULT_SETTINGS.dataSources;
    }
}
function defaultCreateSource(id, provider) {
    switch (id) {
        case 'news':
            // Disable Finnhub sentiment - LLM judges sentiment from article text
            return createNewsDataSource(provider, { sentiment: false });
        case 'fundamentals':
            return createFundamentalsDataSource(provider);
        case 'macro':
            return createMacroDataSource(provider);
        case 'options':
            return createOptionsDataSource(provider);
        default:
            throw new NotFoundError(`Unknown data source: ${String(id)}`);
    }
}
export function createDataSourceRegistry(deps = {}) {
    const readSettings = deps.readSettings ?? defaultReadSettings;
    const createSource = deps.createSource ?? defaultCreateSource;
    // Keyed by id + provider so flipping the provider in settings swaps the
    // instance instead of mutating a live one.
    const cache = new Map();
    function settingsFor(id) {
        const configured = readSettings()[id];
        return {
            provider: configured?.provider ?? DEFAULT_SETTINGS.dataSources[id].provider,
            enabled: configured?.enabled ?? DEFAULT_SETTINGS.dataSources[id].enabled,
        };
    }
    function get(id) {
        const { provider } = settingsFor(id);
        const key = `${id}:${provider}`;
        let source = cache.get(key);
        if (!source) {
            source = createSource(id, provider);
            cache.set(key, source);
        }
        return source;
    }
    function describe(id) {
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
//# sourceMappingURL=registry.js.map