import type { YahooSectorPerformance } from '../datasources/sectors/index.js';
import type { FundamentalsDataSource } from '../datasources/fundamentals/index.js';
import type { OptionsDataSource } from '../datasources/options/index.js';
import type { RunCache } from '../datasources/cache.js';

export interface ScreenerToolsDeps {
  sectorSource: YahooSectorPerformance;
  fundamentalsSource: FundamentalsDataSource;
  optionsSource: OptionsDataSource;
  cache: RunCache;
}
