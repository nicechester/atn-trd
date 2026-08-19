import type Database from 'better-sqlite3';

export interface FillRow {
  id: string;
  orderId: string;
  qty: number;
  priceCents: number;
  feeCents: number;
  filledAt: number;
  barDate: string; // YYYY-MM-DD
}

export class FillsRepo {
  constructor(private readonly db: Database.Database) {}

  create(fill: Omit<FillRow, 'id'>): string {
    const id = crypto.randomUUID();
    this.db
      .prepare(
        `INSERT INTO fills (id, order_id, qty, price_cents, fee_cents, filled_at, bar_date)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        fill.orderId,
        fill.qty,
        fill.priceCents,
        fill.feeCents,
        fill.filledAt,
        fill.barDate
      );
    return id;
  }

  get(id: string): FillRow | undefined {
    return this.db
      .prepare(
        `SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills WHERE id = ?`
      )
      .get(id) as FillRow | undefined;
  }

  listByOrder(orderId: string): FillRow[] {
    return this.db
      .prepare(
        `SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills WHERE order_id = ? ORDER BY filled_at`
      )
      .all(orderId) as FillRow[];
  }

  listByDate(barDate: string): FillRow[] {
    return this.db
      .prepare(
        `SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills WHERE bar_date = ? ORDER BY filled_at`
      )
      .all(barDate) as FillRow[];
  }

  listAll(limit: number = 50, offset: number = 0): FillRow[] {
    return this.db
      .prepare(
        `SELECT id, order_id as orderId, qty, price_cents as priceCents, fee_cents as feeCents, filled_at as filledAt, bar_date as barDate
         FROM fills ORDER BY filled_at DESC LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as FillRow[];
  }

  countByOrder(orderId: string): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as count FROM fills WHERE order_id = ?')
      .get(orderId) as { count: number };
    return result.count;
  }
}
