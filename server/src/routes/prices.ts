import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { runPriceBackfillJob, getAllTrackedSymbols } from '../scheduler/jobs/priceBackfill.js';
import { PricesRepo } from '../repos/pricesRepo.js';

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

/** GET /api/prices/bars?symbols=AAPL,MSFT&days=5 - Get recent bars for symbols */
export function getBarsHandler(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const db = getDatabase();
    const pricesRepo = new PricesRepo(db);
    const symbolsParam = req.query.symbols as string | undefined;
    const days = Math.min(Number(req.query.days) || 5, 30);

    if (!symbolsParam) {
      res.status(400).json({ ok: false, error: 'symbols required' });
      return;
    }

    const symbols = symbolsParam.split(',').map(s => s.trim().toUpperCase());
    const bars: Record<string, number[]> = {};

    for (const symbol of symbols) {
      const rows = pricesRepo.listBySymbol(symbol, days);
      // Return close prices in chronological order (oldest first)
      bars[symbol] = rows.reverse().map(r => r.closeCents / 100);
    }

    res.json({ ok: true, bars });
  } catch (err) {
    next(err);
  }
}
