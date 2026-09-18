/**
 * In-memory mock implementations of repositories for backtesting.
 * Uses Maps/Arrays instead of SQLite for fast, isolated execution.
 */
import type { ISignalSnapshotsRepo, IStrategicPlansRepo, IPlanTranchesRepo, IMarketRegimeRepo, IPortfolioRepo, IPositionsRepo, IPricesRepo, IWatchlistRepo, IOrdersRepo, SignalSnapshotRow, StrategicPlanRow, PlanStatus, PlanTrancheRow, TrancheStatus, MarketRegimeRow, Regime, PortfolioRow, PositionRow, PriceBarRow, WatchlistRow, OrderRow } from './interfaces.js';
export declare class MockSignalSnapshotsRepo implements ISignalSnapshotsRepo {
    private snapshots;
    private key;
    insert(row: SignalSnapshotRow): boolean;
    get(symbol: string, snapshotDate: string): SignalSnapshotRow | undefined;
    getLatest(symbol: string): SignalSnapshotRow | undefined;
    listBySymbol(symbol: string, limit?: number): SignalSnapshotRow[];
    getRecentSnapshots(symbol: string, days: number): SignalSnapshotRow[];
    getRecentSentiment(symbol: string, days: number): Array<{
        snapshotDate: string;
        sentimentScore: number;
    }>;
    clear(): void;
}
export declare class MockStrategicPlansRepo implements IStrategicPlansRepo {
    private plans;
    create(plan: Omit<StrategicPlanRow, 'executedShares' | 'tranchesExecuted' | 'lastTrancheAt' | 'completedAt'>): void;
    get(id: string): StrategicPlanRow | undefined;
    getActiveBySymbol(symbol: string): StrategicPlanRow | undefined;
    listActive(): StrategicPlanRow[];
    listPaused(): StrategicPlanRow[];
    listBySymbol(symbol: string): StrategicPlanRow[];
    updateStatus(id: string, status: PlanStatus, pauseReason?: string): void;
    recordTrancheExecution(id: string, shares: number, timestamp?: number): void;
    clear(): void;
}
export declare class MockPlanTranchesRepo implements IPlanTranchesRepo {
    private tranches;
    create(tranche: Omit<PlanTrancheRow, 'orderStatus' | 'totalCostCents' | 'filledAt'>): void;
    listByPlan(planId: string): PlanTrancheRow[];
    getLatestByPlan(planId: string): PlanTrancheRow | undefined;
    listPending(): PlanTrancheRow[];
    updateStatus(id: string, status: TrancheStatus, totalCostCents?: number, filledAt?: number): void;
    updateShares(id: string, shares: number): void;
    clear(): void;
}
export declare class MockMarketRegimeRepo implements IMarketRegimeRepo {
    private regimes;
    upsert(row: MarketRegimeRow): void;
    get(asOfDate: string): MarketRegimeRow | undefined;
    getLatest(): MarketRegimeRow | undefined;
    getRecentRegimes(days: number): MarketRegimeRow[];
    getRegimeStreak(regime: Regime): number;
    clear(): void;
}
export declare class MockPortfolioRepo implements IPortfolioRepo {
    private portfolio;
    read(): PortfolioRow | undefined;
    write(row: PortfolioRow): void;
    clear(): void;
}
export declare class MockPositionsRepo implements IPositionsRepo {
    private positions;
    upsert(position: PositionRow): void;
    get(symbol: string): PositionRow | undefined;
    list(): PositionRow[];
    listAll(): PositionRow[];
    remove(symbol: string): void;
    clear(): void;
    getTotalQtyCost(): {
        totalQty: number;
        totalCostCents: number;
    };
}
export declare class MockPricesRepo implements IPricesRepo {
    private prices;
    private latestBySymbol;
    private key;
    upsert(bar: PriceBarRow): void;
    get(symbol: string, barDate: string): PriceBarRow | undefined;
    listBySymbol(symbol: string, limit?: number): PriceBarRow[];
    listByDateRange(symbol: string, fromDate: string, toDate: string): PriceBarRow[];
    getLatest(symbol: string): PriceBarRow | undefined;
    clear(): void;
    /** Set the "current" date for getLatest - used in backtesting */
    setCurrentDate(date: string): void;
}
export declare class MockWatchlistRepo implements IWatchlistRepo {
    private watchlist;
    private removals;
    list(): WatchlistRow[];
    get(symbol: string): WatchlistRow | undefined;
    upsert(row: WatchlistRow): void;
    remove(symbol: string): void;
    addSymbol(symbol: string, note?: string | null): WatchlistRow;
    removeSymbol(symbol: string): boolean;
    enableSymbol(symbol: string): boolean;
    disableSymbol(symbol: string): boolean;
    clear(): void;
}
export declare class MockOrdersRepo implements IOrdersRepo {
    private orders;
    create(order: Omit<OrderRow, 'id' | 'updatedAt'>): string;
    get(id: string): OrderRow | undefined;
    getByClientOrderId(clientOrderId: string): OrderRow | undefined;
    listByRun(runId: string): OrderRow[];
    updateStatus(id: string, status: OrderRow['status'], brokerOrderId?: string, rejectReason?: string): void;
    listPending(symbol?: string): OrderRow[];
    list(filter?: {
        status?: OrderRow['status'][];
        since?: number;
    }): OrderRow[];
    clear(): void;
}
//# sourceMappingURL=mockRepos.d.ts.map