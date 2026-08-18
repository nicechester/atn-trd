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

  /**
   * Insert the symbol if absent, enabled by default. Existing rows keep their
   * `addedAt`, `enabled` and `note` so re-adding is a safe no-op.
   */
  addSymbol(symbol: string, note: string | null = null): WatchlistRow {
    const normalized = normalize(symbol);
    this.db
      .prepare(
        `INSERT INTO watchlist (symbol, enabled, note, added_at) VALUES (?, 1, ?, ?)
         ON CONFLICT(symbol) DO NOTHING`
      )
      .run(normalized, note, Date.now());
    // Guaranteed present: we just inserted it or it already existed.
    return this.get(normalized)!;
  }

  /** Returns true when a row was actually deleted. */
  removeSymbol(symbol: string): boolean {
    const info = this.db
      .prepare("DELETE FROM watchlist WHERE symbol = ?")
      .run(normalize(symbol));
    return info.changes > 0;
  }

  /** Returns true when the symbol exists (and is now enabled). */
  enableSymbol(symbol: string): boolean {
    return this.setEnabled(symbol, true);
  }

  /** Returns true when the symbol exists (and is now disabled). */
  disableSymbol(symbol: string): boolean {
    return this.setEnabled(symbol, false);
  }

  private setEnabled(symbol: string, enabled: boolean): boolean {
    const info = this.db
      .prepare("UPDATE watchlist SET enabled = ? WHERE symbol = ?")
      .run(enabled ? 1 : 0, normalize(symbol));
    return info.changes > 0;
  }
}

function normalize(symbol: string): string {
  return symbol.trim().toUpperCase();
}
