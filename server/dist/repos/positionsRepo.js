export class PositionsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    upsert(position) {
        this.db
            .prepare(`INSERT INTO positions (symbol, qty, avg_cost_cents, realized_pnl_cents, opened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET qty = excluded.qty, avg_cost_cents = excluded.avg_cost_cents,
                                            realized_pnl_cents = excluded.realized_pnl_cents, updated_at = excluded.updated_at`)
            .run(position.symbol, position.qty, position.avgCostCents, position.realizedPnlCents, position.openedAt, position.updatedAt);
    }
    get(symbol) {
        return this.db
            .prepare(`SELECT symbol, qty, avg_cost_cents as avgCostCents, realized_pnl_cents as realizedPnlCents, opened_at as openedAt, updated_at as updatedAt
         FROM positions WHERE symbol = ?`)
            .get(symbol);
    }
    list() {
        return this.db
            .prepare(`SELECT symbol, qty, avg_cost_cents as avgCostCents, realized_pnl_cents as realizedPnlCents, opened_at as openedAt, updated_at as updatedAt
         FROM positions WHERE qty != 0 ORDER BY symbol`)
            .all();
    }
    listAll() {
        return this.db
            .prepare(`SELECT symbol, qty, avg_cost_cents as avgCostCents, realized_pnl_cents as realizedPnlCents, opened_at as openedAt, updated_at as updatedAt
         FROM positions ORDER BY symbol`)
            .all();
    }
    remove(symbol) {
        this.db
            .prepare('DELETE FROM positions WHERE symbol = ?')
            .run(symbol);
    }
    clear() {
        this.db
            .prepare('DELETE FROM positions')
            .run();
    }
    getTotalQtyCost() {
        const result = this.db
            .prepare('SELECT SUM(qty) as totalQty, SUM(qty * avg_cost_cents / 100) as totalCostCents FROM positions WHERE qty > 0')
            .get();
        return {
            totalQty: result.totalQty || 0,
            totalCostCents: Math.round((result.totalCostCents || 0) * 100),
        };
    }
}
//# sourceMappingURL=positionsRepo.js.map