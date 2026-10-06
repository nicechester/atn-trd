export class DecisionsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(decision) {
        const id = crypto.randomUUID();
        const createdAt = Date.now();
        this.db
            .prepare(`INSERT INTO decisions (id, run_id, symbol, action, target_weight, confidence, rationale, assessment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, decision.runId, decision.symbol, decision.action, decision.targetWeight, decision.confidence, decision.rationale, decision.assessmentId, createdAt);
        return id;
    }
    get(id) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE id = ?`)
            .get(id);
    }
    listByRun(runId) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE run_id = ? ORDER BY symbol`)
            .all(runId);
    }
    listByRunAndSymbol(runId, symbol) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE run_id = ? AND symbol = ? ORDER BY created_at`)
            .all(runId, symbol);
    }
    countByRun(runId) {
        const result = this.db
            .prepare('SELECT COUNT(*) as count FROM decisions WHERE run_id = ?')
            .get(runId);
        return result.count;
    }
    listBySymbol(symbol, limit) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`)
            .all(symbol, limit);
    }
}
//# sourceMappingURL=decisionsRepo.js.map