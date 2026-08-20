import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { SnapshotsRepo } from '../repos/snapshotsRepo.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';

/** GET /api/portfolio */
export async function getPortfolioHandler(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const db = getDatabase();
    const pricesRepo = new PricesRepo(db);
    const priceService = new PriceService(pricesRepo);
    const positionsRepo = new PositionsRepo(db);
    const portfolioRepo = new PortfolioRepo(db);
    const portfolioService = new PortfolioServiceImpl(db, priceService, positionsRepo, portfolioRepo);

    const portfolio = await portfolioService.getPortfolio();

    res.json({ ok: true, data: portfolio });
  } catch (err) {
    next(err);
  }
}

/** GET /api/portfolio/history?limit=30 */
export function getPortfolioHistoryHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '30', 10), 1), 1000);

    const db = getDatabase();
    const snapshotsRepo = new SnapshotsRepo(db);
    const snapshots = snapshotsRepo.listPortfolioSnapshots(limit);

    res.json({ ok: true, data: snapshots });
  } catch (err) {
    next(err);
  }
}
