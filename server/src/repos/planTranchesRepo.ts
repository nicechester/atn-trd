import type Database from 'better-sqlite3';
import type { Regime } from './marketRegimeRepo.js';

export type TrancheStatus = 'PENDING' | 'FILLED' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export interface PlanTrancheRow {
  id: string;
  planId: string;
  trancheNumber: number;
  shares: number;
  priceCents: number;
  orderId: string | null;
  orderStatus: TrancheStatus;
  totalCostCents: number | null;
  compositeScore: number | null;
  regime: Regime | null;
  executedAt: number;
  filledAt: number | null;
}

export class PlanTranchesRepo {
  constructor(private readonly db: Database.Database) {}

  create(tranche: Omit<PlanTrancheRow, 'orderStatus' | 'totalCostCents' | 'filledAt'>): void {
    this.db
      .prepare(
        `INSERT INTO plan_tranches (id, plan_id, tranche_number, shares, price_cents, order_id,
           order_status, total_cost_cents, composite_score, regime, executed_at, filled_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, ?, NULL)`
      )
      .run(
        tranche.id,
        tranche.planId,
        tranche.trancheNumber,
        tranche.shares,
        tranche.priceCents,
        tranche.orderId,
        tranche.compositeScore,
        tranche.regime,
        tranche.executedAt
      );
  }

  listByPlan(planId: string): PlanTrancheRow[] {
    return this.db
      .prepare(
        `SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, order_status as orderStatus, total_cost_cents as totalCostCents,
           composite_score as compositeScore, regime, executed_at as executedAt, filled_at as filledAt
         FROM plan_tranches WHERE plan_id = ? ORDER BY tranche_number`
      )
      .all(planId) as PlanTrancheRow[];
  }

  getLatestByPlan(planId: string): PlanTrancheRow | undefined {
    return this.db
      .prepare(
        `SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, order_status as orderStatus, total_cost_cents as totalCostCents,
           composite_score as compositeScore, regime, executed_at as executedAt, filled_at as filledAt
         FROM plan_tranches WHERE plan_id = ? ORDER BY tranche_number DESC LIMIT 1`
      )
      .get(planId) as PlanTrancheRow | undefined;
  }

  listPending(): PlanTrancheRow[] {
    return this.db
      .prepare(
        `SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, order_status as orderStatus, total_cost_cents as totalCostCents,
           composite_score as compositeScore, regime, executed_at as executedAt, filled_at as filledAt
         FROM plan_tranches WHERE order_status = 'PENDING' ORDER BY executed_at`
      )
      .all() as PlanTrancheRow[];
  }

  updateStatus(id: string, status: TrancheStatus, totalCostCents?: number, filledAt?: number): void {
    this.db
      .prepare(
        `UPDATE plan_tranches SET order_status = ?, total_cost_cents = ?, filled_at = ? WHERE id = ?`
      )
      .run(status, totalCostCents ?? null, filledAt ?? null, id);
  }

  updateShares(id: string, shares: number): void {
    this.db
      .prepare(`UPDATE plan_tranches SET shares = ? WHERE id = ?`)
      .run(shares, id);
  }
}
