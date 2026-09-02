import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabase } from '../db/index.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { SnapshotsRepo } from '../repos/snapshotsRepo.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { AuditLogRepo } from '../repos/auditLogRepo.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { PaperBroker } from '../brokers/paperBroker.js';
import { ValidationError } from '../lib/errors.js';
import { getSettings } from '../config/settingsService.js';
import { logger } from '../lib/logger.js';
import { isMarketHours, nextSessionOpen, nextSessionClose } from '../scheduler/marketCalendar.js';

const log = logger.child({ component: 'portfolio-routes' });

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

const InitSchema = z.object({
  seedCents: z.number().int().min(1),
});

/** POST /api/portfolio/init — initialize portfolio with seed money */
export function initPortfolioHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const parsed = InitSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid init request', parsed.error.issues);
    }

    const { seedCents } = parsed.data;
    const db = getDatabase();
    const portfolioRepo = new PortfolioRepo(db);
    const existing = portfolioRepo.read();

    if (existing) {
      throw new ValidationError('Portfolio already initialized');
    }

    const now = Date.now();
    portfolioRepo.write({
      cashCents: seedCents,
      startingCashCents: seedCents,
      startedAt: now,
      resetAt: null,
      baseCurrency: 'USD',
    });

    res.json({ ok: true, data: { cashCents: seedCents } });
  } catch (err) {
    next(err);
  }
}

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

const ResetSchema = z.object({
  confirm: z.literal(true),
  preserveHistory: z.boolean().default(false),
  newCashCents: z.number().int().positive().optional(),
});

/** POST /api/portfolio/reset — reset portfolio to initial state */
export function resetPortfolioHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const parsed = ResetSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid reset request', parsed.error.issues);
    }

    const { preserveHistory, newCashCents } = parsed.data;
    const db = getDatabase();
    const portfolioRepo = new PortfolioRepo(db);
    const positionsRepo = new PositionsRepo(db);
    const auditLogRepo = new AuditLogRepo(db);

    const portfolio = portfolioRepo.read();
    if (!portfolio) {
      throw new ValidationError('Portfolio not initialized');
    }

    const resetCashCents = newCashCents ?? portfolio.startingCashCents;
    const now = Date.now();
    const user = (req as any).user?.username || 'unknown';

    // Get current state for audit
    const positions = positionsRepo.list();

    db.transaction(() => {
      // Clear positions
      positionsRepo.clear();

      // Reset portfolio cash
      portfolioRepo.write({
        ...portfolio,
        cashCents: resetCashCents,
        startingCashCents: resetCashCents,
        resetAt: now,
      });

      // Clear history if requested
      if (!preserveHistory) {
        db.prepare('DELETE FROM orders').run();
        db.prepare('DELETE FROM fills').run();
        db.prepare('DELETE FROM portfolio_snapshots').run();
      }

      // Audit log
      auditLogRepo.create({
        action: 'portfolio_reset',
        actor: user,
        details: JSON.stringify({
          previousCashCents: portfolio.cashCents,
          newCashCents: resetCashCents,
          positionsCleared: positions.length,
          historyPreserved: preserveHistory,
        }),
      });
    })();

    log.info('portfolio reset', { user, newCashCents: resetCashCents, preserveHistory });

    res.json({
      ok: true,
      data: {
        cashCents: resetCashCents,
        positionsCleared: positions.length,
        historyPreserved: preserveHistory,
      },
    });
  } catch (err) {
    next(err);
  }
}

const ManualOrderSchema = z.object({
  symbol: z.string().min(1).max(10).toUpperCase(),
  side: z.enum(['buy', 'sell']),
  qty: z.number().positive(),
  type: z.enum(['market', 'limit']).default('market'),
  limitPriceCents: z.number().int().positive().optional(),
});

/** POST /api/portfolio/order — place manual order on paper trader */
export async function manualOrderHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = ManualOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid order request', parsed.error.issues);
    }

    const { symbol, side, qty, type, limitPriceCents } = parsed.data;

    // Check market hours
    if (!isMarketHours(new Date())) {
      throw new ValidationError('Market is closed. Orders can only be placed during market hours (9:30 AM - 4:00 PM ET, Mon-Fri).');
    }

    if (type === 'limit' && !limitPriceCents) {
      throw new ValidationError('Limit price required for limit orders');
    }

    const db = getDatabase();
    const pricesRepo = new PricesRepo(db);
    const priceService = new PriceService(pricesRepo);
    const ordersRepo = new OrdersRepo(db);
    const fillsRepo = new FillsRepo(db);
    const positionsRepo = new PositionsRepo(db);
    const portfolioRepo = new PortfolioRepo(db);
    const auditLogRepo = new AuditLogRepo(db);
    const settings = getSettings();
    const broker = new PaperBroker(
      db,
      priceService,
      ordersRepo,
      fillsRepo,
      positionsRepo,
      portfolioRepo,
      {
        fillModel: settings.paperAccount.fillModel,
        slippageBps: settings.paperAccount.slippageBps,
      }
    );

    const clientOrderId = `manual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const user = (req as any).user?.username || 'unknown';

    const orderState = await broker.submitOrder({
      clientOrderId,
      symbol,
      side,
      qty,
      type,
      limitPriceCents,
      tif: 'day',
    });

    // Audit log
    auditLogRepo.create({
      action: 'manual_order',
      actor: user,
      details: JSON.stringify({
        orderId: orderState.id,
        symbol,
        side,
        qty,
        type,
        limitPriceCents,
        status: orderState.status,
        rejectReason: orderState.rejectReason,
      }),
    });

    log.info('manual order placed', { user, orderId: orderState.id, symbol, side, qty, status: orderState.status });

    res.json({ ok: true, data: orderState });
  } catch (err) {
    next(err);
  }
}

/** GET /api/portfolio/market-status — check if market is open */
export function marketStatusHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    const now = new Date();
    res.json({
      isOpen: isMarketHours(now),
      nextOpen: nextSessionOpen(now).getTime(),
      nextClose: nextSessionClose(now).getTime(),
    });
  } catch (err) {
    next(err);
  }
}
