import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { runPriceBackfillJob, getAllTrackedSymbols } from '../scheduler/jobs/priceBackfill.js';

/** POST /api/prices/backfill - Trigger price data backfill */
export async function triggerBackfillHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const db = getDatabase();
    const days = req.body.days ?? 120;
    const symbols = req.body.symbols; // optional, defaults to all tracked

    const result = await runPriceBackfillJob(db, { days, symbols });
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
}

/** GET /api/prices/symbols - List all tracked symbols (watchlist + static) */
export function listTrackedSymbolsHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const db = getDatabase();
    const symbols = getAllTrackedSymbols(db);
    res.json({ ok: true, symbols });
  } catch (err) {
    next(err);
  }
}
