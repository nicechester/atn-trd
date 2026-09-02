import type Database from 'better-sqlite3';

export interface AuditLogRow {
  id: string;
  action: 'portfolio_reset' | 'manual_order';
  actor: string;
  details: string | null;
  createdAt: number;
}

export class AuditLogRepo {
  constructor(private readonly db: Database.Database) {}

  create(entry: Omit<AuditLogRow, 'id' | 'createdAt'>): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO audit_log (id, action, actor, details, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, entry.action, entry.actor, entry.details, now);
    return id;
  }

  list(limit = 100): AuditLogRow[] {
    return this.db
      .prepare(
        `SELECT id, action, actor, details, created_at as createdAt
         FROM audit_log ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as AuditLogRow[];
  }
}
