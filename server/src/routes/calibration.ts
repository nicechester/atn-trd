import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { CalibrationRepo } from '../repos/calibrationRepo.js';

/** GET /api/calibration */
export function getCalibrationHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    const db = getDatabase();
    const calibrationRepo = new CalibrationRepo(db);
    const bands = calibrationRepo.getCalibrationReport();
    const totalPending = calibrationRepo.countPending();

    res.json({ ok: true, data: { bands, totalPending } });
  } catch (err) {
    next(err);
  }
}
