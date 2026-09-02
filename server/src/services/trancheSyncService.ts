/**
 * Tranche Sync Service
 *
 * Syncs tranche order status from broker and handles partial fills.
 * In paper trading, orders fill immediately. In live trading, this would
 * poll the broker or receive webhooks.
 */

import { randomUUID } from 'crypto';
import { logger } from '../lib/logger.js';
import type { PlanTranchesRepo, PlanTrancheRow, TrancheStatus } from '../repos/planTranchesRepo.js';
import type { StrategicPlansRepo } from '../repos/strategicPlansRepo.js';
import type { OrdersRepo, OrderRow } from '../repos/ordersRepo.js';

const log = logger.child({ component: 'tranche-sync' });

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
 * Map broker order status to tranche status.
 */
function mapOrderStatus(orderStatus: OrderRow['status']): TrancheStatus {
  switch (orderStatus) {
    case 'filled':
      return 'FILLED';
    case 'partially_filled':
      return 'PARTIAL';
    case 'rejected':
    case 'expired':
      return 'FAILED';
    case 'canceled':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

/**
 * Sync a single tranche's order status from the broker.
 */
export function syncTrancheStatus(
  deps: TrancheSyncDeps,
  tranche: PlanTrancheRow
): SyncResult | null {
  const { planTranchesRepo, strategicPlansRepo, ordersRepo } = deps;

  if (!tranche.orderId) {
    // No order associated - mark as filled for paper trading
    if (tranche.orderStatus === 'PENDING') {
      planTranchesRepo.updateStatus(
        tranche.id,
        'FILLED',
        tranche.shares * tranche.priceCents,
        Date.now()
      );
      return {
        trancheId: tranche.id,
        planId: tranche.planId,
        previousStatus: 'PENDING',
        newStatus: 'FILLED',
        filledShares: tranche.shares,
        totalCostCents: tranche.shares * tranche.priceCents,
      };
    }
    return null;
  }

  const order = ordersRepo.get(tranche.orderId);
  if (!order) {
    log.warn('order not found for tranche', { trancheId: tranche.id, orderId: tranche.orderId });
    return null;
  }

  const newStatus = mapOrderStatus(order.status);
  if (newStatus === tranche.orderStatus) {
    return null; // No change
  }

  const previousStatus = tranche.orderStatus;

  if (newStatus === 'FILLED') {
    // Full fill - update tranche and plan
    const totalCostCents = order.qty * (order.limitPriceCents ?? tranche.priceCents);
    planTranchesRepo.updateStatus(tranche.id, 'FILLED', totalCostCents, Date.now());
    strategicPlansRepo.recordTrancheExecution(tranche.planId, order.qty);

    log.info('tranche filled', {
      trancheId: tranche.id,
      planId: tranche.planId,
      shares: order.qty,
      totalCostCents,
    });

    return {
      trancheId: tranche.id,
      planId: tranche.planId,
      previousStatus,
      newStatus: 'FILLED',
      filledShares: order.qty,
      totalCostCents,
    };
  }

  if (newStatus === 'PARTIAL') {
    // Partial fill - update tranche with partial info
    // Note: In a real implementation, we'd get filled_qty from the broker
    // For now, we just mark as partial and let the next sync handle it
    planTranchesRepo.updateStatus(tranche.id, 'PARTIAL');

    log.info('tranche partially filled', {
      trancheId: tranche.id,
      planId: tranche.planId,
    });

    return {
      trancheId: tranche.id,
      planId: tranche.planId,
      previousStatus,
      newStatus: 'PARTIAL',
    };
  }

  if (newStatus === 'FAILED' || newStatus === 'CANCELLED') {
    // Failed or cancelled - update tranche status
    planTranchesRepo.updateStatus(tranche.id, newStatus);

    log.warn('tranche failed or cancelled', {
      trancheId: tranche.id,
      planId: tranche.planId,
      status: newStatus,
      reason: order.rejectReason,
    });

    return {
      trancheId: tranche.id,
      planId: tranche.planId,
      previousStatus,
      newStatus,
    };
  }

  return null;
}

/**
 * Sync all pending tranches.
 */
export function syncAllPendingTranches(deps: TrancheSyncDeps): SyncResult[] {
  const { planTranchesRepo } = deps;
  const pendingTranches = planTranchesRepo.listPending();
  const results: SyncResult[] = [];

  for (const tranche of pendingTranches) {
    const result = syncTrancheStatus(deps, tranche);
    if (result) {
      results.push(result);
    }
  }

  if (results.length > 0) {
    log.info('synced pending tranches', {
      total: pendingTranches.length,
      updated: results.length,
    });
  }

  return results;
}

/**
 * Handle a partial fill by creating a follow-up tranche for remaining shares.
 * This is called when we detect a partial fill and want to retry the remainder.
 */
export function createFollowUpTranche(
  deps: TrancheSyncDeps,
  originalTranche: PlanTrancheRow,
  filledShares: number,
  currentPriceCents: number
): string | null {
  const { planTranchesRepo, strategicPlansRepo } = deps;

  const remainingShares = originalTranche.shares - filledShares;
  if (remainingShares < 1) {
    return null;
  }

  const plan = strategicPlansRepo.get(originalTranche.planId);
  if (!plan || plan.status !== 'ACTIVE') {
    return null;
  }

  // Update original tranche with actual filled shares
  planTranchesRepo.updateShares(originalTranche.id, filledShares);

  // Create follow-up tranche for remainder
  const followUpId = randomUUID();
  planTranchesRepo.create({
    id: followUpId,
    planId: originalTranche.planId,
    trancheNumber: originalTranche.trancheNumber, // Same tranche number (it's a continuation)
    shares: remainingShares,
    priceCents: currentPriceCents,
    orderId: null,
    compositeScore: originalTranche.compositeScore,
    regime: originalTranche.regime,
    executedAt: Date.now(),
  });

  log.info('created follow-up tranche for partial fill', {
    originalTrancheId: originalTranche.id,
    followUpTrancheId: followUpId,
    filledShares,
    remainingShares,
  });

  return followUpId;
}
