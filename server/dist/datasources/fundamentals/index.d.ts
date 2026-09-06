/** Fundamentals connector with Finnhub primary and Yahoo fallback. */
import type { DataSource, DataSourceResult } from '../types.js';
import { type FundamentalsPayload, type FundamentalsQuery } from './yahooFundamentals.js';
export * from './yahooFundamentals.js';
export * from './finnhubFundamentals.js';
export type FundamentalsProvider = 'yahoo' | 'finnhub';
export type FundamentalsDataSource = DataSource<FundamentalsQuery, DataSourceResult<FundamentalsPayload>>;
/**
 * Creates a fundamentals datasource.
 * Uses Finnhub as primary (reliable API), falls back to Yahoo if Finnhub fails.
 */
export declare function createFundamentalsDataSource(_provider?: FundamentalsProvider): FundamentalsDataSource;
//# sourceMappingURL=index.d.ts.map