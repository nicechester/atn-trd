import type Database from 'better-sqlite3';

export type PlanDirection = 'ACCUMULATE' | 'TRIM' | 'HEDGE';
export type PlanStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

export interface StrategicPlanRow {
  id: string;
  symbol: string;
  direction: PlanDirection;
  targetShares: number;
  executedShares: number;
  targetWeight: number | null;
  targetBudgetCents: number | null; // Alternative to targetShares for chunky stocks
  trancheCount: number;
  tranchesExecuted: number;
  minDaysBetween: number;
  entryCompositeScore: number | null;
  convictionAtCreation: number | null;
  status: PlanStatus;
  pauseReason: string | null;
  createdAt: number;
  lastTrancheAt: number | null;
  completedAt: number | null;
}

export class StrategicPlansRepo {
  constructor(private readonly db: Database.Database) {}

  create(plan: Omit<StrategicPlanRow, 'executedShares' | 'tranchesExecuted' | 'lastTrancheAt' | 'completedAt'>): void {
    this.db
      .prepare(
        `INSERT INTO strategic_plans (id, symbol, direction, target_shares, executed_shares, target_weight,
           target_budget_cents, tranche_count, tranches_executed, min_days_between, entry_composite_score,
           conviction_at_creation, status, pause_reason, created_at, last_tranche_at, completed_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, NULL, NULL)`
      )
      .run(
        plan.id,
        plan.symbol,
        plan.direction,
        plan.targetShares,
        plan.targetWeight,
        plan.targetBudgetCents,
        plan.trancheCount,
        plan.minDaysBetween,
        plan.entryCompositeScore,
        plan.convictionAtCreation,
        plan.status,
        plan.pauseReason,
        plan.createdAt
      );
  }

  get(id: string): StrategicPlanRow | undefined {
    return this.db
      .prepare(
        `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           created_at as createdAt, last_tranche_at as lastTrancheAt, completed_at as completedAt
         FROM strategic_plans WHERE id = ?`
      )
      .get(id) as StrategicPlanRow | undefined;
  }

  getActiveBySymbol(symbol: string): StrategicPlanRow | undefined {
    return this.db
      .prepare(
        `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           created_at as createdAt, last_tranche_at as lastTrancheAt, completed_at as completedAt
         FROM strategic_plans WHERE symbol = ? AND status = 'ACTIVE'`
      )
      .get(symbol) as StrategicPlanRow | undefined;
  }

  listActive(): StrategicPlanRow[] {
    return this.db
      .prepare(
        `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           created_at as createdAt, last_tranche_at as lastTrancheAt, completed_at as completedAt
         FROM strategic_plans WHERE status = 'ACTIVE' ORDER BY created_at`
      )
      .all() as StrategicPlanRow[];
  }

  listPaused(): StrategicPlanRow[] {
    return this.db
      .prepare(
        `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           created_at as createdAt, last_tranche_at as lastTrancheAt, completed_at as completedAt
         FROM strategic_plans WHERE status = 'PAUSED' ORDER BY created_at`
      )
      .all() as StrategicPlanRow[];
  }

  listBySymbol(symbol: string): StrategicPlanRow[] {
    return this.db
      .prepare(
        `SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           created_at as createdAt, last_tranche_at as lastTrancheAt, completed_at as completedAt
         FROM strategic_plans WHERE symbol = ? ORDER BY created_at DESC`
      )
      .all(symbol) as StrategicPlanRow[];
  }

  updateStatus(id: string, status: PlanStatus, pauseReason?: string): void {
    const completedAt = status === 'COMPLETED' || status === 'CANCELLED' ? Date.now() : null;
    this.db
      .prepare(
        `UPDATE strategic_plans SET status = ?, pause_reason = ?, completed_at = ? WHERE id = ?`
      )
      .run(status, pauseReason ?? null, completedAt, id);
  }

  recordTrancheExecution(id: string, shares: number): void {
    this.db
      .prepare(
        `UPDATE strategic_plans SET
           executed_shares = executed_shares + ?,
           tranches_executed = tranches_executed + 1,
           last_tranche_at = ?
         WHERE id = ?`
      )
      .run(shares, Date.now(), id);
  }
}
