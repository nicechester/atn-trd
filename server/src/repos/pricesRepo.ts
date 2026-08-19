import type Database from 'better-sqlite3';

export interface PriceBarRow {
  symbol: string;
  barDate: string; // YYYY-MM-DD
  openCents: number;
  highCents: number;
  lowCents: number;
  closeCents: number;
  adjCloseCents: number;
  volume: number | null;
  provider: string;
  fetchedAt: number;
}

export class PricesRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(bar: PriceBarRow): void {
    this.db
      .prepare(
        `INSERT INTO price_bars (symbol, bar_date, open_cents, high_cents, low_cents, close_cents, adj_close_cents, volume, provider, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol, bar_date) DO UPDATE SET open_cents = excluded.open_cents, high_cents = excluded.high_cents,
                                                       low_cents = excluded.low_cents, close_cents = excluded.close_cents,
                                                       adj_close_cents = excluded.adj_close_cents, volume = excluded.volume,
                                                       provider = excluded.provider, fetched_at = excluded.fetched_at`
      )
      .run(
        bar.symbol,
        bar.barDate,
        bar.openCents,
        bar.highCents,
        bar.lowCents,
        bar.closeCents,
        bar.adjCloseCents,
        bar.volume,
        bar.provider,
        bar.fetchedAt
      );
  }

  get(symbol: string, barDate: string): PriceBarRow | undefined {
    return this.db
      .prepare(
        `SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? AND bar_date = ?`
      )
      .get(symbol, barDate) as PriceBarRow | undefined;
  }

  listBySymbol(symbol: string, limit: number = 252): PriceBarRow[] {
    return this.db
      .prepare(
        `SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? ORDER BY bar_date DESC LIMIT ?`
      )
      .all(symbol, limit) as PriceBarRow[];
  }

  listByDateRange(symbol: string, fromDate: string, toDate: string): PriceBarRow[] {
    return this.db
      .prepare(
        `SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? AND bar_date >= ? AND bar_date <= ? ORDER BY bar_date ASC`
      )
      .all(symbol, fromDate, toDate) as PriceBarRow[];
  }

  getLatest(symbol: string): PriceBarRow | undefined {
    return this.db
      .prepare(
        `SELECT symbol, bar_date as barDate, open_cents as openCents, high_cents as highCents, low_cents as lowCents,
                close_cents as closeCents, adj_close_cents as adjCloseCents, volume, provider, fetched_at as fetchedAt
         FROM price_bars WHERE symbol = ? ORDER BY bar_date DESC LIMIT 1`
      )
      .get(symbol) as PriceBarRow | undefined;
  }

  deleteOlderThan(barDate: string): number {
    const info = this.db
      .prepare('DELETE FROM price_bars WHERE bar_date < ?')
      .run(barDate);
    return info.changes;
  }
}
