import type Database from 'better-sqlite3';

export interface OrderRow {
  id: string;
  clientOrderId: string;
  decisionId: string | null;
  runId: string | null;
  broker: string;
  brokerOrderId: string | null;
  mode: 'paper' | 'live';
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit';
  limitPriceCents: number | null;
  tif: 'day' | 'gtc';
  status: 'pending' | 'accepted' | 'partially_filled' | 'filled' | 'canceled' | 'rejected' | 'expired';
  rejectReason: string | null;
  submittedAt: number;
  updatedAt: number;
}

export class OrdersRepo {
  constructor(private readonly db: Database.Database) {}

  create(order: Omit<OrderRow, 'id' | 'updatedAt'>): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO orders (id, client_order_id, decision_id, run_id, broker, broker_order_id, mode, symbol, side, qty, type, limit_price_cents, tif, status, reject_reason, submitted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        order.clientOrderId,
        order.decisionId,
        order.runId,
        order.broker,
        order.brokerOrderId,
        order.mode,
        order.symbol,
        order.side,
        order.qty,
        order.type,
        order.limitPriceCents,
        order.tif,
        order.status,
        order.rejectReason,
        order.submittedAt,
        order.submittedAt
      );
    return id;
  }

  get(id: string): OrderRow | undefined {
    return this.db
      .prepare(
        `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE id = ?`
      )
      .get(id) as OrderRow | undefined;
  }

  getByClientOrderId(clientOrderId: string): OrderRow | undefined {
    return this.db
      .prepare(
        `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE client_order_id = ?`
      )
      .get(clientOrderId) as OrderRow | undefined;
  }

  listByRun(runId: string): OrderRow[] {
    return this.db
      .prepare(
        `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE run_id = ? ORDER BY submitted_at`
      )
      .all(runId) as OrderRow[];
  }

  updateStatus(
    id: string,
    status: OrderRow['status'],
    brokerOrderId?: string,
    rejectReason?: string
  ): void {
    this.db
      .prepare(
        `UPDATE orders SET status = ?, broker_order_id = ?, reject_reason = ?, updated_at = ? WHERE id = ?`
      )
      .run(status, brokerOrderId || null, rejectReason || null, Date.now(), id);
  }

  listPending(symbol?: string): OrderRow[] {
    if (symbol) {
      return this.db
        .prepare(
          `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                  broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                  limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                  submitted_at as submittedAt, updated_at as updatedAt
           FROM orders WHERE status IN ('pending', 'accepted', 'partially_filled') AND symbol = ? ORDER BY submitted_at`
        )
        .all(symbol) as OrderRow[];
    }
    return this.db
      .prepare(
        `SELECT id, client_order_id as clientOrderId, decision_id as decisionId, run_id as runId,
                broker, broker_order_id as brokerOrderId, mode, symbol, side, qty, type,
                limit_price_cents as limitPriceCents, tif, status, reject_reason as rejectReason,
                submitted_at as submittedAt, updated_at as updatedAt
         FROM orders WHERE status IN ('pending', 'accepted', 'partially_filled') ORDER BY submitted_at`
      )
      .all() as OrderRow[];
  }
}
