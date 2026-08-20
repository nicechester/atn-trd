# 07 — Future Improvements

[← back to index](README.md)

This document outlines architectural improvements to consider for future phases, prioritized by impact and implementation complexity.

## 1. Embedding Store for Historical Context

**Problem:** `get_prior_decisions` fetches only recent rows by recency, not relevance. The agent cannot ask "What happened last time this symbol had similar conditions?"

**Solution:** Add a vector store for semantic search over past assessments and research artifacts.

**Implementation options:**
- `sqlite-vss` extension — keeps single-file SQLite simplicity
- ChromaDB embedded — more features, still no external service
- pgvector — if migrating to Postgres later

**What to embed:**
- `SymbolAssessment.rationale` text
- `research_artifacts.payload_json` summaries
- Macro regime descriptions (yield curve state, VIX level, Fed stance)

**New tool for Analyst agent:**
```ts
get_similar_situations({ symbol, description, limit }): Promise<{
  runId: string;
  symbol: string;
  assessment: SymbolAssessment;
  similarity: number;
}[]>
```

**Complexity:** Medium — requires embedding model calls on write path, index maintenance.

---

## 2. Multi-Agent Debate

**Problem:** Single analyst per symbol has no adversarial check. Confirmation bias and hallucination go unchallenged.

**Solution:** Run multiple agents with different perspectives, synthesize in PM stage.

**Option A — Bull vs Bear:**
```
┌─────────────┐     ┌─────────────┐
│ Bull Analyst│     │ Bear Analyst│
│ (find upside)│     │ (find risks)│
└──────┬──────┘     └──────┬──────┘
       │                   │
       └───────┬───────────┘
               ▼
       ┌───────────────┐
       │ Portfolio Mgr │
       │ (synthesize)  │
       └───────────────┘
```

**Option B — Specialist ensemble:**
- Technical analyst (price action, volume, momentum)
- Fundamental analyst (valuation, earnings, balance sheet)
- Macro analyst (sector rotation, rates, sentiment)

**Trade-off:** 2-3x token cost per symbol. Consider running only for high-conviction or large-position symbols.

**Complexity:** Medium — parallel agent invocation, schema changes for multi-assessment input to PM.

---

## 3. Backtesting Infrastructure

**Problem:** No way to validate strategy performance historically. Cannot answer "Would this have worked in 2022?"

**Solution:** Replay mode that feeds historical data through the pipeline.

**Components:**
```
┌─────────────────────────────────────────────────┐
│ BacktestRunner                                  │
├─────────────────────────────────────────────────┤
│ - dateRange: [start, end]                       │
│ - symbols: string[]                             │
│ - mockDataSources (historical snapshots)        │
│ - mockBroker (fills at historical prices)       │
│ - resultCollector (trades, P&L, metrics)        │
└─────────────────────────────────────────────────┘
```

**Key metrics to track:**
- Total return vs SPY
- Sharpe ratio, Sortino ratio, max drawdown
- Win rate, average win/loss ratio
- Per-symbol attribution

**Data requirement:** Need historical fundamentals/news snapshots, not just prices. Options:
- Store `research_artifacts` indefinitely, replay from cache
- Use point-in-time fundamental databases (expensive)
- Accept that backtests use current fundamentals (flawed but useful)

**Complexity:** High — requires data collection strategy, careful handling of lookahead bias.

---

## 4. Confidence Calibration

**Problem:** Model outputs confidence scores (e.g., 0.75), but we don't know if 75% confidence actually wins 75% of the time.

**Solution:** Track and calibrate confidence vs outcomes.

**Implementation:**
```sql
CREATE TABLE confidence_calibration (
  id INTEGER PRIMARY KEY,
  run_id TEXT,
  symbol TEXT,
  predicted_direction TEXT,  -- 'long' | 'short' | 'hold'
  confidence REAL,
  actual_return_5d REAL,
  actual_return_20d REAL,
  correct_direction INTEGER,
  created_at INTEGER
);
```

**Calibration report:**
| Confidence Band | Predictions | Correct | Accuracy | Brier Score |
|-----------------|-------------|---------|----------|-------------|
| 0.9 - 1.0       | 12          | 10      | 83%      | 0.14        |
| 0.8 - 0.9       | 34          | 25      | 74%      | 0.21        |
| 0.7 - 0.8       | 58          | 38      | 66%      | 0.27        |

**Use in risk engine:** Adjust position size by `calibrated_accuracy / raw_confidence` ratio.

**Complexity:** Low — just tracking and reporting, no architectural changes.

---

## 5. Event-Driven Runs

**Problem:** Daily cadence misses overnight gaps and intraday catalysts.

**Solution:** Trigger runs on specific events, not just schedule.

**Event sources:**
- Earnings release (via `calendarEvents.earnings.earningsDate`)
- Fed announcement days (hardcoded calendar)
- VIX spike > threshold
- Price move > N% from prior close

**Implementation:**
```ts
// scheduler/eventTriggers.ts
interface EventTrigger {
  id: string;
  check(): Promise<{ shouldRun: boolean; reason: string }>;
}

// Run subset of pipeline — just affected symbols
async function runEventTriggered(trigger: EventTrigger, symbols: string[]) {
  // Skip full watchlist scan, run only relevant symbols
}
```

