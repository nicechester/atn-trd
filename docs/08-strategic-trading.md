# 08 — Strategic Plan-Based Trading

[← back to index](README.md)

> "Investment is waiting. Hurry to pick immature fruit makes my stomach sick."

## Overview

This document describes the architectural shift from reactive daily trading to a **patient, plan-based portfolio management system**. The system collects signals continuously, detects market regimes, and executes trades only when conviction and conditions align.

**GitHub Epic:** [#131 - Strategic Plan-Based Trading System](https://github.com/nicechester/atn-trd/issues/131)

---

## Philosophy

### Old Approach (Reactive)
```
Every day → Analyze → Decide → Trade → Repeat
```
This creates **noise trading** — forcing decisions when there's nothing to decide.

### New Approach (Strategic)
```
Continuous Signal Collection → Wait → Threshold Crossed + Regime Favorable → Execute Tranche
```

The system asks:
- "What signals am I seeing across my watchlist?"
- "Is the market regime favorable for action?"
- "Has conviction reached threshold to execute a tranche?"

Most days, the correct answer is: **"No action — waiting."**

---

## Three Distinct Rhythms

| Rhythm | Frequency | Purpose |
|--------|-----------|---------|
| **Signal Collection** | Daily | Gather news, prices, macro, sentiment. No decisions. |
| **Watchlist Curation** | Quarterly + Event-driven | Screener picks symbols + assigns categories. Manual overrides for IPOs/crises. |
| **Execution** | Signal-triggered only | Could be weeks of nothing, then action. |

```
┌─────────────────────────────────────────────────────────────┐
│                 QUARTERLY / EVENT-DRIVEN                    │
│  - Screener picks symbols autonomously                      │
│  - Classifies each: GROWTH_CORE / DIVIDEND_GROWTH / INCOME  │
│  - Estimates yield, dividend growth rate, expected CAGR     │
│  - Manual overrides only for IPOs, crises, major events     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    DAILY SIGNAL COLLECTION                  │
│  - Collect prices, news sentiment, macro indicators         │
│  - Compute rolling metrics (14-day trends)                  │
│  - Update composite conviction scores                       │
│  - Detect market regime (risk-on / risk-off)                │
│  - NO TRADING DECISIONS                                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    WEEKLY PLAN REVIEW                       │
│  - Check watchlist signals vs thresholds                    │
│  - Create new plans if buy threshold crossed                │
│  - Pause/resume plans based on regime                       │
│  - Adjust existing plans if conviction changed              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    DAILY TRANCHE CHECK                      │
│  - Check active plans for execution eligibility             │
│  - Verify: min days elapsed + signal valid + regime OK      │
│  - Execute tranche OR log "waiting" with reason             │
│  - Most days: no action (correct behavior)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Component Architecture

### 1. Signal Accumulation Layer

Collects market data daily **without making trading decisions**. This is the "eyes and ears" of the system.

#### Symbol Sources
Signal collection runs for the **union of watchlist + positions**:
- Watchlist symbols (from screener or manual adds)
- Position symbols (ensures existing holdings are monitored)

This ensures positions from manual trades or the old trading cycle are tracked for potential TRIM signals.

#### Data Collected
- **Price data**: Close, volume, vs moving averages
- **Sentiment**: FinBERT scores on news headlines (future: LLM + FinBERT, see #155)
- **Macro**: VIX, yields, Fed funds rate
- **Sector**: Relative performance

#### Rolling Metrics
- 14-day sentiment trend (slope)
- Price vs 50-day SMA
- Composite conviction score

#### Composite Score Formula
```
composite = w_sentiment × sentiment_score
          + w_trend × sentiment_trend  
          + w_momentum × price_momentum

where weights are configurable (default: 0.4, 0.3, 0.3)
```

#### Signal Decay (EWMA)
Point-in-time scores can whipsaw. Use exponential weighted moving average:
```
composite_ewma = α × composite_today + (1 - α) × composite_ewma_yesterday

where α = 0.1 (default, configurable)
```

**Why EWMA?** A single bad news day can spike the raw score (e.g., 0.72 → 0.45 → 0.73). With α=0.1, that spike only pulls EWMA from 0.715 to 0.689 — no false trigger. Recent data matters more than old data, but noise is smoothed out.

| α | Behavior | Use Case |
|---|----------|----------|
| 0.05 | Very smooth | Long-term trend |
| 0.10 | Smooth | **Default** |
| 0.20+ | Responsive | Faster reaction |

Store `composite_ewma` in `signal_snapshots`.

### 2. Market Regime Detection

Determines whether the system should be accumulating equities or rotating to defensive assets.

### 2.5 Screener Classification (Quarterly)

When screener runs, it **autonomously classifies** each symbol:

```typescript
// Screener output per symbol
{
  symbol: 'JNJ',
  rationale: 'Healthcare dividend aristocrat, 60+ years of increases',
  conviction: 0.78,
  category: 'DIVIDEND_GROWTH',   // Screener decides
  dividendYield: 0.029,          // 2.9%
  dividendGrowthRate: 0.06,      // 6% annual div growth
  estimatedCAGR: 0.08,           // 8% total return estimate
}

function classifySymbol(fundamentals: Fundamentals): PlanCategory {
  const { dividendYield, dividendGrowthRate } = fundamentals;
  
  if (dividendYield > 0.04) return 'INCOME_BOOSTER';       // >4% yield
  if (dividendYield > 0.01 && dividendGrowthRate > 0.05) 
    return 'DIVIDEND_GROWTH';                              // 1-4% yield + growing
  return 'GROWTH_CORE';                                    // Low/no dividend
}
```

This metadata flows to watchlist → plans → UI, all autonomously.

#### Regime States

| Regime | Meaning | Action |
|--------|---------|--------|
| **RISK_ON** | Market healthy | Execute equity accumulation plans |
| **RISK_OFF** | Market stressed | Pause equity buys, consider hedges |
| **NEUTRAL** | Mixed signals | Reduce position sizing |

#### Regime Indicators

| Indicator | Risk-Off Trigger | Weight |
|-----------|------------------|--------|
| VIX | > 25 | 0.30 |
| VIX Extreme | > 35 | +0.20 |
| Yield Curve (10Y-2Y) | < 0 (inverted) | 0.25 |
| Market Breadth | < 40% above 200 SMA | 0.25 |

#### Detection Logic
```typescript
function detectRegime(indicators: RegimeIndicators): Regime {
  let riskScore = 0;
  
  if (indicators.vix > 25) riskScore += 0.30;
  if (indicators.vix > 35) riskScore += 0.20;
  if (indicators.yieldCurve < 0) riskScore += 0.25;
  if (indicators.breadth < 0.40) riskScore += 0.25;
  
  if (riskScore >= 0.50) return 'RISK_OFF';
  if (riskScore >= 0.25) return 'NEUTRAL';
  return 'RISK_ON';
}
```

#### Regime Confirmation Delay
VIX can spike for 1 day then drop. Require **3 consecutive days** of RISK_OFF before pausing plans:
```typescript
function shouldPausePlans(regimeHistory: Regime[]): boolean {
  const last3 = regimeHistory.slice(-3);
  return last3.length === 3 && last3.every(r => r === 'RISK_OFF');
}
```
Store `regime_streak` in `market_regime` table to track consecutive days.

### 3. Strategic Plans

Long-term accumulation/trim campaigns with tranched execution.

#### Plan Types

| Type | Purpose | Trigger | Example |
|------|---------|---------|--------|
| **ACCUMULATE** | Build position over time | Score ≥ buyThreshold (0.70) | "Buy 100 AAPL shares in 4 tranches" |
| **TRIM** | Reduce position gradually | Score ≤ sellThreshold (-0.50) | "Sell 50% of NVDA over 3 weeks" |
| **HEDGE** | Rotate to defensive assets | RISK_OFF regime | "Allocate 20% to GLD/TLT" |

**TRIM plans are auto-created** when positions have bearish signals (score below sellThreshold). This ensures the system can exit positions, not just accumulate.

#### Plan Targets

Plans can have multiple target types beyond just share count:

```typescript
strategic_plans {
  target_shares: 100,              // "accumulate 100 shares"
  target_budget_cents: 1000000,    // "invest $10k total"
  target_dividend_cents: 50000,    // "add $500/yr dividend income"
  target_total_return: 0.15,       // "aim for 15% CAGR"
}
```

This enables **income-oriented planning** without chasing yield:
- Don't buy high-yield junk
- Buy dividend growers that will **grow into** your income target
- A portfolio of 3% yielders growing 10%/yr becomes 6% yield in 7 years

#### Plan Categories (by Investment Style)

| Category | Focus | Regime Behavior |
|----------|-------|----------------|
| **Growth Core** | Capital appreciation | RISK_ON: full tranches, RISK_OFF: pause |
| **Dividend Growth** | Growing dividends | RISK_ON: full, NEUTRAL: buy dips only |
| **Income Booster** | Current yield | RISK_OFF: rotate here for cash flow |

#### Plan Lifecycle
```
CREATED → ACTIVE → PAUSED (optional) → COMPLETED
                      ↓
                  CANCELLED
```

#### Tranche Execution Rules
1. **Minimum spacing**: At least N days since last tranche (default: 5)
2. **Signal validity**: Composite score still above threshold
3. **Regime check**: Not RISK_OFF for ACCUMULATE plans
4. **Budget available**: Sufficient cash for tranche

### 4. Execution Engine

Checks active plans daily and executes only when all conditions align.

#### Daily Decision Tree
```
For each active plan:
  │
  ├─ Is regime RISK_OFF and plan is ACCUMULATE?
  │   └─ YES → Pause plan, log reason
  │
  ├─ Days since last tranche < minimum?
  │   └─ YES → Skip, log "waiting for timing"
  │
  ├─ Current composite score < threshold?
  │   └─ YES → Skip, log "signal weakened"
  │
  ├─ Insufficient cash for tranche?
  │   └─ YES → Skip, log "insufficient funds"
  │
  └─ All checks pass?
      └─ YES → Execute tranche, update plan
```

#### Regime-Based Category Behavior

| Regime | Growth Core | Dividend Growth | Income Booster |
|--------|-------------|-----------------|----------------|
| **RISK_ON** | Full tranches | Full tranches | Normal |
| **NEUTRAL** | Reduce size 50% | Buy dips only | Normal |
| **RISK_OFF** | Pause all | Pause new, hold existing | Rotate here for cash flow |

```typescript
function getTrancheMultiplier(plan: Plan, regime: Regime): number {
  if (regime === 'RISK_ON') return 1.0;
  
  if (regime === 'NEUTRAL') {
    if (plan.category === 'GROWTH_CORE') return 0.5;
    if (plan.category === 'DIVIDEND_GROWTH') return 0; // dip-buy only
    return 1.0; // INCOME_BOOSTER unchanged
  }
  
  if (regime === 'RISK_OFF') {
    if (plan.category === 'INCOME_BOOSTER') return 1.0; // keep buying
    return 0; // pause growth/dividend
  }
}
```

---

## Database Schema

### signal_snapshots
Daily signal data per symbol.

```sql
CREATE TABLE signal_snapshots (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,  -- YYYY-MM-DD
  
  -- Raw signals
  price_cents INTEGER,
  sentiment_score REAL,         -- FinBERT: -1 to 1
  sentiment_confidence REAL,
  
  -- Computed metrics
  sentiment_trend REAL,         -- 14-day slope
  price_vs_sma50 REAL,          -- % above/below
  composite_score REAL,         -- Weighted combination
  composite_ewma REAL,          -- Exponentially weighted MA (smoothed)
  
  created_at INTEGER NOT NULL,
  
  UNIQUE(symbol, snapshot_date)
);
```

### market_regime
Daily regime state with indicator breakdown.

```sql
CREATE TABLE market_regime (
  id TEXT PRIMARY KEY,
  as_of_date TEXT NOT NULL UNIQUE,
  regime TEXT NOT NULL,         -- RISK_ON | RISK_OFF | NEUTRAL
  
  -- Raw indicators
  vix_level REAL,
  yield_curve_spread REAL,
  breadth_pct REAL,
  
  -- Scoring
  risk_score REAL,              -- 0-1
  regime_streak INTEGER DEFAULT 1,  -- Consecutive days in this regime
  indicators_json TEXT,
  
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_market_regime_date ON market_regime(as_of_date);
```

### strategic_plans
Long-term accumulation/trim campaigns.

```sql
CREATE TABLE strategic_plans (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,      -- ACCUMULATE | TRIM | HEDGE
  
  -- Targets (multiple target types supported)
  target_shares REAL,
  target_budget_cents INTEGER,    -- Dollar-based targeting
  target_dividend_cents INTEGER,  -- Annual dividend income target
  target_total_return REAL,       -- Target CAGR (e.g., 0.15 = 15%)
  executed_shares REAL DEFAULT 0,
  target_weight REAL,
  
  -- Plan category
  category TEXT DEFAULT 'GROWTH_CORE',  -- GROWTH_CORE | DIVIDEND_GROWTH | INCOME_BOOSTER
  
  -- Tranching
  tranche_count INTEGER DEFAULT 4,
  tranches_executed INTEGER DEFAULT 0,
  min_days_between INTEGER DEFAULT 5,
  
  -- Triggers & Thresholds
  entry_composite_score REAL,
  conviction_at_creation REAL,
  min_conviction_threshold REAL DEFAULT 0.60,  -- Pause if score drops below
  cancel_threshold REAL DEFAULT 0.45,          -- Cancel if score drops below
  
  -- Audit trail
  creation_notes TEXT,          -- Gemini thesis + FinBERT scores at creation
  
  -- Status
  status TEXT DEFAULT 'ACTIVE',
  pause_reason TEXT,
  
  -- Timestamps
  created_at INTEGER NOT NULL,
  last_tranche_at INTEGER,
  completed_at INTEGER,
  
  -- Constraint: must have either shares or budget target
  CHECK (target_shares IS NOT NULL OR target_budget_cents IS NOT NULL)
);
```

### plan_tranches
Individual execution records.

```sql
CREATE TABLE plan_tranches (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES strategic_plans(id),
  tranche_number INTEGER NOT NULL,
  
  -- Execution
  shares REAL NOT NULL,
  price_cents INTEGER NOT NULL,
  total_cost_cents INTEGER,     -- Actual cash spent (shares × price + fees)
  order_id TEXT,
  order_status TEXT DEFAULT 'PENDING',  -- PENDING | FILLED | PARTIAL | FAILED
  
  -- Context at execution
  composite_score REAL,
  regime TEXT,
  
  executed_at INTEGER NOT NULL,
  filled_at INTEGER              -- When order actually filled (may differ from executed_at)
);
```

---

## Settings Schema

```typescript
// New settings sections

watchlist: {
  reviewCycle: 'quarterly' | 'monthly',
  autoScreenerEnabled: boolean,
  manualOverrideEnabled: boolean,
}

signals: {
  buyThreshold: number,           // 0.70 default
  sellThreshold: number,          // -0.50 default
  rollingWindowDays: number,      // 14 default
  weights: {
    sentiment: number,            // 0.4
    sentimentTrend: number,       // 0.3
    priceMomentum: number,        // 0.3
  },
}

regime: {
  enabled: boolean,
  vixRiskOffThreshold: number,    // 25
  vixExtremeThreshold: number,    // 35
  yieldCurveEnabled: boolean,
  breadthThreshold: number,       // 0.4
}

execution: {
  trancheStyle: 'fixed' | 'conviction_scaled' | 'dip_buying',
  defaultTrancheCount: number,    // 4
  minDaysBetweenTranches: number, // 5
  requireRegimeCheck: boolean,
}

hedging: {
  enabled: boolean,
  riskOffAssets: string[],        // ['GLD', 'TLT', 'SHY']
  cashReserveInRiskOff: number,   // 0.40
  autoRotateEnabled: boolean,
}
```

---

## Daily Log Examples

### Typical Day (No Action)
```
[2024-01-15 16:30] Signal collection complete. 12 symbols updated.
[2024-01-15 16:31] Regime: RISK_ON (VIX: 14.2, yield: +0.45%)
[2024-01-15 16:31] Active plans: AAPL (2/4), GOOGL (1/4)
[2024-01-15 16:32] Tranche check:
  - AAPL: Skip - 3 days since last (min: 5)
  - GOOGL: Skip - composite 0.62 < threshold 0.70
[2024-01-15 16:32] Result: No trades. Waiting for conditions.
```

### Execution Day
```
[2024-01-20 16:30] Signal collection complete. 12 symbols updated.
[2024-01-20 16:31] Regime: RISK_ON (VIX: 13.8)
[2024-01-20 16:31] Tranche check:
  - AAPL: Execute ✓ (7 days elapsed, score 0.75)
[2024-01-20 16:32] Executed: AAPL tranche 3/4, 25 shares @ $182.50
[2024-01-20 16:32] Plan AAPL: 75/100 shares complete
```

### Risk-Off Day
```
[2024-01-25 16:30] Signal collection complete. 12 symbols updated.
[2024-01-25 16:31] Regime: RISK_OFF (VIX: 28.5 ⚠️, yield: -0.12%)
[2024-01-25 16:31] Pausing ACCUMULATE plans: AAPL, GOOGL, MSFT
[2024-01-25 16:32] Checking hedge allocation...
[2024-01-25 16:32] Result: Equity plans paused. Cash reserve at 40%.
```

---

## Edge Cases & Mitigations

### 1. Chunky Stock Problem (High-Priced Shares)

When buying expensive stocks ($500+/share), fixed share targets can cause:
- Large uninvested cash overhang
- Order rejections if `available_cash < shares × price`

**Mitigation:**
- Support `target_budget_cents` as alternative to `target_shares`
- Tranche executor computes: `shares = Math.floor(tranche_budget / current_price)`
- Graceful failure with logged reason: "insufficient cash for 1 whole share"

### 2. Liquidity for Hedging

When regime shifts to RISK_OFF, where does cash for GLD/TLT come from if fully invested?

**Mitigation:**
- RISK_OFF triggers paired TRIM plans on low-conviction equities
- Priority order: Trim weak equities → Free cash → Allocate hedge assets
- Setting: `hedging.autoTrimForCash: boolean`

### 3. Signal Threshold Flapping

If composite score oscillates around threshold (0.69 ↔ 0.71), plans may flap between active/paused.

**Mitigation: Hysteresis bands**
- Entry threshold: `0.70` (start new ACCUMULATE plan)
- Pause threshold: `0.60` (pause active plan if score drops below)
- Cancel threshold: `0.45` (cancel plan, consider TRIM)

```typescript
function evaluatePlanStatus(plan: Plan, currentScore: number): PlanAction {
  if (currentScore < plan.cancelThreshold) return 'CANCEL';
  if (currentScore < plan.minConvictionThreshold) return 'PAUSE';
  return 'CONTINUE';
}
```

### 4. Partial Fills & Order Status

Alpaca orders may fill partially or take time to complete.

**Mitigation:**
- Track `order_status` in `plan_tranches`: PENDING | FILLED | PARTIAL | FAILED
- Don't increment `executed_shares` until order confirmed filled
- Poll order status or use webhooks for async updates
- `filled_at` timestamp separate from `executed_at` (submission time)

### 5. Plan Conflicts

What if user manually creates conflicting plans (ACCUMULATE + TRIM same symbol)?

**Mitigation:**
- Unique constraint: only one ACTIVE plan per symbol per direction
- UI validation prevents conflicting plan creation
- If regime triggers auto-TRIM while ACCUMULATE active, pause ACCUMULATE first

### 6. Conviction-Scaled Tranches

Fixed tranches ignore conviction strength. Scale tranche size by conviction:

```typescript
function computeConvictionScaledTranche(plan: Plan, currentScore: number): number {
  const baseSize = plan.target_shares / plan.tranche_count;
  const convictionMultiplier = (currentScore - 0.5) / 0.5; // 0.75 → 0.5, 0.90 → 0.8
  return Math.max(baseSize * 0.2, baseSize * convictionMultiplier); // Min 20% of base
}
```

Example: base=25 shares, score=0.75 → 25 × 0.5 = 12.5 shares
Example: base=25 shares, score=0.90 → 25 × 0.8 = 20 shares

### 7. Max Sector Exposure

Multiple ACCUMULATE plans in same sector = concentrated risk.

**Mitigation:**
- Track sector for each symbol in watchlist
- Before executing tranche, check: `sector_exposure_after_trade <= 0.30`
- Skip tranche with log: "sector cap exceeded"

```typescript
function checkSectorExposure(symbol: string, trancheValue: number): boolean {
  const sector = getSector(symbol);
  const currentExposure = portfolio.getSectorExposure(sector);
  const newExposure = (currentExposure + trancheValue) / portfolio.totalValue;
  return newExposure <= settings.risk.maxSectorExposure; // default 0.30
}
```

### 8. Automatic Hedge Plan Creation

RISK_OFF pauses plans but doesn't actively hedge.

**Mitigation:**
- If regime == RISK_OFF for 2+ days AND cash > 20% → auto-create HEDGE plan
- Hedge assets: GLD, TLT, SHY (configurable)

```typescript
async function maybeCreateHedgePlan(): Promise<void> {
  const regime = getCurrentRegime();
  if (regime.regime !== 'RISK_OFF' || regime.regime_streak < 2) return;
  
  const cashPercent = portfolio.cashCents / portfolio.totalValueCents;
  if (cashPercent < 0.20) return;
  
  const existingHedge = getActivePlan('GLD');
  if (existingHedge) return;
  
  await createPlan({
    symbol: 'GLD',
    direction: 'HEDGE',
    target_weight: 0.15,
    creation_notes: `Auto-hedge: RISK_OFF streak=${regime.regime_streak}, VIX=${regime.vix_level}`,
  });
}
```

---

## Migration Path

1. **Phase 1**: Add signal collection (runs alongside existing system)
2. **Phase 2**: Add regime detection
3. **Phase 3**: Add strategic plans layer
4. **Phase 4**: Refactor trading cycle to plan-driven
5. **Phase 5**: Add UI components
6. **Phase 6**: Deprecate old reactive cycle

The existing daily cycle continues to work during migration. New components are additive until Phase 4.

**Note**: When `execution.enabled` is true, the old trading cycle is automatically skipped. The scheduler shows "Trading Cycle: disabled (strategic plans active)".

---

## Success Criteria

- [x] System can go weeks without trading (correct behavior)
- [x] Trades only execute when conviction + regime align
- [x] Clear audit trail: "why did/didn't we trade today?"
- [x] Automatic hedging when regime = RISK_OFF
- [x] Watchlist changes are rare and intentional
- [x] Historical signal data enables backtesting
- [x] No sector exceeds 30% exposure
- [x] Signal decay (EWMA) prevents whipsaw reactions
- [x] Positions monitored for TRIM signals (not just watchlist)
- [x] Dashboard shows execution mode (Strategic Plans vs Trading Cycle)

---

## Operational Notes

### "Most days: no action" is Psychologically Hard

You'll feel like the bot is broken when it doesn't trade. Add notifications:

```
[WAITING] Regime RISK_ON, AAPL score 0.62 < 0.70. Next check: 5 days.
[WAITING] GOOGL tranche 2/4 ready in 3 days.
[PAUSED] MSFT plan paused: RISK_OFF streak day 2.
```

### Recommended Implementation Order

1. **Build DB first** — Run 30 days of just Signal Collection to backtest thresholds
2. **Plan Review before Execution** — Get the "plan" part right, then worry about tranches
3. **Add notifications** — So you know it's working as designed

---

## Related Issues

### Implementation Order

**Phase 1: Foundation** (no trading changes, collect data)
| Order | Issue | Description |
|-------|-------|-------------|
| 1 | [#136](https://github.com/nicechester/atn-trd/issues/136) | Add Strategic Trading Settings |
| 2 | [#132](https://github.com/nicechester/atn-trd/issues/132) | Implement Signal Accumulation Layer |
| 3 | [#133](https://github.com/nicechester/atn-trd/issues/133) | Implement Market Regime Detection |

**Phase 2: Plan Infrastructure**
| Order | Issue | Description |
|-------|-------|-------------|
| 4 | [#134](https://github.com/nicechester/atn-trd/issues/134) | Implement Strategic Plans & Tranched Execution |
| 5 | [#138](https://github.com/nicechester/atn-trd/issues/138) | Handle Edge Cases: Chunky Stocks, Hysteresis, Partial Fills |

**Phase 3: Cut Over** (replace reactive cycle)
| Order | Issue | Description |
|-------|-------|-------------|
| 6 | [#135](https://github.com/nicechester/atn-trd/issues/135) | Refactor Trading Cycle to Plan-Driven Execution |
| 7 | [#139](https://github.com/nicechester/atn-trd/issues/139) | Refinements: Signal Decay, Regime Delay, Sector Caps, Notifications |

**Phase 4: Visibility**
| Order | Issue | Description |
|-------|-------|-------------|
| 8 | [#145](https://github.com/nicechester/atn-trd/issues/145) | Add Portfolio Reset and Manual Trading Capabilities |
| 9 | [#137](https://github.com/nicechester/atn-trd/issues/137) | Add Strategic Plans UI Components |

**Epic**: [#131](https://github.com/nicechester/atn-trd/issues/131) - Architecture: Strategic Plan-Based Trading System

---

## UI Components

### Dashboard
Shows execution mode context:
- **Strategic Plans mode**: Shows FinBERT for signals, LLM for screener (on-demand)
- **Trading Cycle mode**: Shows LLM model for analyst/PM
- Daily LLM costs (from screener runs in strategic mode)

### Plans Page
- Active/Paused plan cards with progress bars
- "Run Planner" button triggers signal collection + plan review
- Shows planner results: regime, watchlist count, positions count, plans created/skipped

### Watchlist Page
- "Run Screener" button (dynamic mode only) populates watchlist
- Shows symbol categories (GROWTH_CORE, DIVIDEND_GROWTH, INCOME_BOOSTER)
- Plan status per symbol

### Job History (Runs)
- Different layout for strategic jobs vs trading cycle runs
- Strategic jobs show summaryJson (regime, counts, skip reasons)
- Trading cycle runs show assessments, decisions, orders, transcript

---

## Future Enhancements

- **Issue #155**: Enhanced signal collection with LLM + FinBERT (better signal quality)
- **Issue #152**: Rename Runs to Job History with job type filter
- **Issue #153**: On-demand LLM-powered Reports (synthesized insights)

---
[← Future Improvements](07-future-improvements.md) · [back to index](README.md)
