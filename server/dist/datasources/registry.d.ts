/**
 * Registry for the four research connectors.
 *
 * Owns provider selection (driven by `settings.dataSources.<id>.provider`) and
 * instance caching — connectors hold token buckets, so they must be reused
 * across requests rather than rebuilt per call.
 */
import { type Settings } from '@atn-trd/shared';
import { type DataSource, type DataSourceHealth, type DataSourceId } from './types.js';
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
export declare function createDataSourceRegistry(deps?: DataSourceRegistryDeps): DataSourceRegistry;
export declare const dataSourceRegistry: DataSourceRegistry;
//# sourceMappingURL=registry.d.ts.map