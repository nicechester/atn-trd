export class OrdersRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(order) {
        const id = crypto.randomUUID();
        this.db
            .prepare(`INSERT INTO orders (id, client_order_id, decision_id, run_id, broker, broker_order_id, mode, symbol, side, qty, type, limit_price_cents, tif, status, reject_reason, submitted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, order.clientOrderId, order.decisionId, order.runId, order.broker, order.brokerOrderId, order.mode, order.symbol, order.side, order.qty, order.type, order.limitPriceCents, order.tif, order.status, order.rejectReason, order.submittedAt, order.submittedAt);
        return id;
    }
    get(id) {
        return this.db
            .prepare(`SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE id = ?`)
            .get(id);
    }
    getByClientOrderId(clientOrderId) {
        return this.db
            .prepare(`SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE client_order_id = ?`)
            .get(clientOrderId);
    }
    listByRun(runId) {
        return this.db
            .prepare(`SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE run_id = ? ORDER BY submitted_at`)
            .all(runId);
    }
    updateStatus(id, status, brokerOrderId, rejectReason) {
        this.db
            .prepare(`UPDATE orders SET status = ?, broker_order_id = ?, reject_reason = ?, updated_at = ? WHERE id = ?`)
            .run(status, brokerOrderId || null, rejectReason || null, Date.now(), id);
    }
    updateRunContext(id, decisionId, runId) {
        this.db
            .prepare(`UPDATE orders SET decision_id = ?, run_id = ?, updated_at = ? WHERE id = ?`)
            .run(decisionId, runId, Date.now(), id);
    }
    listPending(symbol) {
        if (symbol) {
            return this.db
                .prepare(`SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                  broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                  limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                  submitted_at as submittedAt, updated_at as updatedAt
           FROM orders WHERE status IN ('pending', 'accepted', 'partially_filled') AND symbol = ? ORDER BY submitted_at`)
                .all(symbol);
        }
        return this.db
            .prepare(`SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE status IN ('pending', 'accepted', 'partially_filled') ORDER BY submitted_at`)
            .all();
    }
    list(filter) {
        let sql = `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                      broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                      limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                      submitted_at as submittedAt, updated_at as updatedAt
               FROM orders WHERE 1=1`;
        const params = [];
        if (filter?.status && filter.status.length > 0) {
            const placeholders = filter.status.map(() => '?').join(',');
            sql += ` AND status IN (${placeholders})`;
            params.push(...filter.status);
        }
        if (filter?.since !== undefined) {
            sql += ` AND submitted_at >= ?`;
            params.push(filter.since);
        }
        sql += ` ORDER BY submitted_at DESC`;
        return this.db
            .prepare(sql)
            .all(...params);
    }
}
//# sourceMappingURL=ordersRepo.js.map