/**
 * BacktestState: Container for all in-memory state during backtest replay.
 * Provides isolated state for each backtest run.
 */
import { MockSignalSnapshotsRepo, MockStrategicPlansRepo, MockPlanTranchesRepo, MockMarketRegimeRepo, MockPortfolioRepo, MockPositionsRepo, MockPricesRepo, MockWatchlistRepo, MockOrdersRepo } from './repos/mockRepos.js';
export interface BacktestStateConfig {
    symbols: string[];
    startingCashCents: number;
    startDate: string;
}
export interface Fill {
    date: string;
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    priceCents: number;
}
export declare class BacktestState {
    readonly signalSnapshots: MockSignalSnapshotsRepo;
    readonly strategicPlans: MockStrategicPlansRepo;
    readonly planTranches: MockPlanTranchesRepo;
    readonly marketRegime: MockMarketRegimeRepo;
    readonly portfolio: MockPortfolioRepo;
    readonly positions: MockPositionsRepo;
    readonly prices: MockPricesRepo;
    readonly watchlist: MockWatchlistRepo;
    readonly orders: MockOrdersRepo;
    private currentDate;
    private readonly config;
    private readonly fills;
    constructor(config: BacktestStateConfig);
    private initializeState;
    /** Set current simulation date - updates price repo's "latest" view */
    setCurrentDate(date: string): void;
    getCurrentDate(): string;
    getCurrentDateMs(): number;
    /** Reset all state for a fresh backtest */
    reset(): void;
    /** Get current portfolio value (cash + positions at current prices) */
    getPortfolioValueCents(): number;
    /** Update cash after a trade */
    updateCash(deltaCents: number): void;
    /** Record a position change from a fill */
    recordFill(symbol: string, side: 'buy' | 'sell', qty: number, priceCents: number): void;
    /** Get snapshot of current state */
    getStateSnapshot(): {
        date: string;
        cashCents: number;
        portfolioValueCents: number;
        positions: Array<{
            symbol: string;
            qty: number;
            avgCostCents: number;
        }>;
        positionCount: number;
        activePlanCount: number;
        regime: string | null;
        fills: Fill[];
    };
}
//# sourceMappingURL=BacktestState.d.ts.map