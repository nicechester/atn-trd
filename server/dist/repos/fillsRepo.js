export class FillsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(fill) {
        const id = crypto.randomUUID();
        this.db
            .prepare(`INSERT INTO fills (id, order_id, qty, price_cents, fee_cents, filled_at, bar_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(id, fill.orderId, fill.qty, fill.priceCents, fill.feeCents, fill.filledAt, fill.barDate);
        return id;
    }
    get(id) {
        return this.db
            .prepare(`SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills WHERE id = ?`)
            .get(id);
    }
    listByOrder(orderId) {
        return this.db
            .prepare(`SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills WHERE order_id = ? ORDER BY filled_at`)
            .all(orderId);
    }
    listByDate(barDate) {
        return this.db
            .prepare(`SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills WHERE bar_date = ? ORDER BY filled_at`)
            .all(barDate);
    }
    listAll(limit = 50, offset = 0) {
        return this.db
            .prepare(`SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills ORDER BY filled_at DESC LIMIT ? OFFSET ?`)
            .all(limit, offset);
    }
    listAllWithOrder(limit = 50, offset = 0) {
        return this.db
            .prepare(`SELECT f.id, f.order_id as orderId, f.qty, f.price_cents as priceCents,
                f.fee_cents as feeCents, f.filled_at as filledAt, f.bar_date as barDate,
                o.symbol, o.side, o.mode
         FROM fills f
         JOIN orders o ON o.id = f.order_id
         ORDER BY f.filled_at DESC LIMIT ? OFFSET ?`)
            .all(limit, offset);
    }
    countByOrder(orderId) {
        const result = this.db
            .prepare('SELECT COUNT(*) as count FROM fills WHERE order_id = ?')
            .get(orderId);
        return result.count;
    }
}
//# sourceMappingURL=fillsRepo.js.map