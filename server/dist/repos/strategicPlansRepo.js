export class StrategicPlansRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(plan) {
        this.db
            .prepare(`INSERT INTO strategic_plans (id, symbol, direction, target_shares, executed_shares, target_weight,
           target_budget_cents, tranche_count, tranches_executed, min_days_between, entry_composite_score,
           conviction_at_creation, status, pause_reason, creation_notes, created_at, last_tranche_at, completed_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
            .run(plan.id, plan.symbol, plan.direction, plan.targetShares, plan.targetWeight, plan.targetBudgetCents, plan.trancheCount, plan.minDaysBetween, plan.entryCompositeScore, plan.convictionAtCreation, plan.status, plan.pauseReason, plan.creationNotes, plan.createdAt);
    }
    get(id) {
        return this.db
            .prepare(`SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE id = ?`)
            .get(id);
    }
    getActiveBySymbol(symbol) {
        return this.db
            .prepare(`SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE symbol = ? AND status = 'ACTIVE'`)
            .get(symbol);
    }
    listActive() {
        return this.db
            .prepare(`SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE status = 'ACTIVE' ORDER BY created_at`)
            .all();
    }
    listPaused() {
        return this.db
            .prepare(`SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE status = 'PAUSED' ORDER BY created_at`)
            .all();
    }
    listBySymbol(symbol) {
        return this.db
            .prepare(`SELECT id, symbol, direction, target_shares as targetShares, executed_shares as executedShares,
           target_weight as targetWeight, target_budget_cents as targetBudgetCents,
           tranche_count as trancheCount, tranches_executed as tranchesExecuted,
           min_days_between as minDaysBetween, entry_composite_score as entryCompositeScore,
           conviction_at_creation as convictionAtCreation, status, pause_reason as pauseReason,
           creation_notes as creationNotes, created_at as createdAt, last_tranche_at as lastTrancheAt,
           completed_at as completedAt
         FROM strategic_plans WHERE symbol = ? ORDER BY created_at DESC`)
            .all(symbol);
    }
    updateStatus(id, status, pauseReason) {
        const completedAt = status === 'COMPLETED' || status === 'CANCELLED' ? Date.now() : null;
        this.db
            .prepare(`UPDATE strategic_plans SET status = ?, pause_reason = ?, completed_at = ? WHERE id = ?`)
            .run(status, pauseReason ?? null, completedAt, id);
    }
    recordTrancheExecution(id, shares) {
        this.db
            .prepare(`UPDATE strategic_plans SET
           executed_shares = executed_shares + ?,
           tranches_executed = tranches_executed + 1,
           last_tranche_at = ?
         WHERE id = ?`)
            .run(shares, Date.now(), id);
    }
}
//# sourceMappingURL=strategicPlansRepo.js.map