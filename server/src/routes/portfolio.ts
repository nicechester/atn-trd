import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabase } from '../db/index.js';
import { PositionsRepo } from '../repos/positionsRepo.js';
import { PortfolioRepo } from '../repos/portfolioRepo.js';
import { PricesRepo } from '../repos/pricesRepo.js';
import { SnapshotsRepo } from '../repos/snapshotsRepo.js';
import { AuditLogRepo } from '../repos/auditLogRepo.js';
import { CashFlowsRepo } from '../repos/cashFlowsRepo.js';
import { PriceService } from '../services/priceService.js';
import { PortfolioServiceImpl } from '../services/portfolioService.js';
import { AlpacaBroker } from '../brokers/alpacaBroker.js';
import { ValidationError } from '../lib/errors.js';
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

    // Initialize Alpaca broker to sync account data
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });

        // Sync account data from Alpaca
        const alpacaAccount = await broker.getAccount();
        const alpacaPositions = await broker.getPositions();

        // Update local portfolio with Alpaca data
        const currentPortfolio = portfolioRepo.read();
        if (currentPortfolio) {
          portfolioRepo.write({
            ...currentPortfolio,
            cashCents: alpacaAccount.cashCents,
          });
        }

        // Sync positions: update existing, add new, close positions no longer in Alpaca
        const alpacaSymbols = new Set(alpacaPositions.map(p => p.symbol));
        const localPositions = positionsRepo.listAll();

        // Close positions that are no longer in Alpaca
        for (const localPos of localPositions) {
          if (!alpacaSymbols.has(localPos.symbol) && localPos.qty !== 0) {
            positionsRepo.upsert({
              ...localPos,
              qty: 0,
              updatedAt: Date.now(),
            });
          }
        }

        // Update positions from Alpaca
        for (const pos of alpacaPositions) {
          const existing = positionsRepo.get(pos.symbol);
          positionsRepo.upsert({
            symbol: pos.symbol,
            qty: pos.qty,
            avgCostCents: pos.avgCostCents,
            realizedPnlCents: existing?.realizedPnlCents ?? 0,
            openedAt: existing?.openedAt ?? Date.now(),
            updatedAt: Date.now(),
          });
        }
      } catch (err) {
        log.warn('failed to sync Alpaca account data', {
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue with local data if Alpaca sync fails
      }
    }

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
  type: z.enum(['deposit', 'withdrawal']),
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
    const cashFlowsRepo = new CashFlowsRepo(db);
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

    // Record the initial deposit
    cashFlowsRepo.insertFlow('deposit', seedCents, now, 'Initial seed deposit');

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
    const cashFlowsRepo = new CashFlowsRepo(db);
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

    // Record the cash flow
    const now = Date.now();
    cashFlowsRepo.insertFlow(type, amountCents, now);

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
    const cashFlowsRepo = new CashFlowsRepo(db);
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
        cashFlowsRepo.deleteAll();
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
    const auditLogRepo = new AuditLogRepo(db);

    // Initialize Alpaca paper trading broker
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new ValidationError('ALPACA_API_KEY and ALPACA_API_SECRET environment variables are required');
    }
    const broker = new AlpacaBroker({
      apiKey,
      apiSecret,
      paperTrading: true,
    });

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
