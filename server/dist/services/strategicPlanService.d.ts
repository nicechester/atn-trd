/**
 * Strategic Plan Service
 *
 * Manages multi-week accumulation/trim campaigns with tranched execution.
 * Plans are created when signal thresholds are crossed and execute over time.
 */
import type { Settings } from '@atn-trd/shared';
import type { StrategicPlansRepo, StrategicPlanRow, PlanDirection } from '../repos/strategicPlansRepo.js';
import type { PlanTranchesRepo } from '../repos/planTranchesRepo.js';
import type { SignalSnapshotsRepo } from '../repos/signalSnapshotsRepo.js';
import type { MarketRegimeRepo } from '../repos/marketRegimeRepo.js';
import type { PortfolioRepo } from '../repos/portfolioRepo.js';
import type { PricesRepo } from '../repos/pricesRepo.js';
import type { PositionsRepo } from '../repos/positionsRepo.js';
import type { SymbolCategoriesRepo } from '../repos/symbolCategoriesRepo.js';
import type { OrdersRepo } from '../repos/ordersRepo.js';
import type { Broker } from '../brokers/types.js';
export interface StrategicPlanDeps {
    strategicPlansRepo: StrategicPlansRepo;
    planTranchesRepo: PlanTranchesRepo;
    signalSnapshotsRepo: SignalSnapshotsRepo;
    marketRegimeRepo: MarketRegimeRepo;
    portfolioRepo: PortfolioRepo;
    pricesRepo: PricesRepo;
    positionsRepo?: PositionsRepo;
    symbolCategoriesRepo?: SymbolCategoriesRepo;
    ordersRepo?: OrdersRepo;
    broker?: Broker;
    getSettings: () => Settings;
}
export interface CreatePlanParams {
    symbol: string;
    direction: PlanDirection;
    targetShares?: number;
    targetBudgetCents?: number;
    targetWeight?: number;
    trancheCount?: number;
    entryCompositeScore?: number;
    conviction?: number;
    creationNotes?: string;
}
export interface TrancheResult {
    planId: string;
    symbol: string;
    shares: number;
    priceCents: number;
    trancheNumber: number;
    orderId?: string;
}
export declare function createPlan(deps: StrategicPlanDeps, params: CreatePlanParams): StrategicPlanRow;
/**
 * Compute conviction-scaled tranche size.
 * Higher conviction = larger tranches, lower conviction = smaller tranches.
 * Base size is scaled by (currentScore - 0.5) / 0.5, clamped to [0.2, 1.5].
 */
export declare function computeConvictionScaledTranche(plan: StrategicPlanRow, currentScore: number | null): number;
export declare function pausePlan(deps: StrategicPlanDeps, planId: string, reason: string): void;
export declare function resumePlan(deps: StrategicPlanDeps, planId: string): void;
export declare function completePlan(deps: StrategicPlanDeps, planId: string): void;
export declare function cancelPlan(deps: StrategicPlanDeps, planId: string, reason: string): void;
export declare function shouldExecuteTranche(deps: StrategicPlanDeps, plan: StrategicPlanRow): {
    execute: boolean;
    reason?: string;
};
export declare function computeTrancheSize(plan: StrategicPlanRow, currentScore?: number | null, trancheStyle?: string): number;
/**
 * Compute tranche shares for budget-based plans (chunky stock handling).
 * Returns null if can't afford even 1 share.
 */
export declare function computeTrancheSizeWithBudget(plan: StrategicPlanRow, priceCents: number, availableCashCents: number): {
    shares: number;
    reason?: string;
};
export declare function executeTranche(deps: StrategicPlanDeps, plan: StrategicPlanRow, priceCents: number, availableCashCents?: number, orderId?: string): Promise<TrancheResult | null>;
export declare function checkAndPausePlansForRegime(deps: StrategicPlanDeps): number;
export declare function checkAndResumePlansForRegime(deps: StrategicPlanDeps): number;
export declare function checkAndCancelPlansForSignal(deps: StrategicPlanDeps): number;
export interface AutoTrimResult {
    trimPlansCreated: number;
    targetCashPercent: number;
    currentCashPercent: number;
    symbols: string[];
}
/**
 * Create TRIM plans for low-conviction positions to free cash for hedging.
 * Called when regime shifts to RISK_OFF and cash is below target.
 */
export declare function createAutoTrimPlans(deps: StrategicPlanDeps): AutoTrimResult;
export interface SectorExposure {
    sector: string;
    valueCents: number;
    percent: number;
}
/**
 * Calculate current sector exposure from positions.
 */
export declare function calculateSectorExposure(deps: StrategicPlanDeps): {
    exposures: SectorExposure[];
    totalValueCents: number;
};
/**
 * Check if executing a tranche would exceed sector exposure limit.
 * Fetches sector from Finnhub if not in DB.
 */
export declare function checkSectorExposure(deps: StrategicPlanDeps, symbol: string, trancheValueCents: number): Promise<{
    allowed: boolean;
    reason?: string;
    currentExposure?: number;
    newExposure?: number;
}>;
export interface AutoHedgeResult {
    hedgePlanCreated: boolean;
    symbol?: string;
    reason?: string;
}
/**
 * Auto-create HEDGE plan when RISK_OFF regime is confirmed and cash is sufficient.
 */
export declare function maybeCreateAutoHedgePlan(deps: StrategicPlanDeps): AutoHedgeResult;
//# sourceMappingURL=strategicPlanService.d.ts.map