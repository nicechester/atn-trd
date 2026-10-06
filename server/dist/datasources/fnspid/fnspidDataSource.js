/**
 * FNSPID Data Source for Backtesting
 *
 * Provides historical prices and pre-computed FinBERT sentiment from fnspid.db.
 * Used by BacktestRunner to replay historical data through the trading pipeline.
 */
import Database from 'better-sqlite3';
import { logger } from '../../lib/logger.js';
const log = logger.child({ component: 'fnspid-datasource' });
export class FnspidDataSource {
    db;
    stmtGetPrice;
    stmtGetPriceRange;
    stmtGetSentiment;
    stmtGetSentimentRange;
    stmtListSymbols;
    stmtGetDateRange;
    stmtGetSentimentDateRange;
    stmtGetSentimentAsOf;
    stmtGetRecentSentiment;
    constructor(options) {
        this.db = new Database(options.dbPath, { readonly: true });
        this.stmtGetPrice = this.db.prepare(`
      SELECT symbol, date, open_cents as openCents, high_cents as highCents,
             low_cents as lowCents, close_cents as closeCents,
             adj_close_cents as adjCloseCents, volume
      FROM prices
      WHERE symbol = ? AND date = ?
    `);
        this.stmtGetPriceRange = this.db.prepare(`
      SELECT symbol, date, open_cents as openCents, high_cents as highCents,
             low_cents as lowCents, close_cents as closeCents,
             adj_close_cents as adjCloseCents, volume
      FROM prices
      WHERE symbol = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `);
        this.stmtGetSentiment = this.db.prepare(`
      SELECT symbol, date, headline as headlineCount, sentiment_score as sentimentScore
      FROM news_sentiment
      WHERE symbol = ? AND date = ?
    `);
        this.stmtGetSentimentRange = this.db.prepare(`
      SELECT symbol, date, headline as headlineCount, sentiment_score as sentimentScore
      FROM news_sentiment
      WHERE symbol = ? AND date >= ? AND date <= ?
      ORDER BY date ASC
    `);
        this.stmtGetSentimentAsOf = this.db.prepare(`
      SELECT symbol, date, headline as headlineCount, sentiment_score as sentimentScore
      FROM news_sentiment
      WHERE symbol = ? AND date <= ?
      ORDER BY date DESC
      LIMIT 1
    `);
        this.stmtGetRecentSentiment = this.db.prepare(`
      SELECT symbol, date, headline as headlineCount, sentiment_score as sentimentScore
      FROM news_sentiment
      WHERE symbol = ? AND date <= ?
      ORDER BY date DESC
      LIMIT ?
    `);
        this.stmtListSymbols = this.db.prepare(`
      SELECT DISTINCT symbol FROM prices ORDER BY symbol
    `);
        // Use metadata table for fast date range lookup
        this.stmtGetDateRange = this.db.prepare(`
      SELECT 
        (SELECT value FROM dataset_meta WHERE key = 'price_min_date') as minDate,
        (SELECT value FROM dataset_meta WHERE key = 'price_max_date') as maxDate
    `);
        this.stmtGetSentimentDateRange = this.db.prepare(`
      SELECT 
        (SELECT value FROM dataset_meta WHERE key = 'sentiment_min_date') as minDate,
        (SELECT value FROM dataset_meta WHERE key = 'sentiment_max_date') as maxDate
    `);
        log.info('fnspid datasource initialized', { dbPath: options.dbPath });
    }
    getPrice(symbol, date) {
        return this.stmtGetPrice.get(symbol.toUpperCase(), date);
    }
    getPriceRange(symbol, startDate, endDate) {
        return this.stmtGetPriceRange.all(symbol.toUpperCase(), startDate, endDate);
    }
    getSentiment(symbol, date) {
        const row = this.stmtGetSentiment.get(symbol.toUpperCase(), date);
        if (!row)
            return null;
        return {
            symbol: row.symbol,
            date: row.date,
            headlineCount: parseInt(row.headlineCount, 10) || 0,
            sentimentScore: row.sentimentScore,
        };
    }
    getSentimentRange(symbol, startDate, endDate) {
        const rows = this.stmtGetSentimentRange.all(symbol.toUpperCase(), startDate, endDate);
        return rows.map(row => ({
            symbol: row.symbol,
            date: row.date,
            headlineCount: parseInt(row.headlineCount, 10) || 0,
            sentimentScore: row.sentimentScore,
        }));
    }
    getSentimentAsOf(symbol, asOfDate) {
        const row = this.stmtGetSentimentAsOf.get(symbol.toUpperCase(), asOfDate);
        if (!row)
            return null;
        return {
            symbol: row.symbol,
            date: row.date,
            headlineCount: parseInt(row.headlineCount, 10) || 0,
            sentimentScore: row.sentimentScore,
        };
    }
    getRecentSentiment(symbol, asOfDate, days) {
        const rows = this.stmtGetRecentSentiment.all(symbol.toUpperCase(), asOfDate, days);
        return rows.map(row => ({
            symbol: row.symbol,
            date: row.date,
            headlineCount: parseInt(row.headlineCount, 10) || 0,
            sentimentScore: row.sentimentScore,
        })).reverse();
    }
    listSymbols() {
        const rows = this.stmtListSymbols.all();
        return rows.map(r => r.symbol);
    }
    getDateRange() {
        const row = this.stmtGetDateRange.get();
        return row?.minDate ? row : null;
    }
    getSentimentDateRange() {
        const row = this.stmtGetSentimentDateRange.get();
        return row?.minDate ? row : null;
    }
    createPriceProvider() {
        return {
            getPrice: async (symbol, date) => {
                const price = this.getPrice(symbol, date);
                if (!price)
                    return null;
                return {
                    openCents: price.openCents,
                    closeCents: price.closeCents,
                };
            },
        };
    }
    createBenchmarkProvider() {
        return async (date) => {
            const price = this.getPrice('SPY', date);
            return price?.closeCents ?? null;
        };
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=fnspidDataSource.js.map