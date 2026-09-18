/**
 * ReplayRunner: Orchestrates backtest by replaying actual production jobs.
 *
 * Daily sequence:
 * 1. Load prices for date
 * 2. Run regime detection
 * 3. Run signal collection
 * 4. Run plan review (creates/updates plans)
 * 5. Run tranche executor (executes trades)
 * 6. Record snapshot
 */
import type { Settings } from '@atn-trd/shared';
import { BacktestState } from './BacktestState.js';
import type { IMarketRegimeRepo, ISignalSnapshotsRepo, IStrategicPlansRepo, IPlanTranchesRepo, IPortfolioRepo, IPricesRepo, IPositionsRepo, IWatchlistRepo } from './repos/interfaces.js';
export interface BacktestDataProvider {
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
export interface ReplayRegimeDeps {
    marketRegimeRepo: IMarketRegimeRepo;
    getSettings: () => Settings;
}
export interface ReplaySignalDeps {
    signalSnapshotsRepo: ISignalSnapshotsRepo;
    pricesRepo: IPricesRepo;
    watchlistRepo: IWatchlistRepo;
    positionsRepo: IPositionsRepo;
    getSettings: () => Settings;
}
export interface ReplayPlanReviewDeps {
    signalSnapshotsRepo: ISignalSnapshotsRepo;
    strategicPlansRepo: IStrategicPlansRepo;
    planTranchesRepo: IPlanTranchesRepo;
    marketRegimeRepo: IMarketRegimeRepo;
    portfolioRepo: IPortfolioRepo;
    pricesRepo: IPricesRepo;
    watchlistRepo: IWatchlistRepo;
    positionsRepo: IPositionsRepo;
    getSettings: () => Settings;
}
export interface ReplayTrancheExecutorDeps extends ReplayPlanReviewDeps {
    onFill: (symbol: string, side: 'buy' | 'sell', qty: number, priceCents: number) => void;
    state: BacktestState;
}
export interface ReplayRunnerConfig {
    startDate: string;
    endDate: string;
    symbols: string[];
    startingCashCents: number;
    settings: Settings;
    dataProvider: BacktestDataProvider;
    onDayComplete?: (date: string, snapshot: ReturnType<BacktestState['getStateSnapshot']>) => void;
    log?: (msg: string) => void;
}
export interface ReplayResult {
    finalState: ReturnType<BacktestState['getStateSnapshot']>;
    totalTrades: number;
    plansCreated: number;
    trimPlansCreated: number;
}
/**
 * Run a full backtest replay using actual production job logic.
 */
export declare function runReplay(config: ReplayRunnerConfig): Promise<ReplayResult>;
//# sourceMappingURL=replayRunner.d.ts.map