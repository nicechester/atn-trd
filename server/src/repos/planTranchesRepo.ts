import type Database from 'better-sqlite3';
import type { Regime } from './marketRegimeRepo.js';

export interface PlanTrancheRow {
  id: string;
  planId: string;
  trancheNumber: number;
  shares: number;
  priceCents: number;
  orderId: string | null;
  compositeScore: number | null;
  regime: Regime | null;
  executedAt: number;
}

export class PlanTranchesRepo {
  constructor(private readonly db: Database.Database) {}

  create(tranche: PlanTrancheRow): void {
    this.db
      .prepare(
        `INSERT INTO plan_tranches (id, plan_id, tranche_number, shares, price_cents, order_id,
           composite_score, regime, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
           order_id as orderId, composite_score as compositeScore, regime, executed_at as executedAt
         FROM plan_tranches WHERE plan_id = ? ORDER BY tranche_number`
      )
      .all(planId) as PlanTrancheRow[];
  }

  getLatestByPlan(planId: string): PlanTrancheRow | undefined {
    return this.db
      .prepare(
        `SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, composite_score as compositeScore, regime, executed_at as executedAt
         FROM plan_tranches WHERE plan_id = ? ORDER BY tranche_number DESC LIMIT 1`
      )
      .get(planId) as PlanTrancheRow | undefined;
  }
}
