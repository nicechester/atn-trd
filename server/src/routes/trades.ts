import { Request, Response, NextFunction } from 'express';
import { getDatabase } from '../db/index.js';
import { FillsRepo } from '../repos/fillsRepo.js';
import { OrdersRepo } from '../repos/ordersRepo.js';
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

/** GET /api/trades/pending */
export function listPendingOrdersHandler(_req: Request, res: Response, next: NextFunction): void {
  try {
    const db = getDatabase();
    const ordersRepo = new OrdersRepo(db);
    const pending = ordersRepo.list({ status: ['pending', 'accepted'] });
    res.json({ ok: true, data: pending });
  } catch (err) {
    next(err);
  }
}

/** POST /api/trades/pending/:id/cancel */
export function cancelPendingOrderHandler(req: Request, res: Response, next: NextFunction): void {
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
