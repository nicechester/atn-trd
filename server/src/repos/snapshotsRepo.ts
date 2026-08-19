import type Database from 'better-sqlite3';

export interface PortfolioSnapshotRow {
  id: string;
  asOfDate: string; // YYYY-MM-DD
  cashCents: number;
  positionsValueCents: number;
  totalValueCents: number;
  createdAt: number;
}

export interface BenchmarkSnapshotRow {
  symbol: string;
  asOfDate: string; // YYYY-MM-DD
  closeCents: number;
  adjCloseCents: number;
}

export class SnapshotsRepo {
  constructor(private readonly db: Database.Database) {}

  // Portfolio snapshots

  createPortfolioSnapshot(snapshot: Omit<PortfolioSnapshotRow, 'id' | 'createdAt'>): string {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        `INSERT INTO portfolio_snapshots (id, as_of_date, cash_cents, positions_value_cents, total_value_cents, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        snapshot.asOfDate,
        snapshot.cashCents,
        snapshot.positionsValueCents,
        snapshot.totalValueCents,
        createdAt
      );
    return id;
  }

  getPortfolioSnapshot(asOfDate: string): PortfolioSnapshotRow | undefined {
    return this.db
      .prepare(
        `SELECT id, as_of_date as asOfDate, cash_cents as cashCents, positions_value_cents as positionsValueCents,
                total_value_cents as totalValueCents, created_at as createdAt
         FROM portfolio_snapshots WHERE as_of_date = ?`
      )
      .get(asOfDate) as PortfolioSnapshotRow | undefined;
  }

  listPortfolioSnapshots(limit: number = 252): PortfolioSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT id, as_of_date as asOfDate, cash_cents as cashCents, positions_value_cents as positionsValueCents,
                total_value_cents as totalValueCents, created_at as createdAt
         FROM portfolio_snapshots ORDER BY as_of_date DESC LIMIT ?`
      )
      .all(limit) as PortfolioSnapshotRow[];
  }

  listPortfolioSnapshotsByDateRange(fromDate: string, toDate: string): PortfolioSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT id, as_of_date as asOfDate, cash_cents as cashCents, positions_value_cents as positionsValueCents,
                total_value_cents as totalValueCents, created_at as createdAt
         FROM portfolio_snapshots WHERE as_of_date >= ? AND as_of_date <= ? ORDER BY as_of_date ASC`
      )
      .all(fromDate, toDate) as PortfolioSnapshotRow[];
  }

  // Benchmark snapshots

  upsertBenchmarkSnapshot(snapshot: BenchmarkSnapshotRow): void {
    this.db
      .prepare(
        `INSERT INTO benchmark_snapshots (symbol, as_of_date, close_cents, adj_close_cents)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(symbol, as_of_date) DO UPDATE SET close_cents = excluded.close_cents, adj_close_cents = excluded.adj_close_cents`
      )
      .run(snapshot.symbol, snapshot.asOfDate, snapshot.closeCents, snapshot.adjCloseCents);
  }

  getBenchmarkSnapshot(symbol: string, asOfDate: string): BenchmarkSnapshotRow | undefined {
    return this.db
      .prepare(
        `SELECT symbol, as_of_date as asOfDate, close_cents as closeCents, adj_close_cents as adjCloseCents
         FROM benchmark_snapshots WHERE symbol = ? AND as_of_date = ?`
      )
      .get(symbol, asOfDate) as BenchmarkSnapshotRow | undefined;
  }

  listBenchmarkSnapshots(symbol: string, limit: number = 252): BenchmarkSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT symbol, as_of_date as asOfDate, close_cents as closeCents, adj_close_cents as adjCloseCents
         FROM benchmark_snapshots WHERE symbol = ? ORDER BY as_of_date DESC LIMIT ?`
      )
      .all(symbol, limit) as BenchmarkSnapshotRow[];
  }

  listBenchmarkSnapshotsByDateRange(symbol: string, fromDate: string, toDate: string): BenchmarkSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT symbol, as_of_date as asOfDate, close_cents as closeCents, adj_close_cents as adjCloseCents
         FROM benchmark_snapshots WHERE symbol = ? AND as_of_date >= ? AND as_of_date <= ? ORDER BY as_of_date ASC`
      )
      .all(symbol, fromDate, toDate) as BenchmarkSnapshotRow[];
  }

  deleteOldBenchmarkSnapshots(symbol: string, beforeDate: string): number {
    const info = this.db
      .prepare('DELETE FROM benchmark_snapshots WHERE symbol = ? AND as_of_date < ?')
      .run(symbol, beforeDate);
    return info.changes;
  }
}
