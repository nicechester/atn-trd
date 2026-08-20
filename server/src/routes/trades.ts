import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { NotFoundError } from '../lib/errors.js';

/** GET /api/trades?limit=50&offset=0 */
export function listTradesHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10), 1), 200);
    const offset = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);

    const db = getDatabase();
    const fillsRepo = new FillsRepo(db);
    const fills = fillsRepo.listAllWithOrder(limit, offset);

    res.json({ ok: true, data: fills });
  } catch (err) {
    next(err);
  }
}

/** GET /api/trades/:id */
export function getTradeHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { id } = req.params;

    const db = getDatabase();
    const fillsRepo = new FillsRepo(db);
    const fill = fillsRepo.get(id);

    if (!fill) {
      throw new NotFoundError(`Trade "${id}" not found`);
    }

    res.json({ ok: true, data: fill });
  } catch (err) {
    next(err);
  }
}
