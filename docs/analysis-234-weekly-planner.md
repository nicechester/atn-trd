# Issue #234: Weekly Planner Order Frequency Analysis

## Executive Summary

**Root Cause Identified**: The weekly planner is NOT creating orders due to two main issues:

1. **No price data** - The `price_bars` table is empty (0 rows), causing many symbols to be skipped with "no price data"
2. **EWMA scores below buyThreshold** - Most symbols have EWMA scores between 0.55-0.69, below the 0.70 threshold

The system is behaving **correctly given the data** — it's the data pipeline that's broken.

---

## Data Analysis

### Current Settings
| Setting | Value |
|---------|-------|
| `signals.buyThreshold` | 0.70 |
| `signals.sellThreshold` | 0.25 |
| `execution.enabled` | true |
| `regime.enabled` | true |

### Signal Scores (Latest - 2026-10-02)

| Symbol | EWMA Score | Status | Gap to Buy |
|--------|------------|--------|------------|
| **TSM** | 0.762 | ✅ BUY_READY | +0.062 |
| **AMZN** | 0.723 | ✅ BUY_READY | +0.023 |
| AVGO | 0.686 | 🟡 CLOSE | -0.014 |
| NVDA | 0.658 | 🟡 CLOSE | -0.042 |
| AMD | 0.646 | 🟡 CLOSE | -0.054 |
| GOOGL | 0.637 | 🟡 CLOSE | -0.063 |
| JPM | 0.612 | 🟡 CLOSE | -0.088 |
| META | 0.595 | ⚪ NEUTRAL | -0.105 |
| MSFT | 0.569 | ⚪ NEUTRAL | -0.131 |
| WMT | 0.558 | ⚪ NEUTRAL | -0.142 |

**Key Finding**: TSM (0.762) and AMZN (0.723) are ABOVE the buy threshold but still not creating plans!

### Why TSM and AMZN Aren't Creating Plans

From the plan_review run on 2026-10-04:
```json
{"symbol":"AMZN","reason":"no price data"}
{"symbol":"TSM","reason":"no price data"}
```

**The `price_bars` table is EMPTY** — this is the critical bug.

### Plan Review History

| Date | Plans Created | Skip Reasons |
|------|---------------|--------------|
| 2026-10-04 | 0 | 12 symbols skipped (scores < 0.7 or no price data) |
| 2026-09-27 | 0 | 10 symbols skipped |
| 2026-09-20 | 0 | 9 symbols skipped |
| 2026-09-13 | 0 | 5 symbols skipped |

### Market Regime
- Current: **RISK_ON** (VIX: 16.39, Yield Curve: +0.46%)
- Consistent RISK_ON for past 7+ days
- Regime is NOT blocking plan creation

### Portfolio State
- Cash: $89,375.35
- Starting Cash: $50,000.00
- Positions: AVGO (9.7 shares), MSFT (7.5 shares), TSM (7.7 shares)

### Orders (Historical)
Only 3 orders ever placed (all on 2026-09-08):
- TSM: 7.672 shares (filled)
- AVGO: 9.739 shares (filled)
- MSFT: 7.484 shares (filled)

These were likely from the old trading cycle, not the strategic plan system.

---

## Root Causes

### 1. 🔴 CRITICAL: Empty `price_bars` Table
The price data pipeline is broken. The `price_bars` table has 0 rows.

**Impact**: Any symbol lookup for price fails, blocking plan creation even when signals are strong.

**Evidence**:
```
AMZN: score 0.723 (above 0.70) → skipped "no price data"
TSM: score 0.762 (above 0.70) → skipped "no price data"
```

**Root Cause**: The `runPriceBackfillJob` is:
1. **NOT scheduled** - It's not in the scheduler's job list
2. **Only available via manual API call** - `POST /api/prices/backfill`
3. **Never called on startup** - No automatic initialization

The price backfill job exists (`server/src/scheduler/jobs/priceBackfill.ts`) but is only exposed as an HTTP endpoint, not as a scheduled job.

### 2. 🟡 MODERATE: Conservative Buy Threshold
The default `buyThreshold: 0.70` is quite high. Only 2 of 10 symbols currently meet it.

**Score Distribution**:
- Above 0.70: 2 symbols (20%)
- 0.60-0.70: 5 symbols (50%)
- Below 0.60: 3 symbols (30%)

### 3. 🟢 LOW: Missing Signal Data for New Symbols
Recently added symbols (MA, UMC) have no signal data yet.

---

## Recommendations

### Immediate Fix (Implemented)
1. **✅ Added price backfill to scheduler** - Now runs daily at 3:55 PM ET (before 4 PM signal collection)
   - New cron: `55 15 * * 1-5`
   - Fetches last 7 days of price data to catch any gaps
   - Added to `jobSchedules` settings for configurability

### Manual Action Required
2. **Trigger initial backfill** - Run once to populate historical data:
   ```bash
   curl -X POST http://localhost:8080/api/prices/backfill -H "Content-Type: application/json" -d '{"days": 120}'
   ```
   Or via the deployed server.

### Configuration Tuning (Optional)
2. **Consider lowering buyThreshold** from 0.70 to 0.65
   - Would allow 7 of 10 symbols to qualify
   - Still maintains quality filter (above neutral 0.50)

3. **Add price data fallback** in `planReviewJob.ts`
   - Use `signal_snapshots.price_cents` as fallback when `price_bars` is empty

### Monitoring
4. **Add alerting** for empty price_bars table
5. **Add dashboard metric** for "symbols ready to buy but blocked"

---

## Code Investigation Needed

~~Check these files for the price data pipeline:~~
~~- `server/src/scheduler/jobs/` - Look for price fetching job~~
~~- `server/src/datasources/` - Price data source implementation~~
~~- `server/src/repos/pricesRepo.ts` - Price persistence~~

**Fixed**: Added `runPriceBackfillJob` to the scheduler.

The `planReviewJob.ts` line that was failing:
```typescript
const price = pricesRepo.getLatest(item.symbol);
if (!price) {
  summary.plansSkipped.push({ symbol: item.symbol, reason: 'no price data' });
  continue;
}
```

This will now work because price data will be populated daily before signal collection.

---

## Conclusion

The weekly planner is **working correctly** — it's properly checking thresholds and skipping symbols without price data. The issue is **upstream**: the price data pipeline is broken, resulting in an empty `price_bars` table.

**Priority**: Fix price data ingestion before tuning thresholds.
