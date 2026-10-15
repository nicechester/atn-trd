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
import type { FillsRepo } from '../repos/fillsRepo.js';
import type { Broker } from '../brokers/types.js';

const log = logger.child({ component: 'tranche-sync' });

export interface TrancheSyncDeps {
  planTranchesRepo: PlanTranchesRepo;
  strategicPlansRepo: StrategicPlansRepo;
  ordersRepo: OrdersRepo;
  broker?: Broker;       // Optional, needed to refresh order state from broker
  fillsRepo?: FillsRepo; // Optional, fill rows give actual qty and price
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
 * Pending, accepted and partially_filled orders keep the tranche PENDING.
 */
function mapOrderStatus(orderStatus: OrderRow['status']): TrancheStatus {
  switch (orderStatus) {
    case 'filled':
      return 'FILLED';
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
 * Sum fill rows for an order. Returns zero totals when no fills are recorded.
 */
function getFillTotals(deps: TrancheSyncDeps, orderId: string): { qty: number; costCents: number } {
  const fills = deps.fillsRepo?.listByOrder(orderId) ?? [];
  let qty = 0;
  let costCents = 0;
  for (const fill of fills) {
    qty += fill.qty;
    costCents += fill.qty * fill.priceCents;
  }
  return { qty, costCents: Math.round(costCents) };
}

/**
 * Sync a single tranche's order status from local order and fill records.
 */
export function syncTrancheStatus(
  deps: TrancheSyncDeps,
  tranche: PlanTrancheRow
): SyncResult | null {
  const { planTranchesRepo, strategicPlansRepo, ordersRepo } = deps;

  if (!tranche.orderId) {
    if (tranche.orderStatus === 'PENDING') {
      log.debug('tranche has no linked order, leaving pending', { trancheId: tranche.id });
    }
    return null;
  }

  const order = ordersRepo.get(tranche.orderId);
  if (!order) {
    log.warn('order not found for tranche', { trancheId: tranche.id, orderId: tranche.orderId });
    return null;
  }

  const fills = getFillTotals(deps, order.id);
  const hasFills = fills.qty > 0;

  // A canceled or expired order with a partial fill counts as filled for the filled quantity
  const isFilledOutcome =
    order.status === 'filled' ||
    ((order.status === 'canceled' || order.status === 'expired') && hasFills);
  const newStatus: TrancheStatus = isFilledOutcome ? 'FILLED' : mapOrderStatus(order.status);
  if (newStatus === tranche.orderStatus) {
    return null; // No change
  }

  const previousStatus = tranche.orderStatus;

  if (newStatus === 'FILLED') {
    // Actual fill figures from fill rows, falling back to order qty at planned price
    const filledShares = hasFills ? fills.qty : order.qty;
    const totalCostCents = hasFills ? fills.costCents : filledShares * tranche.priceCents;

    if (filledShares < tranche.shares) {
      planTranchesRepo.updateShares(tranche.id, filledShares);
    }
    planTranchesRepo.updateStatus(tranche.id, 'FILLED', totalCostCents, Date.now());
    strategicPlansRepo.recordTrancheExecution(tranche.planId, filledShares);

    const plan = strategicPlansRepo.get(tranche.planId);
    if (plan && plan.status === 'ACTIVE' && plan.tranchesExecuted >= plan.trancheCount) {
      strategicPlansRepo.updateStatus(tranche.planId, 'COMPLETED');
      log.info('plan completed', { planId: tranche.planId });
    }

    log.info('tranche filled', {
      trancheId: tranche.id,
      planId: tranche.planId,
      shares: filledShares,
      totalCostCents,
    });

    return {
      trancheId: tranche.id,
      planId: tranche.planId,
      previousStatus,
      newStatus: 'FILLED',
      filledShares,
      totalCostCents,
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
 * Refresh local order and fill records for pending tranches from the broker.
 * Run before syncAllPendingTranches so the sync reads up-to-date local state.
 */
export async function refreshTrancheOrdersFromBroker(deps: TrancheSyncDeps): Promise<void> {
  const { planTranchesRepo, ordersRepo, broker, fillsRepo } = deps;
  if (!broker) return;

  for (const tranche of planTranchesRepo.listPending()) {
    if (!tranche.orderId) continue;

    try {
      const order = ordersRepo.get(tranche.orderId);
      if (!order?.brokerOrderId) continue;

      const state = await broker.getOrder(order.brokerOrderId);
      if (!state) continue;

      if (state.status !== order.status) {
        ordersRepo.updateStatus(order.id, state.status, state.id);
      }

      const isTerminal = state.status === 'filled' || state.status === 'canceled'
        || state.status === 'rejected' || state.status === 'expired';
      const hasPartialFill = isTerminal && (state.filledQty ?? 0) > 0;
      const hasFill = state.status === 'filled' || hasPartialFill;

      if (fillsRepo && hasFill) {
        if (!state.fillPriceCents) {
          log.warn('filled order has no fill price, skipping fill record', { orderId: order.id });
        } else if (fillsRepo.listByOrder(order.id).length === 0) {
          const filledAt = state.updatedAt || Date.now();
          fillsRepo.create({
            orderId: order.id,
            qty: state.filledQty ?? order.qty,
            priceCents: state.fillPriceCents,
            feeCents: 0,
            filledAt,
            barDate: new Date(filledAt).toISOString().split('T')[0],
          });
        }
      }
    } catch (err) {
      log.warn('failed to refresh tranche order from broker', {
        trancheId: tranche.id,
        orderId: tranche.orderId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
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
