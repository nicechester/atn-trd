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
   * Clears any removal tombstone for this symbol.
   */
  addSymbol(symbol: string, note: string | null = null): WatchlistRow {
    const normalized = normalize(symbol);
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO watchlist (symbol, enabled, note, added_at) VALUES (?, 1, ?, ?)
           ON CONFLICT(symbol) DO NOTHING`
        )
        .run(normalized, note, Date.now());
      // Clear any prior removal tombstone
      this.db.prepare("DELETE FROM watchlist_removals WHERE symbol = ?").run(normalized);
    })();
    // Guaranteed present: we just inserted it or it already existed.
    return this.get(normalized)!;
  }

  /** Returns true when a row was actually deleted. Records a removal tombstone. */
  removeSymbol(symbol: string): boolean {
    const normalized = normalize(symbol);
    let deleted = false;
    this.db.transaction(() => {
      const info = this.db
        .prepare("DELETE FROM watchlist WHERE symbol = ?")
        .run(normalized);
      deleted = info.changes > 0;
      // If deletion succeeded, record tombstone
      if (deleted) {
        this.db
          .prepare(
            `INSERT INTO watchlist_removals (symbol, removed_at) VALUES (?, ?)
             ON CONFLICT(symbol) DO UPDATE SET removed_at = excluded.removed_at`
          )
          .run(normalized, Date.now());
      }
    })();
    return deleted;
  }

  /**
   * Add a symbol acquired via a position fill, unless it's already tracked or
   * the user explicitly removed it. Returns the row if added, null if skipped.
   */
  addSymbolIfNotRemoved(symbol: string, note: string | null = null): WatchlistRow | null {
    const normalized = normalize(symbol);

    // Check if already in watchlist
    const existing = this.get(normalized);
    if (existing) {
      return existing;
    }

    // Check if user explicitly removed it
    const removedRow = this.db
      .prepare("SELECT symbol FROM watchlist_removals WHERE symbol = ?")
      .get(normalized);
    if (removedRow) {
      return null;
    }

    // Not in watchlist and not removed, so add it
    return this.addSymbol(normalized, note);
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
