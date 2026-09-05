import type Database from 'better-sqlite3';

export interface SignalSnapshotRow {
  id: string;
  symbol: string;
  snapshotDate: string; // YYYY-MM-DD
  priceCents: number | null;
  sentimentScore: number | null;
  sentimentConfidence: number | null;
  sentimentTrend: number | null;
  priceVsSma50: number | null;
  compositeScore: number | null;
  compositeEwma: number | null;
  createdAt: number;
}

export class SignalSnapshotsRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(row: SignalSnapshotRow): void {
    this.db
      .prepare(
        `INSERT INTO signal_snapshots (id, symbol, snapshot_date, price_cents, sentiment_score, sentiment_confidence,
           sentiment_trend, price_vs_sma50, composite_score, composite_ewma, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(symbol, snapshot_date) DO UPDATE SET
           price_cents = excluded.price_cents,
           sentiment_score = excluded.sentiment_score,
           sentiment_confidence = excluded.sentiment_confidence,
           sentiment_trend = excluded.sentiment_trend,
           price_vs_sma50 = excluded.price_vs_sma50,
           composite_score = excluded.composite_score,
           composite_ewma = excluded.composite_ewma`
      )
      .run(
        row.id,
        row.symbol,
        row.snapshotDate,
        row.priceCents,
        row.sentimentScore,
        row.sentimentConfidence,
        row.sentimentTrend,
        row.priceVsSma50,
        row.compositeScore,
        row.compositeEwma,
        row.createdAt
      );
  }

  get(symbol: string, snapshotDate: string): SignalSnapshotRow | undefined {
    return this.db
      .prepare(
        `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           created_at as createdAt
         FROM signal_snapshots WHERE symbol = ? AND snapshot_date = ?`
      )
      .get(symbol, snapshotDate) as SignalSnapshotRow | undefined;
  }

  getLatest(symbol: string): SignalSnapshotRow | undefined {
    return this.db
      .prepare(
        `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           created_at as createdAt
         FROM signal_snapshots WHERE symbol = ? ORDER BY snapshot_date DESC LIMIT 1`
      )
      .get(symbol) as SignalSnapshotRow | undefined;
  }

  listBySymbol(symbol: string, limit: number = 30): SignalSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           created_at as createdAt
         FROM signal_snapshots WHERE symbol = ? ORDER BY snapshot_date DESC LIMIT ?`
      )
      .all(symbol, limit) as SignalSnapshotRow[];
  }

  listByDateRange(symbol: string, fromDate: string, toDate: string): SignalSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           created_at as createdAt
         FROM signal_snapshots WHERE symbol = ? AND snapshot_date >= ? AND snapshot_date <= ?
         ORDER BY snapshot_date ASC`
      )
      .all(symbol, fromDate, toDate) as SignalSnapshotRow[];
  }

  /** Get recent N snapshots to check consecutive days below threshold */
  getRecentSnapshots(symbol: string, days: number): SignalSnapshotRow[] {
    return this.db
      .prepare(
        `SELECT id, symbol, snapshot_date as snapshotDate, price_cents as priceCents,
           sentiment_score as sentimentScore, sentiment_confidence as sentimentConfidence,
           sentiment_trend as sentimentTrend, price_vs_sma50 as priceVsSma50,
           composite_score as compositeScore, composite_ewma as compositeEwma,
           created_at as createdAt
         FROM signal_snapshots
         WHERE symbol = ?
         ORDER BY snapshot_date DESC LIMIT ?`
      )
      .all(symbol, days) as SignalSnapshotRow[];
  }

  /** Get previous N days of sentiment scores for trend calculation */
  getRecentSentiment(symbol: string, days: number): Array<{ snapshotDate: string; sentimentScore: number }> {
    return this.db
      .prepare(
        `SELECT snapshot_date as snapshotDate, sentiment_score as sentimentScore
         FROM signal_snapshots
         WHERE symbol = ? AND sentiment_score IS NOT NULL
         ORDER BY snapshot_date DESC LIMIT ?`
      )
      .all(symbol, days) as Array<{ snapshotDate: string; sentimentScore: number }>;
  }
}
