export class ArtifactsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(artifact) {
        const id = crypto.randomUUID();
        this.db
            .prepare(`INSERT INTO research_artifacts (id, run_id, symbol, source, provider, fetched_at, payload_json, summary, citations_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, artifact.runId, artifact.symbol, artifact.source, artifact.provider, artifact.fetchedAt, artifact.payloadJson, artifact.summary, artifact.citationsJson);
        return id;
    }
    get(id) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, source, provider, fetched_at as fetchedAt,
                payload_json as payloadJson, summary, citations_json as citationsJson
         FROM research_artifacts WHERE id = ?`)
            .get(id);
    }
    listByRun(runId) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, source, provider, fetched_at as fetchedAt,
                payload_json as payloadJson, summary, citations_json as citationsJson
         FROM research_artifacts WHERE run_id = ? ORDER BY fetched_at`)
            .all(runId);
    }
    listByRunAndSymbol(runId, symbol) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, source, provider, fetched_at as fetchedAt,
                payload_json as payloadJson, summary, citations_json as citationsJson
         FROM research_artifacts WHERE run_id = ? AND symbol = ? ORDER BY fetched_at`)
            .all(runId, symbol);
    }
}
//# sourceMappingURL=artifactsRepo.js.map