import type Database from "better-sqlite3";

export interface SettingsRow {
  doc: string;
  updatedAt: number;
}

export class SettingsRepo {
  constructor(private readonly db: Database.Database) {}

  read(): SettingsRow | undefined {
    console.log(`[DB-REPO] SettingsRepo.read() - Querying app_settings`);
    const result = this.db
      .prepare("SELECT doc, updated_at as updatedAt FROM app_settings WHERE id = 1")
      .get() as SettingsRow | undefined;
    console.log(`[DB-REPO] SettingsRepo.read() - Result:`, result ? `Found (doc length: ${result.doc.length})` : 'NOT FOUND');
    return result;
  }

  write(doc: string, updatedAt: number): void {
    console.log(`[DB-REPO] SettingsRepo.write() - Writing to app_settings, doc length: ${doc.length}, updatedAt: ${updatedAt}`);
    try {
      const stmt = this.db
        .prepare(
          `INSERT INTO app_settings (id, doc, updated_at) VALUES (1, ?, ?)
           ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`
        );
      const info = stmt.run(doc, updatedAt);
      console.log(`[DB-REPO] SettingsRepo.write() - Success, changes: ${info.changes}`);
    } catch (err) {
      console.log(`[DB-REPO] SettingsRepo.write() - Error:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}
