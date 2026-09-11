/** News connector selection: Alpaca (preferred), Finnhub, Yahoo, or RSS. */
import type { DataSource, DataSourceResult } from '../types.js';
import type { NewsPayload, NewsQuery } from './types.js';
export * from './types.js';
export { AlpacaNewsDataSource, ALPACA_NEWS_SOURCE } from './alpacaNews.js';
export { FinnhubNewsDataSource, FINNHUB_NEWS_SOURCE, FINNHUB_API_KEY_SECRET } from './finnhubNews.js';
export { YahooNewsDataSource, YAHOO_NEWS_SOURCE } from './yahooNews.js';
export { RssNewsDataSource, RSS_NEWS_SOURCE } from './rssNews.js';
export type NewsProvider = 'alpaca' | 'finnhub' | 'yahoo' | 'rss';
export type NewsDataSource = DataSource<NewsQuery, DataSourceResult<NewsPayload>>;
export interface NewsDataSourceOptions {
    /** Skip Finnhub /news-sentiment call (paid tier). LLM judges sentiment instead. */
    sentiment?: boolean;
}
export declare function createNewsDataSource(provider: NewsProvider, options?: NewsDataSourceOptions): NewsDataSource;
//# sourceMappingURL=index.d.ts.map