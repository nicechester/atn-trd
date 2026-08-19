/** Fundamentals connector selection (Yahoo only in v1). */

import type { DataSource, DataSourceResult } from '../types.js';
import {
  YahooFundamentalsDataSource,
  type FundamentalsPayload,
  type FundamentalsQuery,
} from './yahooFundamentals.js';

export * from './yahooFundamentals.js';

export type FundamentalsProvider = 'yahoo';

export type FundamentalsDataSource = DataSource<
  FundamentalsQuery,
  DataSourceResult<FundamentalsPayload>
>;

export function createFundamentalsDataSource(
  _provider: FundamentalsProvider = 'yahoo'
): FundamentalsDataSource {
  return new YahooFundamentalsDataSource();
}
