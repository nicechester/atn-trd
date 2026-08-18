import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { WatchlistRepo } from '../repos/watchlistRepo.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { normalizeSymbol, validateSymbol } from '../services/symbolService.js';

function getRepo(): WatchlistRepo {
  return new WatchlistRepo(getDatabase());
}

function bodyOf(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
}

/** POST /api/symbols/validate — prove a ticker exists by fetching a live quote. */
export async function validateSymbolHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { symbol } = bodyOf(req);
    const data = await validateSymbol(symbol);
    res.json({ ok: true, data });
  } catch (err) {
    next(err);
  }
}

/** GET /api/watchlist */
export function listWatchlistHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    res.json({ ok: true, data: getRepo().list() });
  } catch (err) {
    next(err);
  }
}

/** POST /api/watchlist — validate then persist. */
export async function addWatchlistHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const body = bodyOf(req);
    const note = typeof body.note === 'string' && body.note.trim().length > 0 ? body.note.trim() : null;
    const validated = await validateSymbol(body.symbol);
    const row = getRepo().addSymbol(validated.symbol, note);
    res.status(201).json({
      ok: true,
      data: {
        ...row,
        name: validated.name,
        price: validated.price,
        currency: validated.currency,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** DELETE /api/watchlist/:symbol */
export function removeWatchlistHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    if (!getRepo().removeSymbol(symbol)) {
      throw new NotFoundError(`"${symbol}" is not on the watchlist`);
    }
    res.json({ ok: true, data: { symbol } });
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/watchlist/:symbol — body { enabled: boolean } */
export function patchWatchlistHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const symbol = normalizeSymbol(req.params.symbol);
    const { enabled } = bodyOf(req);
    if (typeof enabled !== 'boolean') {
      throw new ValidationError('Field "enabled" must be a boolean');
    }
    const repo = getRepo();
    const found = enabled ? repo.enableSymbol(symbol) : repo.disableSymbol(symbol);
    if (!found) {
      throw new NotFoundError(`"${symbol}" is not on the watchlist`);
    }
    res.json({ ok: true, data: repo.get(symbol) });
  } catch (err) {
    next(err);
  }
}
