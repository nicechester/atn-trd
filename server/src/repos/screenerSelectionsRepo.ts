import type Database from 'better-sqlite3';

export interface ScreenerSelectionRow {
  id: string;
  runId: string;
  symbol: string;
  rationale: string;
  conviction: number;
  selectedJson: string | null;
  rejectedJson: string | null;
  createdAt: number;
}

export class ScreenerSelectionsRepo {
  constructor(private readonly db: Database.Database) {}

  create(selection: Omit<ScreenerSelectionRow, 'id' | 'createdAt'>): string {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO screener_selections (id, run_id, symbol, rationale, conviction, selected_json, rejected_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        selection.runId,
        selection.symbol,
        selection.rationale,
        selection.conviction,
        selection.selectedJson,
        selection.rejectedJson,
        createdAt
      );
    return id;
  }

  get(id: string): ScreenerSelectionRow | undefined {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, rationale, conviction, selected_json as selectedJson,
                rejected_json as rejectedJson, created_at as createdAt
         FROM screener_selections WHERE id = ?`
      )
      .get(id) as ScreenerSelectionRow | undefined;
  }

  listByRun(runId: string): ScreenerSelectionRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, rationale, conviction, selected_json as selectedJson,
                rejected_json as rejectedJson, created_at as createdAt
         FROM screener_selections WHERE run_id = ? ORDER BY symbol`
      )
      .all(runId) as ScreenerSelectionRow[];
  }

  getByRunAndSymbol(runId: string, symbol: string): ScreenerSelectionRow | undefined {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, rationale, conviction, selected_json as selectedJson,
                rejected_json as rejectedJson, created_at as createdAt
         FROM screener_selections WHERE run_id = ? AND symbol = ?`
      )
      .get(runId, symbol) as ScreenerSelectionRow | undefined;
  }
}
