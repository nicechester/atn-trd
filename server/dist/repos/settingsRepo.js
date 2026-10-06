export class SettingsRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    read() {
        return this.db
            .prepare("SELECT doc, updated_at as updatedAt FROM app_settings WHERE id = 1")
            .get();
    }
    write(doc, updatedAt) {
        this.db
            .prepare(`INSERT INTO app_settings (id, doc, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`)
            .run(doc, updatedAt);
    }
}
//# sourceMappingURL=settingsRepo.js.map