export class ScreenerSelectionsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(selection) {
        const id = crypto.randomUUID();
        const createdAt = Date.now();
        this.db
            .prepare(`INSERT INTO screener_selections (id, run_id, symbol, rationale, conviction, selected_json, rejected_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, selection.runId, selection.symbol, selection.rationale, selection.conviction, selection.selectedJson, selection.rejectedJson, createdAt);
        return id;
    }
    get(id) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, rationale, conviction, selected_json as selectedJson,
                rejected_json as rejectedJson, created_at as createdAt
         FROM screener_selections WHERE id = ?`)
            .get(id);
    }
    listByRun(runId) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, rationale, conviction, selected_json as selectedJson,
                rejected_json as rejectedJson, created_at as createdAt
         FROM screener_selections WHERE run_id = ? ORDER BY symbol`)
            .all(runId);
    }
    getByRunAndSymbol(runId, symbol) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, rationale, conviction, selected_json as selectedJson,
                rejected_json as rejectedJson, created_at as createdAt
         FROM screener_selections WHERE run_id = ? AND symbol = ?`)
            .get(runId, symbol);
    }
}
//# sourceMappingURL=screenerSelectionsRepo.js.map