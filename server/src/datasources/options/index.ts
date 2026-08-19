/** Options connector selection (Yahoo only in v1). */

import type { DataSource, DataSourceResult } from '../types.js';
import { YahooOptionsDataSource, type OptionsPayload, type OptionsQuery } from './yahooOptions.js';

export * from './optionsCalendar.js';
export * from './yahooOptions.js';
export {
  CBOE_OPTIONS_SOURCE,
  CBOE_BASE_URL,
  parseOsiSymbol,
  type CboeOptionsResponse,
} from './cboeOptions.js';

export type OptionsProvider = 'yahoo';

export type OptionsDataSource = DataSource<OptionsQuery, DataSourceResult<OptionsPayload>>;

export function createOptionsDataSource(_provider: OptionsProvider = 'yahoo'): OptionsDataSource {
  return new YahooOptionsDataSource();
}
