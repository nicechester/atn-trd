import type Database from 'better-sqlite3';

export interface CalibrationRow {
  id: number;
  runId: string;
  symbol: string;
  predictedDirection: 'long' | 'short' | 'hold';
  confidence: number;
  actualReturn5d: number | null;
  actualReturn20d: number | null;
  correctDirection: number | null;
  createdAt: number;
}

export interface CalibrationBandResult {
  band: string;
  count: number;
  correctCount: number;
  avgReturn5d: number | null;
  avgReturn20d: number | null;
}

export class CalibrationRepo {
  constructor(private readonly db: Database.Database) {}

  create(row: Omit<CalibrationRow, 'id' | 'actualReturn5d' | 'actualReturn20d' | 'correctDirection' | 'createdAt'>): number {
    const result = this.db.prepare(`
      INSERT INTO confidence_calibration (run_id, symbol, predicted_direction, confidence, actual_return_5d, actual_return_20d, correct_direction, created_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)
    `).run(row.runId, row.symbol, row.predictedDirection, row.confidence, Date.now());
    return Number(result.lastInsertRowid);
  }

  updateActuals(id: number, actualReturn5d: number | null, actualReturn20d: number | null, correctDirection: number | null): void {
    this.db.prepare(`
      UPDATE confidence_calibration
      SET actual_return_5d = ?, actual_return_20d = ?, correct_direction = ?
      WHERE id = ?
    `).run(actualReturn5d, actualReturn20d, correctDirection, id);
  }

  listPendingActuals(): CalibrationRow[] {
    return this.db.prepare(`
      SELECT id, run_id as runId, symbol, predicted_direction as predictedDirection,
             confidence, actual_return_5d as actualReturn5d, actual_return_20d as actualReturn20d,
             correct_direction as correctDirection, created_at as createdAt
      FROM confidence_calibration
      WHERE actual_return_5d IS NULL
      ORDER BY created_at ASC
    `).all() as CalibrationRow[];
  }

  countPending(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM confidence_calibration WHERE actual_return_5d IS NULL`).get() as { count: number };
    return row.count;
  }

  getCalibrationReport(): CalibrationBandResult[] {
    return this.db.prepare(`
      SELECT
        CASE
          WHEN confidence >= 0.9 THEN '0.9-1.0'
          WHEN confidence >= 0.8 THEN '0.8-0.9'
          WHEN confidence >= 0.7 THEN '0.7-0.8'
          WHEN confidence >= 0.6 THEN '0.6-0.7'
          ELSE '0.5-0.6'
        END as band,
        COUNT(*) as count,
        SUM(CASE WHEN correct_direction = 1 THEN 1 ELSE 0 END) as correctCount,
        AVG(actual_return_5d) as avgReturn5d,
        AVG(actual_return_20d) as avgReturn20d
      FROM confidence_calibration
      WHERE actual_return_5d IS NOT NULL
      GROUP BY band
      ORDER BY band DESC
    `).all() as CalibrationBandResult[];
  }
}
