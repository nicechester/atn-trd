export class AssessmentsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(assessment) {
        const id = crypto.randomUUID();
        const createdAt = Date.now();
        this.db
            .prepare(`INSERT INTO assessments (id, run_id, symbol, score, confidence, thesis, risks, catalysts, evidence_ids_json, sentiment_summary, finbert_score, finbert_label, finbert_confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, assessment.runId, assessment.symbol, assessment.score, assessment.confidence, assessment.thesis, assessment.risks, assessment.catalysts, assessment.evidenceIdsJson, assessment.sentimentSummary, assessment.finbertScore, assessment.finbertLabel, assessment.finbertConfidence, createdAt);
        return id;
    }
    get(id) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, score, confidence, thesis, risks, catalysts,
                evidence_ids_json as evidenceIdsJson, sentiment_summary as sentimentSummary,
                finbert_score as finbertScore, finbert_label as finbertLabel,
                finbert_confidence as finbertConfidence, created_at as createdAt
         FROM assessments WHERE id = ?`)
            .get(id);
    }
    listByRun(runId) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, score, confidence, thesis, risks, catalysts,
                evidence_ids_json as evidenceIdsJson, sentiment_summary as sentimentSummary,
                finbert_score as finbertScore, finbert_label as finbertLabel,
                finbert_confidence as finbertConfidence, created_at as createdAt
         FROM assessments WHERE run_id = ? ORDER BY symbol`)
            .all(runId);
    }
    getByRunAndSymbol(runId, symbol) {
        return this.db
            .prepare(`SELECT id, run_id as runId, symbol, score, confidence, thesis, risks, catalysts,
                evidence_ids_json as evidenceIdsJson, sentiment_summary as sentimentSummary,
                finbert_score as finbertScore, finbert_label as finbertLabel,
                finbert_confidence as finbertConfidence, created_at as createdAt
         FROM assessments WHERE run_id = ? AND symbol = ?`)
            .get(runId, symbol);
    }
}
//# sourceMappingURL=assessmentsRepo.js.map