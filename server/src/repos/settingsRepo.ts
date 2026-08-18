import type Database from "better-sqlite3";

export interface SettingsRow {
  doc: string;
  updatedAt: number;
}

export class SettingsRepo {
  constructor(private readonly db: Database.Database) {}

  read(): SettingsRow | undefined {
    return this.db
      .prepare("SELECT doc, updated_at as updatedAt FROM app_settings WHERE id = 1")
      .get() as SettingsRow | undefined;
  }

  write(doc: string, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO app_settings (id, doc, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at`
      )
      .run(doc, updatedAt);
  }
}
