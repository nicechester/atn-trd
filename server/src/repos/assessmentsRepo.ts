import type Database from 'better-sqlite3';

export interface AssessmentRow {
  id: string;
  runId: string;
  symbol: string;
  score: number;
  confidence: number;
  thesis: string;
  risks: string | null;
  catalysts: string | null;
  evidenceIdsJson: string | null; // JSON array
  createdAt: number;
}

export class AssessmentsRepo {
  constructor(private readonly db: Database.Database) {}

  create(assessment: Omit<AssessmentRow, 'id' | 'createdAt'>): string {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO assessments (id, run_id, symbol, score, confidence, thesis, risks, catalysts, evidence_ids_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        assessment.runId,
        assessment.symbol,
        assessment.score,
        assessment.confidence,
        assessment.thesis,
        assessment.risks,
        assessment.catalysts,
        assessment.evidenceIdsJson,
        createdAt
      );
    return id;
  }

  get(id: string): AssessmentRow | undefined {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, score, confidence, thesis, risks, catalysts,
                evidence_ids_json as evidenceIdsJson, created_at as createdAt
         FROM assessments WHERE id = ?`
      )
      .get(id) as AssessmentRow | undefined;
  }

  listByRun(runId: string): AssessmentRow[] {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, score, confidence, thesis, risks, catalysts,
                evidence_ids_json as evidenceIdsJson, created_at as createdAt
         FROM assessments WHERE run_id = ? ORDER BY symbol`
      )
      .all(runId) as AssessmentRow[];
  }

  getByRunAndSymbol(runId: string, symbol: string): AssessmentRow | undefined {
    return this.db
      .prepare(
        `SELECT id, run_id as runId, symbol, score, confidence, thesis, risks, catalysts,
                evidence_ids_json as evidenceIdsJson, created_at as createdAt
         FROM assessments WHERE run_id = ? AND symbol = ?`
      )
      .get(runId, symbol) as AssessmentRow | undefined;
  }
}
