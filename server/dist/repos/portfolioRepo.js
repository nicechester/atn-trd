export class PortfolioRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    read() {
        return this.db
            .prepare(`SELECT cash_cents as cashCents, starting_cash_cents as startingCashCents,
                started_at as startedAt, reset_at as resetAt, base_currency as baseCurrency
         FROM portfolio WHERE id = 1`)
            .get();
    }
    write(row) {
        this.db
            .prepare(`INSERT INTO portfolio (id, cash_cents, starting_cash_cents, started_at, reset_at, base_currency)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           cash_cents = excluded.cash_cents,
           starting_cash_cents = excluded.starting_cash_cents,
           started_at = excluded.started_at,
           reset_at = excluded.reset_at,
           base_currency = excluded.base_currency`)
            .run(row.cashCents, row.startingCashCents, row.startedAt, row.resetAt, row.baseCurrency);
    }
}
//# sourceMappingURL=portfolioRepo.js.map