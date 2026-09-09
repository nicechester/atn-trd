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

    // Sync all orders from Alpaca (including filled ones)
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const allOrders = await broker.listOrders({});

        // Update local database with Alpaca order statuses
        for (const order of allOrders) {
          const existing = ordersRepo.get(order.id);
          if (existing) {
            ordersRepo.updateStatus(order.id, order.status);
          } else {
            // Store new order from Alpaca
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
          }
        }
      } catch (err) {
        log.warn('failed to sync all orders from Alpaca', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Return only Alpaca orders
    const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '50', 10), 1), 200);
    const offset = Math.max(parseInt((req.query.offset as string) || '0', 10), 0);

    const allOrders = ordersRepo.list({ status: ['filled', 'partially_filled'] });
    const alpacaOrders = allOrders.filter(o => o.broker === 'alpaca');
    const paginatedOrders = alpacaOrders.slice(offset, offset + limit);

    res.json({ ok: true, data: paginatedOrders, total: alpacaOrders.length });
  } catch (err) {
    next(err);
  }
}

/** GET /api/trades/pending */
export async function listPendingOrdersHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const db = getDatabase();
    const ordersRepo = new OrdersRepo(db);

    // Sync pending orders from Alpaca
    const apiKey = process.env.ALPACA_API_KEY;
    const apiSecret = process.env.ALPACA_API_SECRET;
    if (apiKey && apiSecret) {
      try {
        const broker = new AlpacaBroker({ apiKey, apiSecret, paperTrading: true });
        const alpacaPending = await broker.listOrders({ status: ['pending', 'accepted'] });

        // Update local orders with Alpaca data
        for (const order of alpacaPending) {
          const existing = ordersRepo.get(order.id);
          if (existing) {
            ordersRepo.updateStatus(order.id, order.status);
          } else {
            // Store new order from Alpaca
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
          }
        }
      } catch (err) {
        log.warn('failed to sync pending orders from Alpaca', {
          error: err instanceof Error ? err.message : String(err),
        });
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
