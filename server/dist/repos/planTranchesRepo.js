export class PlanTranchesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(tranche) {
        this.db
            .prepare(`INSERT INTO plan_tranches (id, plan_id, tranche_number, shares, price_cents, order_id,
           order_status, total_cost_cents, composite_score, regime, executed_at, filled_at)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, ?, ?, ?, NULL)`)
            .run(tranche.id, tranche.planId, tranche.trancheNumber, tranche.shares, tranche.priceCents, tranche.orderId, tranche.compositeScore, tranche.regime, tranche.executedAt);
    }
    listByPlan(planId) {
        return this.db
            .prepare(`SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, order_status as orderStatus, total_cost_cents as totalCostCents,
           composite_score as compositeScore, regime, executed_at as executedAt, filled_at as filledAt
         FROM plan_tranches WHERE plan_id = ? ORDER BY tranche_number`)
            .all(planId);
    }
    getLatestByPlan(planId) {
        return this.db
            .prepare(`SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, order_status as orderStatus, total_cost_cents as totalCostCents,
           composite_score as compositeScore, regime, executed_at as executedAt, filled_at as filledAt
         FROM plan_tranches WHERE plan_id = ? ORDER BY tranche_number DESC LIMIT 1`)
            .get(planId);
    }
    listPending() {
        return this.db
            .prepare(`SELECT id, plan_id as planId, tranche_number as trancheNumber, shares, price_cents as priceCents,
           order_id as orderId, order_status as orderStatus, total_cost_cents as totalCostCents,
           composite_score as compositeScore, regime, executed_at as executedAt, filled_at as filledAt
         FROM plan_tranches WHERE order_status = 'PENDING' ORDER BY executed_at`)
            .all();
    }
    updateStatus(id, status, totalCostCents, filledAt) {
        this.db
            .prepare(`UPDATE plan_tranches SET order_status = ?, total_cost_cents = ?, filled_at = ? WHERE id = ?`)
            .run(status, totalCostCents ?? null, filledAt ?? null, id);
    }
    updateShares(id, shares) {
        this.db
            .prepare(`UPDATE plan_tranches SET shares = ? WHERE id = ?`)
            .run(shares, id);
    }
}
//# sourceMappingURL=planTranchesRepo.js.map