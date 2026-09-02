import type Database from 'better-sqlite3';

export type Regime = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';

export interface MarketRegimeRow {
  id: string;
  asOfDate: string;
  regime: Regime;
  vixLevel: number | null;
  yieldCurveSpread: number | null;
  breadthPct: number | null;
  riskScore: number;
  indicatorsJson: string | null;
  createdAt: number;
}

export class MarketRegimeRepo {
  constructor(private readonly db: Database.Database) {}

  upsert(row: MarketRegimeRow): void {
    this.db
      .prepare(
        `INSERT INTO market_regime (id, as_of_date, regime, vix_level, yield_curve_spread, breadth_pct, risk_score, indicators_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(as_of_date) DO UPDATE SET
           regime = excluded.regime,
           vix_level = excluded.vix_level,
           yield_curve_spread = excluded.yield_curve_spread,
           breadth_pct = excluded.breadth_pct,
           risk_score = excluded.risk_score,
           indicators_json = excluded.indicators_json`
      )
      .run(
        row.id,
        row.asOfDate,
        row.regime,
        row.vixLevel,
        row.yieldCurveSpread,
        row.breadthPct,
        row.riskScore,
        row.indicatorsJson,
        row.createdAt
      );
  }

  get(asOfDate: string): MarketRegimeRow | undefined {
    return this.db
      .prepare(
        `SELECT id, as_of_date as asOfDate, regime, vix_level as vixLevel,
           yield_curve_spread as yieldCurveSpread, breadth_pct as breadthPct,
           risk_score as riskScore, indicators_json as indicatorsJson, created_at as createdAt
         FROM market_regime WHERE as_of_date = ?`
      )
      .get(asOfDate) as MarketRegimeRow | undefined;
  }

  getLatest(): MarketRegimeRow | undefined {
    return this.db
      .prepare(
        `SELECT id, as_of_date as asOfDate, regime, vix_level as vixLevel,
           yield_curve_spread as yieldCurveSpread, breadth_pct as breadthPct,
           risk_score as riskScore, indicators_json as indicatorsJson, created_at as createdAt
         FROM market_regime ORDER BY as_of_date DESC LIMIT 1`
      )
      .get() as MarketRegimeRow | undefined;
  }

  /** Get recent regime history for confirmation logic */
  getRecentRegimes(days: number): MarketRegimeRow[] {
    return this.db
      .prepare(
        `SELECT id, as_of_date as asOfDate, regime, vix_level as vixLevel,
           yield_curve_spread as yieldCurveSpread, breadth_pct as breadthPct,
           risk_score as riskScore, indicators_json as indicatorsJson, created_at as createdAt
         FROM market_regime ORDER BY as_of_date DESC LIMIT ?`
      )
      .all(days) as MarketRegimeRow[];
  }

  /** Check if regime has been consistent for N days (for confirmation) */
  getRegimeStreak(regime: Regime): number {
    const rows = this.db
      .prepare(
        `SELECT regime FROM market_regime ORDER BY as_of_date DESC LIMIT 10`
      )
      .all() as Array<{ regime: Regime }>;

    let streak = 0;
    for (const row of rows) {
      if (row.regime === regime) streak++;
      else break;
    }
    return streak;
  }
}
