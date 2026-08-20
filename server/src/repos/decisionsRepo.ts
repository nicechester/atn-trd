import type Database from 'better-sqlite3';

export interface DecisionRow {
  id: string;
  runId: string;
  symbol: string;
  action: 'buy' | 'sell' | 'hold' | 'trim' | 'add';
  targetWeight: number | null;
  confidence: number;
  rationale: string;
  assessmentId: string | null;
  createdAt: number;
}

export class DecisionsRepo {
  constructor(private readonly db: Database.Database) {}

  create(decision: Omit<DecisionRow, 'id' | 'createdAt'>): string {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO decisions (id, run_id, symbol, action, target_weight, confidence, rationale, assessment_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        decision.runId,
        decision.symbol,
        decision.action,
        decision.targetWeight,
        decision.confidence,
        decision.rationale,
        decision.assessmentId,
        createdAt
      );
    return id;
  }

  get(id: string): DecisionRow | undefined {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE id = ?`
      )
      .get(id) as DecisionRow | undefined;
  }

  listByRun(runId: string): DecisionRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE run_id = ? ORDER BY symbol`
      )
      .all(runId) as DecisionRow[];
  }

  listByRunAndSymbol(runId: string, symbol: string): DecisionRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE run_id = ? AND symbol = ? ORDER BY created_at`
      )
      .all(runId, symbol) as DecisionRow[];
  }

  countByRun(runId: string): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM decisions WHERE run_id = ?')
      .get(runId) as { count: number };
    return result.count;
  }

  listBySymbol(symbol: string, limit: number): DecisionRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, action, target_weight as targetWeight, confidence, rationale, assessment_id as assessmentId, created_at as createdAt
         FROM decisions WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`
      )
      .all(symbol, limit) as DecisionRow[];
  }
}
