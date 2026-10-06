/**
 * Repository for managing cash flows (deposits and withdrawals).
 * Immutable: flows are never updated, only inserted or deleted.
 */
export class CashFlowsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    /**
     * Insert a new cash flow record.
     * @param type - 'deposit' or 'withdrawal'
     * @param amountCents - Amount in cents (always positive)
     * @param occurredAt - Timestamp in milliseconds when the flow occurred
     * @param note - Optional description
     * @returns Flow id
     */
    insertFlow(type, amountCents, occurredAt, note) {
        const id = crypto.randomUUID();
        const createdAt = Date.now();
        this.db
            .prepare(`INSERT INTO cash_flows (id, type, amount_cents, occurred_at, created_at, note)
         VALUES (?, ?, ?, ?, ?, ?)`)
            .run(id, type, amountCents, occurredAt, createdAt, note || null);
        return id;
    }
    /**
     * Sum cash flows by type, optionally filtered by date.
     * @param type - 'deposit' or 'withdrawal'
     * @param asOfDate - Optional YYYY-MM-DD string to filter by date
     * @returns Sum in cents
     */
    sumByType(type, asOfDate) {
        let query = 'SELECT COALESCE(SUM(amount_cents), 0) as total FROM cash_flows WHERE type = ?';
        const params = [type];
        if (asOfDate) {
            // Convert YYYY-MM-DD to milliseconds (start of day in UTC)
            const [year, month, day] = asOfDate.split('-').map(Number);
            const startOfDay = new Date(Date.UTC(year, month - 1, day)).getTime();
            const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
            query += ' AND occurred_at >= ? AND occurred_at < ?';
            params.push(startOfDay, endOfDay);
        }
        const result = this.db.prepare(query).get(...params);
        return result.total;
    }
    /**
     * List cash flows ordered by date (most recent first).
     * @param limit - Maximum number of flows to return
     * @returns Array of cash flows
     */
    listFlows(limit = 100) {
        return this.db
            .prepare(`SELECT id, type, amount_cents as amountCents, occurred_at as occurredAt,
                created_at as createdAt, note
         FROM cash_flows ORDER BY occurred_at DESC LIMIT ?`)
            .all(limit);
    }
    /**
     * Delete all cash flows (used when resetting portfolio).
     */
    deleteAll() {
        this.db.prepare('DELETE FROM cash_flows').run();
    }
}
//# sourceMappingURL=cashFlowsRepo.js.map