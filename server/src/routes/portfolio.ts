import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabase } from '../db/index.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { SnapshotsRepo } from '../repos/snapshotsRepo.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { ValidationError } from '../lib/errors.js';

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

const TransferSchema = z.object({
  amountCents: z.number().int(),
  type: z.enum(['deposit', 'withdraw']),
});

/** POST /api/portfolio/transfer — deposit or withdraw cash */
export function transferFundsHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const parsed = TransferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid transfer request', parsed.error.issues);
    }

    const { amountCents, type } = parsed.data;
    if (amountCents <= 0) {
      throw new ValidationError('Amount must be positive');
    }

    const db = getDatabase();
    const portfolioRepo = new PortfolioRepo(db);
    const portfolio = portfolioRepo.read();

    if (!portfolio) {
      throw new ValidationError('Portfolio not initialized');
    }

    const newCashCents = type === 'deposit'
      ? portfolio.cashCents + amountCents
      : portfolio.cashCents - amountCents;

    if (newCashCents < 0) {
      throw new ValidationError('Insufficient funds for withdrawal');
    }

    portfolioRepo.write({
      ...portfolio,
      cashCents: newCashCents,
    });

    res.json({ ok: true, data: { cashCents: newCashCents } });
  } catch (err) {
    next(err);
  }
}
