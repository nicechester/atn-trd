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

## 9. Sector Performance Data

**Problem:** No visibility into sector-level trends. The agent can't answer "which sectors are hot/cold?" or factor sector momentum into decisions.

**Solution:** Add `get_sector_performance()` tool using sector ETFs or Finnhub sector metrics.

**Data sources:**
- Yahoo Finance sector ETFs (XLK, XLF, XLE, XLV, XLY, XLP, XLI, XLB, XLRE, XLU, XLC)
- Finnhub `/stock/sector-metric`
- Alpha Vantage `SECTOR` endpoint

**Payload:**
```ts
interface SectorPerformance {
  sector: string;           // 'Technology', 'Healthcare', etc.
  etfSymbol: string;        // 'XLK', 'XLV', etc.
  return1d: number;         // 1-day return %
  return1w: number;         // 1-week return %
  return1m: number;         // 1-month return %
  return3m: number;         // 3-month return %
  avgPE: number | null;     // sector average P/E
  avgVolatility: number | null;
}
```

**Usage:**
- Screener agent: sector rotation signals
- Analyst agent: relative sector strength context
- Investor profile: sector bias application

**Complexity:** Low — can derive from existing price data via sector ETFs.

---

## 10. Volatility Calculation Service

**Problem:** Beta is available from fundamentals, but historical volatility is not calculated. Need volatility metrics for risk filtering and style scoring.

**Solution:** Calculate historical volatility from price history.

**Formula:**
```ts
// Daily return standard deviation × √252 (annualized)
function calculateHistoricalVolatility(prices: number[], days: number): number {
  const returns = prices.slice(-days).map((p, i, arr) => 
    i === 0 ? 0 : (p - arr[i-1]) / arr[i-1]
  ).slice(1);
  
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  
  return stdDev * Math.sqrt(252);  // Annualize
}
```

**Metrics:**
```ts
interface VolatilityMetrics {
  symbol: string;
  historicalVol20d: number;   // 20-day annualized volatility
  historicalVol60d: number;   // 60-day annualized volatility
  beta: number | null;        // From fundamentals (market relative)
  impliedVol: number | null;  // From options chain ATM IV
}
```

**Usage:**
- Risk engine: filter by `maxVolatility`
- Style scoring: `stabilityScore = 1 / volatility`
- Analyst context: risk assessment

**Complexity:** Low — pure calculation over existing price data.

---

## 11. Investor Profile Settings

**Problem:** No concept of investor preferences. Different investors want different strategies (growth vs income, high risk vs conservative).

**Solution:** Add `investorProfile` to settings with weighted style preferences.

**Schema:**
```ts
investorProfile: {
  // Style weights (should sum to 100)
  styleWeights: {
    growth: number;      // Revenue/earnings growth focus
    value: number;       // Low P/E, undervalued stocks
    stability: number;   // Low volatility, blue chips
    cashFlow: number;    // FCF, dividends, income
    momentum: number;    // Price trend following
  };
  
  // Risk tolerance
  maxVolatility: number;           // Max annualized volatility (e.g., 0.30 = 30%)
  
  // Sector preferences (optional)
  sectorBias?: {
    [sector: string]: number;      // 1.0 = neutral, >1 = prefer, <1 = avoid
  };
}
```

**Example profiles:**
```ts
// Growth investor
{ growth: 60, stability: 30, cashFlow: 10, value: 0, momentum: 0 }

// Income/dividend investor
{ cashFlow: 50, stability: 30, value: 20, growth: 0, momentum: 0 }

// Aggressive momentum
{ momentum: 50, growth: 40, stability: 10, value: 0, cashFlow: 0 }
```

**Style scoring:**
```ts
function scoreSymbol(fundamentals: F, volatility: V, weights: StyleWeights): number {
  const growthScore = normalize(fundamentals.revenueGrowth);
  const valueScore = normalize(1 / fundamentals.trailingPE);
  const stabilityScore = normalize(1 / volatility.historicalVol60d);
  const cashFlowScore = normalize(fundamentals.freeCashflow);
  
  return (
    weights.growth * growthScore +
    weights.value * valueScore +
    weights.stability * stabilityScore +
    weights.cashFlow * cashFlowScore
  ) / 100;
}
```

