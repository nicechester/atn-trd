export class SnapshotsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    // Portfolio snapshots
    upsertPortfolioSnapshot(snapshot) {
        const id = crypto.randomUUID();
        const createdAt = Date.now();
        this.db
            .prepare(`INSERT INTO portfolio_snapshots (id, as_of_date, cash_cents, positions_value_cents, total_value_cents, unrealized_pnl_cents, weights_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(as_of_date) DO UPDATE SET
           cash_cents = excluded.cash_cents,
           positions_value_cents = excluded.positions_value_cents,
           total_value_cents = excluded.total_value_cents,
           unrealized_pnl_cents = excluded.unrealized_pnl_cents,
           weights_json = excluded.weights_json`)
            .run(id, snapshot.asOfDate, snapshot.cashCents, snapshot.positionsValueCents, snapshot.totalValueCents, snapshot.unrealizedPnlCents, snapshot.weightsJson, createdAt);
        return id;
    }
    getPortfolioSnapshot(asOfDate) {
        return this.db
            .prepare(`SELECT id, as_of_date as asOfDate, cash_cents as cashCents, positions_value_cents as positionsValueCents,
                total_value_cents as totalValueCents, unrealized_pnl_cents as unrealizedPnlCents, weights_json as weightsJson, created_at as createdAt
         FROM portfolio_snapshots WHERE as_of_date = ?`)
            .get(asOfDate);
    }
    listPortfolioSnapshots(limit = 252) {
        return this.db
            .prepare(`SELECT id, as_of_date as asOfDate, cash_cents as cashCents, positions_value_cents as positionsValueCents,
                total_value_cents as totalValueCents, unrealized_pnl_cents as unrealizedPnlCents, weights_json as weightsJson, created_at as createdAt
         FROM portfolio_snapshots ORDER BY as_of_date DESC LIMIT ?`)
            .all(limit);
    }
    listPortfolioSnapshotsByDateRange(fromDate, toDate) {
        return this.db
            .prepare(`SELECT id, as_of_date as asOfDate, cash_cents as cashCents, positions_value_cents as positionsValueCents,
                total_value_cents as totalValueCents, unrealized_pnl_cents as unrealizedPnlCents, weights_json as weightsJson, created_at as createdAt
         FROM portfolio_snapshots WHERE as_of_date >= ? AND as_of_date <= ? ORDER BY as_of_date ASC`)
            .all(fromDate, toDate);
    }
    // Benchmark snapshots
    upsertBenchmarkSnapshot(snapshot) {
        this.db
            .prepare(`INSERT INTO benchmark_snapshots (symbol, as_of_date, close_cents, adj_close_cents)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(symbol, as_of_date) DO UPDATE SET close_cents = excluded.close_cents, adj_close_cents = excluded.adj_close_cents`)
            .run(snapshot.symbol, snapshot.asOfDate, snapshot.closeCents, snapshot.adjCloseCents);
    }
    getBenchmarkSnapshot(symbol, asOfDate) {
        return this.db
            .prepare(`SELECT symbol, as_of_date as asOfDate, close_cents as closeCents, adj_close_cents as adjCloseCents
         FROM benchmark_snapshots WHERE symbol = ? AND as_of_date = ?`)
            .get(symbol, asOfDate);
    }
    listBenchmarkSnapshots(symbol, limit = 252) {
        return this.db
            .prepare(`SELECT symbol, as_of_date as asOfDate, close_cents as closeCents, adj_close_cents as adjCloseCents
         FROM benchmark_snapshots WHERE symbol = ? ORDER BY as_of_date DESC LIMIT ?`)
            .all(symbol, limit);
    }
    listBenchmarkSnapshotsByDateRange(symbol, fromDate, toDate) {
        return this.db
            .prepare(`SELECT symbol, as_of_date as asOfDate, close_cents as closeCents, adj_close_cents as adjCloseCents
         FROM benchmark_snapshots WHERE symbol = ? AND as_of_date >= ? AND as_of_date <= ? ORDER BY as_of_date ASC`)
            .all(symbol, fromDate, toDate);
    }
    deleteOldBenchmarkSnapshots(symbol, beforeDate) {
        const info = this.db
            .prepare('DELETE FROM benchmark_snapshots WHERE symbol = ? AND as_of_date < ?')
            .run(symbol, beforeDate);
        return info.changes;
    }
}
//# sourceMappingURL=snapshotsRepo.js.map