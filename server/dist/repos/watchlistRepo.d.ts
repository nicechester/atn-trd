import type Database from "better-sqlite3";
export interface WatchlistRow {
    symbol: string;
    enabled: boolean;
    note: string | null;
    addedAt: number;
}
export declare class WatchlistRepo {
    private readonly db;
    constructor(db: Database.Database);
    list(): WatchlistRow[];
    get(symbol: string): WatchlistRow | undefined;
    upsert(row: WatchlistRow): void;
    remove(symbol: string): void;
    /**
     * Insert the symbol if absent, enabled by default. Existing rows keep their
     * `addedAt`, `enabled` and `note` so re-adding is a safe no-op.
     * Clears any removal tombstone for this symbol.
     */
    addSymbol(symbol: string, note?: string | null): WatchlistRow;
    /** Returns true when a row was actually deleted. Records a removal tombstone. */
    removeSymbol(symbol: string): boolean;
    /**
     * Add a symbol acquired via a position fill, unless it's already tracked or
     * the user explicitly removed it. Returns the row if added, null if skipped.
     */
    addSymbolIfNotRemoved(symbol: string, note?: string | null): WatchlistRow | null;
    /** Returns true when the symbol exists (and is now enabled). */
    enableSymbol(symbol: string): boolean;
    /** Returns true when the symbol exists (and is now disabled). */
    disableSymbol(symbol: string): boolean;
    private setEnabled;
}
//# sourceMappingURL=watchlistRepo.d.ts.map