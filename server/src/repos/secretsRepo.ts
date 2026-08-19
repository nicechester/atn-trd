import type Database from "better-sqlite3";

export interface SecretRow {
  name: string;
  valueEnc: string;
  updatedAt: number;
}

export interface SecretMeta {
  name: string;
  updatedAt: number;
}

export class SecretsRepo {
  constructor(private readonly db: Database.Database) {}

  getEncrypted(name: string): SecretRow | undefined {
    return this.db
      .prepare("SELECT name, value_enc as valueEnc, updated_at as updatedAt FROM secrets WHERE name = ?")
      .get(name) as SecretRow | undefined;
  }

  upsert(name: string, valueEnc: string, updatedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO secrets (name, value_enc, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`
      )
      .run(name, valueEnc, updatedAt);
  }

  delete(name: string): void {
    this.db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
  }

  listMeta(): SecretMeta[] {
    return this.db
      .prepare("SELECT name, updated_at as updatedAt FROM secrets ORDER BY name")
      .all() as SecretMeta[];
  }
}
