/**
 * FNSPID Data Source for Backtesting
 *
 * Provides historical prices and pre-computed FinBERT sentiment from fnspid.db.
 * Used by BacktestRunner to replay historical data through the trading pipeline.
 */

import Database from 'better-sqlite3';
import { logger } from '../../lib/logger.js';
import type { HistoricalPriceProvider } from '../../brokers/mockBroker.js';

const log = logger.child({ component: 'fnspid-datasource' });

export interface FnspidPrice {
  symbol: string;
  date: string;
  openCents: number;
  highCents: number;
  lowCents: number;
  closeCents: number;
  adjCloseCents: number;
  volume: number;
}

export interface FnspidSentiment {
  symbol: string;
  date: string;
  headlineCount: number;
  sentimentScore: number; // -1 to 1, daily average
}

export interface FnspidDataSourceOptions {
  dbPath: string;
}

export class FnspidDataSource {
  private readonly db: Database.Database;

  private readonly stmtGetPrice: Database.Statement;
  private readonly stmtGetPriceRange: Database.Statement;
  private readonly stmtGetSentiment: Database.Statement;
  private readonly stmtGetSentimentRange: Database.Statement;
  private readonly stmtListSymbols: Database.Statement;
  private readonly stmtGetDateRange: Database.Statement;
  private readonly stmtGetSentimentDateRange: Database.Statement;

  constructor(options: FnspidDataSourceOptions) {
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

  getPrice(symbol: string, date: string): FnspidPrice | null {
    return this.stmtGetPrice.get(symbol.toUpperCase(), date) as FnspidPrice | null;
  }

  getPriceRange(symbol: string, startDate: string, endDate: string): FnspidPrice[] {
    return this.stmtGetPriceRange.all(symbol.toUpperCase(), startDate, endDate) as FnspidPrice[];
  }

  getSentiment(symbol: string, date: string): FnspidSentiment | null {
    const row = this.stmtGetSentiment.get(symbol.toUpperCase(), date) as {
      symbol: string;
      date: string;
      headlineCount: string;
      sentimentScore: number;
    } | null;

    if (!row) return null;

    return {
      symbol: row.symbol,
      date: row.date,
      headlineCount: parseInt(row.headlineCount, 10) || 0,
      sentimentScore: row.sentimentScore,
    };
  }

  getSentimentRange(symbol: string, startDate: string, endDate: string): FnspidSentiment[] {
    const rows = this.stmtGetSentimentRange.all(symbol.toUpperCase(), startDate, endDate) as Array<{
      symbol: string;
      date: string;
      headlineCount: string;
      sentimentScore: number;
    }>;

    return rows.map(row => ({
      symbol: row.symbol,
      date: row.date,
      headlineCount: parseInt(row.headlineCount, 10) || 0,
      sentimentScore: row.sentimentScore,
    }));
  }

  getSentimentAsOf(symbol: string, asOfDate: string): FnspidSentiment | null {
    const stmt = this.db.prepare(`
      SELECT symbol, date, headline as headlineCount, sentiment_score as sentimentScore
      FROM news_sentiment
      WHERE symbol = ? AND date <= ?
      ORDER BY date DESC
      LIMIT 1
    `);

    const row = stmt.get(symbol.toUpperCase(), asOfDate) as {
      symbol: string;
      date: string;
      headlineCount: string;
      sentimentScore: number;
    } | null;

    if (!row) return null;

    return {
      symbol: row.symbol,
      date: row.date,
      headlineCount: parseInt(row.headlineCount, 10) || 0,
      sentimentScore: row.sentimentScore,
    };
  }

  getRecentSentiment(symbol: string, asOfDate: string, days: number): FnspidSentiment[] {
    const stmt = this.db.prepare(`
      SELECT symbol, date, headline as headlineCount, sentiment_score as sentimentScore
      FROM news_sentiment
      WHERE symbol = ? AND date <= ?
      ORDER BY date DESC
      LIMIT ?
    `);

    const rows = stmt.all(symbol.toUpperCase(), asOfDate, days) as Array<{
      symbol: string;
      date: string;
      headlineCount: string;
      sentimentScore: number;
    }>;

    return rows.map(row => ({
      symbol: row.symbol,
      date: row.date,
      headlineCount: parseInt(row.headlineCount, 10) || 0,
      sentimentScore: row.sentimentScore,
    })).reverse();
  }

  listSymbols(): string[] {
    const rows = this.stmtListSymbols.all() as Array<{ symbol: string }>;
    return rows.map(r => r.symbol);
  }

  getDateRange(): { minDate: string; maxDate: string } | null {
    const row = this.stmtGetDateRange.get() as { minDate: string; maxDate: string } | null;
    return row?.minDate ? row : null;
  }

  getSentimentDateRange(): { minDate: string; maxDate: string } | null {
    const row = this.stmtGetSentimentDateRange.get() as { minDate: string; maxDate: string } | null;
    return row?.minDate ? row : null;
  }

  createPriceProvider(): HistoricalPriceProvider {
    return {
      getPrice: async (symbol: string, date: string) => {
        const price = this.getPrice(symbol, date);
        if (!price) return null;
        return {
          openCents: price.openCents,
          closeCents: price.closeCents,
        };
      },
    };
  }

  createBenchmarkProvider(): (date: string) => Promise<number | null> {
    return async (date: string) => {
      const price = this.getPrice('SPY', date);
      return price?.closeCents ?? null;
    };
  }

  close(): void {
    this.db.close();
  }
}
