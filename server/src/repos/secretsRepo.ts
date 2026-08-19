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
    console.log(`[DB-REPO] SecretsRepo.getEncrypted('${name}') - Querying secrets`);
    const result = this.db
      .prepare("SELECT name, value_enc as valueEnc, updated_at as updatedAt FROM secrets WHERE name = ?")
      .get(name) as SecretRow | undefined;
    console.log(`[DB-REPO] SecretsRepo.getEncrypted('${name}') - Result:`, result ? `Found (encrypted length: ${result.valueEnc.length})` : 'NOT FOUND');
    return result;
  }

  upsert(name: string, valueEnc: string, updatedAt: number): void {
    console.log(`[DB-REPO] SecretsRepo.upsert('${name}') - Upserting secret, encrypted length: ${valueEnc.length}, updatedAt: ${updatedAt}`);
    try {
      const stmt = this.db
        .prepare(
          `INSERT INTO secrets (name, value_enc, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at`
        );
      const info = stmt.run(name, valueEnc, updatedAt);
      console.log(`[DB-REPO] SecretsRepo.upsert('${name}') - Success, changes: ${info.changes}`);
    } catch (err) {
      console.log(`[DB-REPO] SecretsRepo.upsert('${name}') - Error:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  delete(name: string): void {
    console.log(`[DB-REPO] SecretsRepo.delete('${name}') - Deleting secret`);
    try {
      const info = this.db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
      console.log(`[DB-REPO] SecretsRepo.delete('${name}') - Success, changes: ${info.changes}`);
    } catch (err) {
      console.log(`[DB-REPO] SecretsRepo.delete('${name}') - Error:`, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  listMeta(): SecretMeta[] {
    console.log(`[DB-REPO] SecretsRepo.listMeta() - Querying all secrets metadata`);
    const result = this.db
      .prepare("SELECT name, updated_at as updatedAt FROM secrets ORDER BY name")
      .all() as SecretMeta[];
    console.log(`[DB-REPO] SecretsRepo.listMeta() - Found ${result.length} secrets:`, result.map(m => m.name).join(', ') || 'NONE');
    return result;
  }
}
