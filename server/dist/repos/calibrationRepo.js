export class CalibrationRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    create(row) {
        const result = this.db.prepare(`
      INSERT INTO confidence_calibration (run_id, symbol, predicted_direction, confidence, actual_return_5d, actual_return_20d, correct_direction, created_at)
      VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)
    `).run(row.runId, row.symbol, row.predictedDirection, row.confidence, Date.now());
        return Number(result.lastInsertRowid);
    }
    updateActuals(id, actualReturn5d, actualReturn20d, correctDirection) {
        this.db.prepare(`
      UPDATE confidence_calibration
      SET actual_return_5d = ?, actual_return_20d = ?, correct_direction = ?
      WHERE id = ?
    `).run(actualReturn5d, actualReturn20d, correctDirection, id);
    }
    listPendingActuals() {
        return this.db.prepare(`
      SELECT id, run_id as runId, symbol, predicted_direction as predictedDirection,
             confidence, actual_return_5d as actualReturn5d, actual_return_20d as actualReturn20d,
             correct_direction as correctDirection, created_at as createdAt
      FROM confidence_calibration
      WHERE actual_return_5d IS NULL
      ORDER BY created_at ASC
    `).all();
    }
    countPending() {
        const row = this.db.prepare(`SELECT COUNT(*) as count FROM confidence_calibration WHERE actual_return_5d IS NULL`).get();
        return row.count;
    }
    getCalibrationReport() {
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
    `).all();
    }
}
//# sourceMappingURL=calibrationRepo.js.map