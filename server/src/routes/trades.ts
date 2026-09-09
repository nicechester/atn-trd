import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
import { AlpacaBroker } from '../brokers/alpacaBroker.js';
import { NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'trades-route' });

/** GET /api/trades?limit=50&offset=0 - Get filled orders/trades */
export async function listTradesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDatabase();
    const ordersRepo = new OrdersRepo(db);

    // Sync all orders from Alpaca to get latest filled status
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const allOrders = await broker.listOrders({});

        // Update local database with latest Alpaca order statuses
        const fillsRepo = new FillsRepo(db);
        for (const order of allOrders) {
          const existing = ordersRepo.getByClientOrderId(order.clientOrderId);
          if (existing) {
            // Update status if it has changed
            if (existing.status !== order.status) {
              ordersRepo.updateStatus(existing.id, order.status, order.id);
              // Create fill record if order just filled
              if (order.status === 'filled' && order.fillPriceCents) {
                try {
                  fillsRepo.create({
                    orderId: existing.id,
                    qty: order.qty,
                    priceCents: order.fillPriceCents,
                    feeCents: 0,
                    filledAt: order.updatedAt || Date.now(),
                    barDate: new Date(order.updatedAt || Date.now()).toISOString().split('T')[0],
                  });
                } catch (err) {
                  log.debug('fill record already exists or create failed', {
                    orderId: existing.id,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          } else {
            // Store new order from Alpaca
            try {
              ordersRepo.create({
                clientOrderId: order.clientOrderId,
                decisionId: null,
                runId: null,
                broker: 'alpaca',
                brokerOrderId: order.id,
                mode: 'paper',
                symbol: order.symbol,
                side: order.side,
                qty: order.qty,
                type: order.type,
                limitPriceCents: order.limitPriceCents,
                tif: order.tif,
                status: order.status,
                rejectReason: order.rejectReason,
                submittedAt: order.submittedAt,
              });
            } catch (createErr) {
              // Skip if order already exists (UNIQUE constraint)
              if (createErr instanceof Error && createErr.message.includes('UNIQUE constraint')) {
                log.debug('order already exists, skipping create', { clientOrderId: order.clientOrderId });
              } else {
                throw createErr;
              }
            }
          }
        }
      } catch (err) {
        log.warn('failed to sync orders from Alpaca', {
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue with local data if Alpaca sync fails
      }
    }

    // Return filled trades with fill details
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10), 1), 200);
    const offset = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);

    // Get all fills and join with order details
    const allFills = db
      .prepare(`
        SELECT
          fills.id, fills.order_id as orderId, fills.qty, fills.price_cents as priceCents,
          fills.fee_cents as feeCents, fills.filled_at as filledAt, fills.bar_date as barDate,
          orders.symbol, orders.side, orders.mode
        FROM fills
        JOIN orders ON fills.order_id = orders.id
        WHERE orders.broker = 'alpaca'
        ORDER BY fills.filled_at DESC
      `)
      .all() as Array<{
        id: string;
        orderId: string;
        qty: number;
        priceCents: number;
        feeCents: number | null;
        filledAt: number;
        barDate: string;
        symbol: string;
        side: string;
        mode: string;
      }>;

    const paginatedFills = allFills.slice(offset, offset + limit);

    res.json({ ok: true, data: paginatedFills, total: allFills.length });
  } catch (err) {
    next(err);
  }
}

/** GET /api/trades/pending */
export async function listPendingOrdersHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDatabase();
    const ordersRepo = new OrdersRepo(db);

    // Sync all orders from Alpaca to catch status transitions (e.g., accepted → filled)
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const allOrders = await broker.listOrders({});

        // Update local orders with latest statuses from Alpaca
        const fillsRepo = new FillsRepo(db);
        for (const order of allOrders) {
          const existing = ordersRepo.getByClientOrderId(order.clientOrderId);
          if (existing) {
            // Update status if it has changed
            if (existing.status !== order.status) {
              ordersRepo.updateStatus(existing.id, order.status, order.id);
              // Create fill record if order just filled
              if (order.status === 'filled' && order.fillPriceCents) {
                try {
                  fillsRepo.create({
                    orderId: existing.id,
                    qty: order.qty,
                    priceCents: order.fillPriceCents,
                    feeCents: 0,
                    filledAt: order.updatedAt || Date.now(),
                    barDate: new Date(order.updatedAt || Date.now()).toISOString().split('T')[0],
                  });
                } catch (err) {
                  log.debug('fill record already exists or create failed', {
                    orderId: existing.id,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          } else {
            // Store new order from Alpaca
            try {
              ordersRepo.create({
                clientOrderId: order.clientOrderId,
                decisionId: null,
                runId: null,
                broker: 'alpaca',
                brokerOrderId: order.id,
                mode: 'paper',
                symbol: order.symbol,
                side: order.side,
                qty: order.qty,
                type: order.type,
                limitPriceCents: order.limitPriceCents,
                tif: order.tif,
                status: order.status,
                rejectReason: order.rejectReason,
                submittedAt: order.submittedAt,
              });
            } catch (createErr) {
              // Skip if order already exists (UNIQUE constraint)
              if (createErr instanceof Error && createErr.message.includes('UNIQUE constraint')) {
                log.debug('order already exists, skipping create', { clientOrderId: order.clientOrderId });
              } else {
                throw createErr;
              }
            }
          }
        }
      } catch (err) {
        log.warn('failed to sync orders from Alpaca', {
          error: err instanceof Error ? err.message : String(err),
        });
        // Continue with local data if Alpaca sync fails
      }
    }

    const pending = ordersRepo.list({ status: ['pending', 'accepted'] });
    res.json({ ok: true, data: pending });
  } catch (err) {
    next(err);
  }
}

/** POST /api/trades/pending/:id/cancel */
export async function cancelPendingOrderHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const db = getDatabase();
    const ordersRepo = new OrdersRepo(db);
    const order = ordersRepo.get(id);

    if (!order) {
      throw new NotFoundError(`Order "${id}" not found`);
    }
    if (order.status !== 'pending' && order.status !== 'accepted') {
      res.status(400).json({ ok: false, error: 'Order is not pending' });
      return;
    }

    // Cancel via Alpaca if it's an Alpaca order
    if (order.broker === 'alpaca' && order.brokerOrderId) {
      const apiKey = process.env.ALPACA_API_KEY;
      const apiSecret = process.env.ALPACA_API_SECRET;
      if (apiKey && apiSecret) {
        try {
          const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
          await broker.cancelOrder(order.brokerOrderId);
        } catch (err) {
          log.warn('failed to cancel order on Alpaca', {
            orderId: id,
            brokerOrderId: order.brokerOrderId,
            error: err instanceof Error ? err.message : String(err),
          });
          throw new Error('Failed to cancel order on Alpaca');
        }
      }
    }

    ordersRepo.updateStatus(id, 'canceled');
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/** POST /api/trades/pending/cancel-bulk */
export function cancelPendingOrdersBulkHandler(req: Request, res: Response, next: NextFunction): void {
  try {
    const { ids } = req.body as { ids: string[] };
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ ok: false, error: 'ids array required' });
      return;
    }

    const db = getDatabase();
    const ordersRepo = new OrdersRepo(db);
    let canceled = 0;

    for (const id of ids) {
      const order = ordersRepo.get(id);
      if (order && (order.status === 'pending' || order.status === 'accepted')) {
        ordersRepo.updateStatus(id, 'canceled');
        canceled++;
      }
    }

    res.json({ ok: true, canceled });
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
