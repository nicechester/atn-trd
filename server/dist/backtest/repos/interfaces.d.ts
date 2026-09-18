/**
 * Repository interfaces for dependency injection.
 * Allows swapping SQLite repos with in-memory mocks for backtesting.
 */
import type { SignalSnapshotRow } from '../../repos/signalSnapshotsRepo.js';
import type { StrategicPlanRow, PlanDirection, PlanStatus } from '../../repos/strategicPlansRepo.js';
import type { PlanTrancheRow, TrancheStatus } from '../../repos/planTranchesRepo.js';
import type { MarketRegimeRow, Regime } from '../../repos/marketRegimeRepo.js';
import type { PortfolioRow } from '../../repos/portfolioRepo.js';
import type { PositionRow } from '../../repos/positionsRepo.js';
import type { PriceBarRow } from '../../repos/pricesRepo.js';
import type { WatchlistRow } from '../../repos/watchlistRepo.js';
import type { OrderRow } from '../../repos/ordersRepo.js';
export type { SignalSnapshotRow, StrategicPlanRow, PlanDirection, PlanStatus, PlanTrancheRow, TrancheStatus, MarketRegimeRow, Regime, PortfolioRow, PositionRow, PriceBarRow, WatchlistRow, OrderRow, };
export interface ISignalSnapshotsRepo {
    insert(row: SignalSnapshotRow): boolean;
    get(symbol: string, snapshotDate: string): SignalSnapshotRow | undefined;
    getLatest(symbol: string): SignalSnapshotRow | undefined;
    listBySymbol(symbol: string, limit?: number): SignalSnapshotRow[];
    getRecentSnapshots(symbol: string, days: number): SignalSnapshotRow[];
    getRecentSentiment(symbol: string, days: number): Array<{
        snapshotDate: string;
        sentimentScore: number;
    }>;
}
export interface IStrategicPlansRepo {
    create(plan: Omit<StrategicPlanRow, 'executedShares' | 'tranchesExecuted' | 'lastTrancheAt' | 'completedAt'>): void;
    get(id: string): StrategicPlanRow | undefined;
    getActiveBySymbol(symbol: string): StrategicPlanRow | undefined;
    listActive(): StrategicPlanRow[];
    listPaused(): StrategicPlanRow[];
    listBySymbol(symbol: string): StrategicPlanRow[];
    updateStatus(id: string, status: PlanStatus, pauseReason?: string): void;
    recordTrancheExecution(id: string, shares: number, timestamp?: number): void;
}
export interface IPlanTranchesRepo {
    create(tranche: Omit<PlanTrancheRow, 'orderStatus' | 'totalCostCents' | 'filledAt'>): void;
    listByPlan(planId: string): PlanTrancheRow[];
    getLatestByPlan(planId: string): PlanTrancheRow | undefined;
    listPending(): PlanTrancheRow[];
    updateStatus(id: string, status: TrancheStatus, totalCostCents?: number, filledAt?: number): void;
    updateShares(id: string, shares: number): void;
}
export interface IMarketRegimeRepo {
    upsert(row: MarketRegimeRow): void;
    get(asOfDate: string): MarketRegimeRow | undefined;
    getLatest(): MarketRegimeRow | undefined;
    getRecentRegimes(days: number): MarketRegimeRow[];
    getRegimeStreak(regime: Regime): number;
}
export interface IPortfolioRepo {
    read(): PortfolioRow | undefined;
    write(row: PortfolioRow): void;
}
export interface IPositionsRepo {
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
export interface IPricesRepo {
    upsert(bar: PriceBarRow): void;
    get(symbol: string, barDate: string): PriceBarRow | undefined;
    listBySymbol(symbol: string, limit?: number): PriceBarRow[];
    listByDateRange(symbol: string, fromDate: string, toDate: string): PriceBarRow[];
    getLatest(symbol: string): PriceBarRow | undefined;
}
export interface IWatchlistRepo {
    list(): WatchlistRow[];
    get(symbol: string): WatchlistRow | undefined;
    upsert(row: WatchlistRow): void;
    remove(symbol: string): void;
    addSymbol(symbol: string, note?: string | null): WatchlistRow;
    removeSymbol(symbol: string): boolean;
    enableSymbol(symbol: string): boolean;
    disableSymbol(symbol: string): boolean;
}
export interface IOrdersRepo {
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
}
//# sourceMappingURL=interfaces.d.ts.map