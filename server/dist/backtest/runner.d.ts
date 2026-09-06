/**
 * BacktestRunner: Replays historical data through the trading pipeline.
 *
 * TODO(#93 follow-up): backtest runs do not feed semantic memory. Neither
 * assessments nor realized trade outcomes generated during a backtest are
 * embedded via SemanticMemoryService. Wiring this up was deferred out of
 * this issue's scope — see #93 spec notes on backtesting vs. semantic
 * memory token cost trade-offs.
 */
import type Database from 'better-sqlite3';
import type { Settings } from '@atn-trd/shared';
import { MockBroker, type HistoricalPriceProvider } from '../brokers/mockBroker.js';
export interface BacktestConfig {
    backtestId?: string;
    name?: string;
    startDate: string;
    endDate: string;
    symbols: string[];
    startingCashCents?: number;
    slippageBps?: number;
    tradingIntervalDays?: number;
}
export interface BacktestResult {
    backtestId: string;
    status: 'succeeded' | 'failed';
    error?: string;
    metrics?: {
        totalReturn: number;
        benchmarkReturn: number;
        sharpeRatio: number | null;
        sortinoRatio: number | null;
        maxDrawdown: number;
        winRate: number | null;
        totalTrades: number;
    };
}
export interface BacktestDeps {
    db: Database.Database;
    priceProvider: HistoricalPriceProvider;
    getBenchmarkPrice: (date: string) => Promise<number | null>;
    runTradingLogic: (params: {
        date: string;
        symbols: string[];
        broker: MockBroker;
        settings: Settings;
    }) => Promise<void>;
    settings: Settings;
}
export declare class BacktestRunner {
    private readonly repo;
    private readonly deps;
    constructor(deps: BacktestDeps);
    run(config: BacktestConfig): Promise<BacktestResult>;
    getResult(backtestId: string): BacktestResult | null;
    listRuns(limit?: number): import("../repos/backtestRepo.js").BacktestRunRow[];
}
//# sourceMappingURL=runner.d.ts.map