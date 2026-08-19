/** News connector selection: Finnhub (key) or Yahoo (zero-key fallback). */

import type { DataSource, DataSourceResult } from '../types.js';
import type { NewsPayload, NewsQuery } from './types.js';
import { FinnhubNewsDataSource } from './finnhubNews.js';
import { YahooNewsDataSource } from './yahooNews.js';

export * from './types.js';
export { FinnhubNewsDataSource, FINNHUB_NEWS_SOURCE, FINNHUB_API_KEY_SECRET } from './finnhubNews.js';
export { YahooNewsDataSource, YAHOO_NEWS_SOURCE } from './yahooNews.js';

export type NewsProvider = 'finnhub' | 'yahoo';

export type NewsDataSource = DataSource<NewsQuery, DataSourceResult<NewsPayload>>;

export function createNewsDataSource(provider: NewsProvider): NewsDataSource {
  return provider === 'yahoo' ? new YahooNewsDataSource() : new FinnhubNewsDataSource();
}
