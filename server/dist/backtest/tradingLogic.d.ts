/**
 * Signal-based trading logic for backtesting.
 * Computes composite scores from sentiment + price momentum and executes trades.
 */
import type { Settings } from '@atn-trd/shared';
import type { MockBroker } from '../brokers/mockBroker.js';
export interface SignalProvider {
    /** Get sentiment score for symbol as of date (point-in-time) */
    getSentiment(symbol: string, date: string): number | null;
    /** Get price for symbol on date */
    getPrice(symbol: string, date: string): {
        openCents: number;
        closeCents: number;
        adjCloseCents: number;
    } | null;
    /** Get price range for SMA calculation */
    getPriceRange(symbol: string, startDate: string, endDate: string): Array<{
        date: string;
        adjCloseCents: number;
    }>;
    /** Get VIX value as of date (for regime detection) */
    getVix?(date: string): number | null;
    /** Get yield curve spread as of date (for regime detection) */
    getYieldCurve?(date: string): number | null;
}
interface TradingLogicParams {
    date: string;
    symbols: string[];
    broker: MockBroker;
    settings: Settings;
    signalProvider: SignalProvider;
    priceHistory: Map<string, Array<{
        date: string;
        adjCloseCents: number;
    }>>;
}
/**
 * Run signal-based trading logic for a single day.
 */
export declare function runSignalBasedTradingLogic(params: TradingLogicParams): Promise<void>;
/**
 * Pre-load price history for SMA calculation.
 */
export declare function preloadPriceHistory(signalProvider: SignalProvider, symbols: string[], startDate: string, daysBack?: number): Map<string, Array<{
    date: string;
    adjCloseCents: number;
}>>;
export {};
//# sourceMappingURL=tradingLogic.d.ts.map