import { randomUUID } from 'crypto';
export class RejectionsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(rejection, runId) {
        const id = randomUUID();
        const stmt = this.db.prepare(`
      INSERT INTO rejections (
        id, run_id, decision_id, symbol, action, confidence, target_weight, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(id, runId, rejection.decisionId ?? null, rejection.symbol, rejection.action, rejection.confidence, rejection.targetWeight ?? null, rejection.reason, Date.now());
        return id;
    }
    listByRun(runId) {
        const stmt = this.db.prepare('SELECT * FROM rejections WHERE run_id = ? ORDER BY created_at ASC');
        return stmt.all(runId);
    }
    deleteByRun(runId) {
        const stmt = this.db.prepare('DELETE FROM rejections WHERE run_id = ?');
        stmt.run(runId);
    }
}
//# sourceMappingURL=rejectionsRepo.js.map