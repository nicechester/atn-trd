/** Options connector with CBOE primary and Yahoo fallback. */
import type { DataSource, DataSourceResult } from '../types.js';
import { type OptionsPayload, type OptionsQuery } from './yahooOptions.js';
export * from './optionsCalendar.js';
export * from './yahooOptions.js';
export { CBOE_OPTIONS_SOURCE, CBOE_BASE_URL, parseOsiSymbol, type CboeOptionsResponse, } from './cboeOptions.js';
export type OptionsProvider = 'yahoo' | 'cboe';
export type OptionsDataSource = DataSource<OptionsQuery, DataSourceResult<OptionsPayload>>;
/**
 * Creates an options datasource.
 * Uses CBOE as primary (no auth, reliable), falls back to Yahoo if CBOE fails.
 */
export declare function createOptionsDataSource(_provider?: OptionsProvider): OptionsDataSource;
//# sourceMappingURL=index.d.ts.map