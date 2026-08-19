import type Database from 'better-sqlite3';

export interface PositionRow {
  symbol: string;
  qty: number;
  avgCostCents: number;
  realizedPnlCents: number;
  openedAt: number;
  updatedAt: number;
}

export class PositionsRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(position: PositionRow): void {
    this.db
      .prepare(
        `INSERT INTO positions (symbol, qty, avg_cost_cents, realized_pnl_cents, opened_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol) DO UPDATE SET qty = excluded.qty, avg_cost_cents = excluded.avg_cost_cents,
                                            realized_pnl_cents = excluded.realized_pnl_cents, updated_at = excluded.updated_at`
      )
      .run(position.symbol, position.qty, position.avgCostCents, position.realizedPnlCents, position.openedAt, position.updatedAt);
  }

  get(symbol: string): PositionRow | undefined {
    return this.db
      .prepare(
        `SELECT symbol, qty, avg_cost_cents as avgCostCents, realized_pnl_cents as realizedPnlCents, opened_at as openedAt, updated_at as updatedAt
         FROM positions WHERE symbol = ?`
      )
      .get(symbol) as PositionRow | undefined;
  }

  list(): PositionRow[] {
    return this.db
      .prepare(
        `SELECT symbol, qty, avg_cost_cents as avgCostCents, realized_pnl_cents as realizedPnlCents, opened_at as openedAt, updated_at as updatedAt
         FROM positions WHERE qty != 0 ORDER BY symbol`
      )
      .all() as PositionRow[];
  }

  listAll(): PositionRow[] {
    return this.db
      .prepare(
        `SELECT symbol, qty, avg_cost_cents as avgCostCents, realized_pnl_cents as realizedPnlCents, opened_at as openedAt, updated_at as updatedAt
         FROM positions ORDER BY symbol`
      )
      .all() as PositionRow[];
  }

  remove(symbol: string): void {
    this.db
      .prepare('DELETE FROM positions WHERE symbol = ?')
      .run(symbol);
  }

  clear(): void {
    this.db
      .prepare('DELETE FROM positions')
      .run();
  }

  getTotalQtyCost(): { totalQty: number; totalCostCents: number } {
    const result = this.db
      .prepare('SELECT SUM(qty) as totalQty, SUM(qty * avg_cost_cents / 100) as totalCostCents FROM positions WHERE qty > 0')
      .get() as { totalQty: number | null; totalCostCents: number | null };
    return {
      totalQty: result.totalQty || 0,
      totalCostCents: Math.round((result.totalCostCents || 0) * 100),
    };
  }
}