**Integration:**
| Component | Usage |
|-----------|-------|
| Screener | Score and rank candidates by style fit |
| Analyst prompt | "This investor prioritizes growth 60%, stability 30%" |
| PM prompt | Consider style balance in portfolio construction |
| Risk Engine | Filter by `maxVolatility`, apply `sectorBias` |

**Complexity:** Low — settings schema + scoring logic, no new data sources.

---

## 12. RSS Feed News Ingestion

**Problem:** Current news sources have limitations — Finnhub requires API key with rate limits, Yahoo is unofficial and can break. Need a free, unlimited news pipeline.

**Solution:** Add RSS feed ingestion as primary news source.

**Key RSS feeds:**
```
┌─────────────────────────────────────────────────────────────────┐
│                     RSS Feed Sources                            │
├─────────────────────────────────────────────────────────────────┤
│ Ticker News:                                                    │
│   • Google News: news.google.com/rss/search?q={symbol}+stock    │
│   • Yahoo RSS:   finance.yahoo.com/rss/headline?s={symbol}      │
│   • Seeking Alpha: seekingalpha.com/api/sa/combined/{symbol}.xml│
├─────────────────────────────────────────────────────────────────┤
│ Regulatory (material events before news reports):               │
│   • SEC EDGAR 8-K: sec.gov/.../type=8-K&output=atom             │
│   • SEC EDGAR 10-Q: sec.gov/.../type=10-Q&output=atom           │
├─────────────────────────────────────────────────────────────────┤
│ Macro:                                                          │
│   • Federal Reserve: federalreserve.gov/feeds/press_all.xml     │
│   • CNBC Finance: search.cnbc.com/rs/.../id=10000664            │
└─────────────────────────────────────────────────────────────────┘
```

**Architecture:**
```
┌─────────────────────────────────────────────┐
│              News Aggregator                │
├─────────────────────────────────────────────┤
│  Primary:   RSS feeds (free, no limits)     │
│  Enrichment: Finnhub (sentiment, if key)    │
│  Fallback:  Yahoo (zero-key backup)         │
└─────────────────────────────────────────────┘
```

**Comparison:**
| Feature | RSS Feeds | REST APIs |
|---------|-----------|----------|
| Cost | **Free** | Paid tiers |
| Auth | **None** | API keys |
| Rate limits | **None** | 60/min etc |
| Latency | 1-5 min | Real-time |
| Structure | XML (parse needed) | JSON |

**Key value:**
- **SEC 8-K** — catches earnings, M&A, executive changes before news outlets report
- **Fed releases** — FOMC decisions, rate changes direct from source
- Pairs well with Event-driven runs (#73) — poll RSS, trigger on material events

**Complexity:** Low — XML parsing with `rss-parser`, normalize to existing `NewsArticle` interface.

---

## Priority Ranking

| Improvement | Impact | Complexity | Recommended Phase | Issue |
|-------------|--------|------------|-------------------|-------|
| Confidence Calibration | High | Low | Phase 2 | #68 |
| Tool Result Caching | Medium | Low | Phase 2 | #69 |
| Graceful Degradation Dashboard | Medium | Low | Phase 2 | #70 |
| Sector Performance Data | Medium | Low | Phase 2 | #83 |
| Volatility Calculation | Medium | Low | Phase 2 | #84 |
| Investor Profile Settings | High | Low | Phase 2 | #85 |
| Finnhub Fundamentals | Medium | Low | Phase 2 | #81 |
| RSS Feed News Ingestion | High | Low | Phase 2 | #86 |
| Autonomous Watchlist Selection | High | Medium | Phase 3 | #79 |
| Backtesting Infrastructure | High | High | Phase 3 | #66 |
| Embedding Store | Medium | Medium | Phase 3 | #67 |
| Multi-Agent Debate | Medium | Medium | Phase 4 | #72 |
| Event-Driven Runs | Low | Medium | Phase 4+ | #73 |

**Rationale:** Start with low-complexity wins that improve observability and efficiency. Autonomous watchlist and backtesting are high-impact but require more infrastructure. Multi-agent and event-driven are nice-to-haves once the core loop is proven.

---

[← Edge Cases & Scope](06-edge-cases-and-scope.md) · [back to index](README.md)
