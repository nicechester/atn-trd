export class PricesRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    upsert(bar) {
        this.db
            .prepare(`INSERT INTO price_bars (symbol, bar_date, open_cents, high_cents, low_cents, close_cents, adj_close_cents, volume, provider, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol, bar_date) DO UPDATE SET open_cents = excluded.open_cents, high_cents = excluded.high_cents,
                                                       low_cents = excluded.low_cents, close_cents = excluded.close_cents,
                                                       adj_close_cents = excluded.adj_close_cents, volume = excluded.volume,
                                                       provider = excluded.provider, fetched_at = excluded.fetched_at`)
            .run(bar.symbol, bar.barDate, bar.openCents, bar.highCents, bar.lowCents, bar.closeCents, bar.adjCloseCents, bar.volume, bar.provider, bar.fetchedAt);
    }
    get(symbol, barDate) {
        return this.db
            .prepare(`SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? AND bar_date = ?`)
            .get(symbol, barDate);
    }
    listBySymbol(symbol, limit = 252) {
        return this.db
            .prepare(`SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? ORDER BY bar_date DESC LIMIT ?`)
            .all(symbol, limit);
    }
    listByDateRange(symbol, fromDate, toDate) {
        return this.db
            .prepare(`SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? AND bar_date >= ? AND bar_date <= ? ORDER BY bar_date ASC`)
            .all(symbol, fromDate, toDate);
    }
    getLatest(symbol) {
        return this.db
            .prepare(`SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? ORDER BY bar_date DESC LIMIT 1`)
            .get(symbol);
    }
    deleteOlderThan(barDate) {
        const info = this.db
            .prepare('DELETE FROM price_bars WHERE bar_date < ?')
            .run(barDate);
        return info.changes;
    }
}
//# sourceMappingURL=pricesRepo.js.map