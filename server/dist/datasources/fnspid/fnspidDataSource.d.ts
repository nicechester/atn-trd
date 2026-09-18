/**
 * FNSPID Data Source for Backtesting
 *
 * Provides historical prices and pre-computed FinBERT sentiment from fnspid.db.
 * Used by BacktestRunner to replay historical data through the trading pipeline.
 */
import type { HistoricalPriceProvider } from '../../brokers/mockBroker.js';
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
    sentimentScore: number;
}
export interface FnspidDataSourceOptions {
    dbPath: string;
}
export declare class FnspidDataSource {
    private readonly db;
    private readonly stmtGetPrice;
    private readonly stmtGetPriceRange;
    private readonly stmtGetSentiment;
    private readonly stmtGetSentimentRange;
    private readonly stmtListSymbols;
    private readonly stmtGetDateRange;
    private readonly stmtGetSentimentDateRange;
    private readonly stmtGetSentimentAsOf;
    private readonly stmtGetRecentSentiment;
    constructor(options: FnspidDataSourceOptions);
    getPrice(symbol: string, date: string): FnspidPrice | null;
    getPriceRange(symbol: string, startDate: string, endDate: string): FnspidPrice[];
    getSentiment(symbol: string, date: string): FnspidSentiment | null;
    getSentimentRange(symbol: string, startDate: string, endDate: string): FnspidSentiment[];
    getSentimentAsOf(symbol: string, asOfDate: string): FnspidSentiment | null;
    getRecentSentiment(symbol: string, asOfDate: string, days: number): FnspidSentiment[];
    listSymbols(): string[];
    getDateRange(): {
        minDate: string;
        maxDate: string;
    } | null;
    getSentimentDateRange(): {
        minDate: string;
        maxDate: string;
    } | null;
    createPriceProvider(): HistoricalPriceProvider;
    createBenchmarkProvider(): (date: string) => Promise<number | null>;
    close(): void;
}
//# sourceMappingURL=fnspidDataSource.d.ts.map