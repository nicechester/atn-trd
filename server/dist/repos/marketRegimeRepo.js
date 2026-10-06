export class MarketRegimeRepo {
    db;
    constructor(db) {
        this.db = db;
    }
    upsert(row) {
        this.db
            .prepare(`INSERT INTO market_regime (id, as_of_date, regime, vix_level, yield_curve_spread, breadth_pct, risk_score, indicators_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(as_of_date) DO UPDATE SET
           regime = excluded.regime,
           vix_level = excluded.vix_level,
           yield_curve_spread = excluded.yield_curve_spread,
           breadth_pct = excluded.breadth_pct,
           risk_score = excluded.risk_score,
           indicators_json = excluded.indicators_json`)
            .run(row.id, row.asOfDate, row.regime, row.vixLevel, row.yieldCurveSpread, row.breadthPct, row.riskScore, row.indicatorsJson, row.createdAt);
    }
    get(asOfDate) {
        return this.db
            .prepare(`SELECT id, as_of_date as asOfDate, regime, vix_level as vixLevel,
           yield_curve_spread as yieldCurveSpread, breadth_pct as breadthPct,
           risk_score as riskScore, indicators_json as indicatorsJson, created_at as createdAt
         FROM market_regime WHERE as_of_date = ?`)
            .get(asOfDate);
    }
    getLatest() {
        return this.db
            .prepare(`SELECT id, as_of_date as asOfDate, regime, vix_level as vixLevel,
           yield_curve_spread as yieldCurveSpread, breadth_pct as breadthPct,
           risk_score as riskScore, indicators_json as indicatorsJson, created_at as createdAt
         FROM market_regime ORDER BY as_of_date DESC LIMIT 1`)
            .get();
    }
    /** Get recent regime history for confirmation logic */
    getRecentRegimes(days) {
        return this.db
            .prepare(`SELECT id, as_of_date as asOfDate, regime, vix_level as vixLevel,
           yield_curve_spread as yieldCurveSpread, breadth_pct as breadthPct,
           risk_score as riskScore, indicators_json as indicatorsJson, created_at as createdAt
         FROM market_regime ORDER BY as_of_date DESC LIMIT ?`)
            .all(days);
    }
    /** Check if regime has been consistent for N days (for confirmation) */
    getRegimeStreak(regime) {
        const rows = this.db
            .prepare(`SELECT regime FROM market_regime ORDER BY as_of_date DESC LIMIT 10`)
            .all();
        let streak = 0;
        for (const row of rows) {
            if (row.regime === regime)
                streak++;
            else
                break;
        }
        return streak;
    }
}
//# sourceMappingURL=marketRegimeRepo.js.map