import type Database from "better-sqlite3";

export interface WatchlistRow {
  symbol: string;
  enabled: boolean;
  note: string | null;
  addedAt: number;
}

export class WatchlistRepo {
  constructor(private readonly db: Database.Database) {}

  list(): WatchlistRow[] {
    const rows = this.db
      .prepare("SELECT symbol, enabled, note, added_at as addedAt FROM watchlist ORDER BY symbol")
      .all() as Array<{ symbol: string; enabled: number; note: string | null; addedAt: number }>;
    return rows.map((r) => ({ ...r, enabled: !!r.enabled }));
  }

  get(symbol: string): WatchlistRow | undefined {
    const row = this.db
      .prepare("SELECT symbol, enabled, note, added_at as addedAt FROM watchlist WHERE symbol = ?")
      .get(symbol) as { symbol: string; enabled: number; note: string | null; addedAt: number } | undefined;
    return row ? { ...row, enabled: !!row.enabled } : undefined;
  }

  upsert(row: WatchlistRow): void {
    this.db
      .prepare(
        `INSERT INTO watchlist (symbol, enabled, note, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET enabled = excluded.enabled, note = excluded.note`
      )
      .run(row.symbol, row.enabled ? 1 : 0, row.note, row.addedAt);
  }

  remove(symbol: string): void {
    this.db.prepare("DELETE FROM watchlist WHERE symbol = ?").run(symbol);
  }
}
