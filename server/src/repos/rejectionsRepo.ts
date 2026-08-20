import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Rejection } from '../services/riskService.js';

export interface RejectionRow {
  id: string;
  run_id: string;
  decision_id: string | null;
  symbol: string;
  action: string;
  confidence: number;
  target_weight: number | null;
  reason: string;
  created_at: number;
}

export class RejectionsRepo {
  constructor(private readonly db: Database.Database) {}

  create(rejection: Omit<Rejection, 'decisionId'> & { decisionId?: string }, runId: string): string {
    const id = randomUUID();
    const stmt = this.db.prepare(`
      INSERT INTO rejections (
        id, run_id, decision_id, symbol, action, confidence, target_weight, reason, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      runId,
      rejection.decisionId ?? null,
      rejection.symbol,
      rejection.action,
      rejection.confidence,
      rejection.targetWeight ?? null,
      rejection.reason,
      Date.now()
    );

    return id;
  }

  listByRun(runId: string): RejectionRow[] {
    const stmt = this.db.prepare('SELECT * FROM rejections WHERE run_id = ? ORDER BY created_at ASC');
    return stmt.all(runId) as RejectionRow[];
  }

  deleteByRun(runId: string): void {
    const stmt = this.db.prepare('DELETE FROM rejections WHERE run_id = ?');
    stmt.run(runId);
  }
}
