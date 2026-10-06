export class AuditLogRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(entry) {
        const id = crypto.randomUUID();
        const now = Date.now();
        this.db
            .prepare(`INSERT INTO audit_log (id, action, actor, details, created_at)
         VALUES (?, ?, ?, ?, ?)`)
            .run(id, entry.action, entry.actor, entry.details, now);
        return id;
    }
    list(limit = 100) {
        return this.db
            .prepare(`SELECT id, action, actor, details, created_at as createdAt
         FROM audit_log ORDER BY created_at DESC LIMIT ?`)
            .all(limit);
    }
}
//# sourceMappingURL=auditLogRepo.js.map