/**
 * Tranche Sync Service
 *
 * Syncs tranche order status from broker and handles partial fills.
 * In paper trading, orders fill immediately. In live trading, this would
 * poll the broker or receive webhooks.
 */
import type { PlanTranchesRepo, PlanTrancheRow, TrancheStatus } from '../repos/planTranchesRepo.js';
import type { StrategicPlansRepo } from '../repos/strategicPlansRepo.js';
import type { OrdersRepo } from '../repos/ordersRepo.js';
export interface TrancheSyncDeps {
    planTranchesRepo: PlanTranchesRepo;
    strategicPlansRepo: StrategicPlansRepo;
    ordersRepo: OrdersRepo;
}
export interface SyncResult {
    trancheId: string;
    planId: string;
    previousStatus: TrancheStatus;
    newStatus: TrancheStatus;
    filledShares?: number;
    totalCostCents?: number;
}
/**
 * Sync a single tranche's order status from the broker.
 */
export declare function syncTrancheStatus(deps: TrancheSyncDeps, tranche: PlanTrancheRow): SyncResult | null;
/**
 * Sync all pending tranches.
 */
export declare function syncAllPendingTranches(deps: TrancheSyncDeps): SyncResult[];
/**
 * Handle a partial fill by creating a follow-up tranche for remaining shares.
 * This is called when we detect a partial fill and want to retry the remainder.
 */
export declare function createFollowUpTranche(deps: TrancheSyncDeps, originalTranche: PlanTrancheRow, filledShares: number, currentPriceCents: number): string | null;
//# sourceMappingURL=trancheSyncService.d.ts.map