**Guard:** Still enforce `minIntervalHours` between any two runs to prevent runaway costs.

**Complexity:** Medium — need event detection, partial-run logic.

---

## 6. Tool Result Caching

**Problem:** Multiple symbols in same run re-fetch identical macro data. Wastes API calls and adds latency.

**Solution:** Per-run cache with short TTL.

**Implementation:**
```ts
// datasources/cache.ts
class RunCache {
  private store = new Map<string, { data: unknown; expiresAt: number }>();
  
  async getOrFetch<T>(key: string, ttlMs: number, fetch: () => Promise<T>): Promise<T> {
    const cached = this.store.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T;
    }
    const data = await fetch();
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
    return data;
  }
}
```

**Cache keys:**
- `macro:${seriesId}` — 5 min TTL (same for all symbols)
- `fundamentals:${symbol}` — 1 min TTL (unlikely to re-fetch)
- `news:${symbol}:${days}` — 1 min TTL

**Complexity:** Low — isolated utility, no schema changes.

---

## 7. Graceful Degradation Dashboard

**Problem:** When a data source fails, the run continues but quality suffers silently.

**Solution:** Surface data source health and coverage in UI.

**New endpoint:** `GET /api/runs/:id/coverage`
```json
{
  "symbols": {
    "AAPL": {
      "news": { "ok": true, "count": 12 },
      "fundamentals": { "ok": true },
      "options": { "ok": false, "error": "timeout" },
      "macro": { "ok": true }
    }
  },
  "overallHealth": 0.92
}
```

**UI:** Show coverage heatmap per run. Alert if coverage drops below threshold.

**Complexity:** Low — aggregation over existing `research_artifacts` data.

---

## 8. Autonomous Watchlist Selection

**Problem:** Watchlist is manually curated. The system only trades among hand-picked symbols, missing opportunities in the broader market.

**Solution:** Add a **Screener Agent** (Stage 0) that dynamically selects symbols before the analyst stage runs.

**Architecture:**
```
┌─────────────────────┐
│   Universe Filter   │  ← Quant pre-filter (no LLM): volume, market cap, sector
│   (S&P 500 → 30)    │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│   Screener Agent    │  ← LLM picks final 10-15 with rationale
│   (30 → 10-15)      │
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│   Analyst Agents    │  ← Existing per-symbol research
└─────────────────────┘
```

**New tools for Screener Agent:**
```ts
scan_market({ criteria }): Promise<{ symbol: string; metrics: object }[]>
// Wraps stock screener API (Finviz, TradingView, Yahoo)

get_sector_performance(): Promise<{ sector: string; return1d: number; return1w: number }[]>
// Identify hot/cold sectors for rotation

get_unusual_options_activity({ minVolumeRatio }): Promise<{ symbol: string; putCallRatio: number; volumeVsOI: number }[]>
// Find names with unusual activity

get_earnings_calendar({ days }): Promise<{ symbol: string; date: string; estimate: number }[]>
// Upcoming catalysts
```

**Settings schema:**
```ts
// shared/src/settings.ts
watchlist: {
  mode: 'manual' | 'dynamic',
  // Manual mode (current behavior)
  symbols: string[],
  // Dynamic mode
  universe: 'SP500' | 'NASDAQ100' | 'custom',
  customUniverse?: string[],  // if universe = 'custom'
  maxSymbolsPerRun: number,   // default 15
  preFilter: {
    minAvgVolume: number,     // default 1_000_000
    minMarketCap: number,     // default 10_000_000_000
    excludeSectors: string[], // e.g. ['Utilities']
  }
}
```

**Hybrid approach (recommended):**
1. Define universe (S&P 500 or custom 100-200 names)
2. Quant pre-filter narrows to ~30 candidates (cheap, fast, no LLM)
3. Screener agent picks final 10-15 with rationale (one LLM call)
4. Analyst agents research those 10-15

**Trade-offs:**
| Approach | Token Cost | Control | Serendipity |
|----------|------------|---------|-------------|
| Hand-picked watchlist | None | Full | None |
| Quant pre-filter only | None | High | Low |
| Screener agent | Medium | Medium | High |
| Full autonomous | High | Low | Highest |

**Complexity:** Medium — new agent, new tools, settings schema update, but no changes to existing analyst/PM/risk pipeline.

---

## Priority Ranking

| Improvement | Impact | Complexity | Recommended Phase |
|-------------|--------|------------|-------------------|
| Confidence Calibration | High | Low | Phase 2 |
| Tool Result Caching | Medium | Low | Phase 2 |
| Graceful Degradation Dashboard | Medium | Low | Phase 2 |
| Autonomous Watchlist Selection | High | Medium | Phase 3 |
| Backtesting Infrastructure | High | High | Phase 3 |
| Embedding Store | Medium | Medium | Phase 3 |
| Multi-Agent Debate | Medium | Medium | Phase 4 |
| Event-Driven Runs | Low | Medium | Phase 4+ |

**Rationale:** Start with low-complexity wins that improve observability and efficiency. Autonomous watchlist and backtesting are high-impact but require more infrastructure. Multi-agent and event-driven are nice-to-haves once the core loop is proven.

---

[← Edge Cases & Scope](06-edge-cases-and-scope.md) · [back to index](README.md)
