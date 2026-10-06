export class SecretsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    getEncrypted(name) {
        return this.db
            .prepare("SELECT name, value_enc as valueEnc, updated_at as updatedAt FROM secrets WHERE name = ?")
            .get(name);
    }
    upsert(name, valueEnc, updatedAt) {
        this.db
            .prepare(`INSERT INTO secrets (name, value_enc, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`)
            .run(name, valueEnc, updatedAt);
    }
    delete(name) {
        this.db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
    }
    listMeta() {
        return this.db
            .prepare("SELECT name, updated_at as updatedAt FROM secrets ORDER BY name")
            .all();
    }
}
//# sourceMappingURL=secretsRepo.js.map