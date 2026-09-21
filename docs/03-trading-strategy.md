# 03 — Trading Strategy Analysis

[← back to index](README.md)

## Overview

The backtest uses a **plan-based tranche execution** strategy with **sentiment + momentum signals**. It's designed for gradual position building rather than aggressive trading.

---

## 1. Signal Generation

Each trading day, for every watchlist symbol, the system computes a **composite score** (normalized to 0–1 scale):

### 1.1 Signal Components

| Signal | Weight (default) | Source | Range |
|--------|------------------|--------|-------|
| `sentiment` | 25% | FinBERT score from news headlines | [-1, +1] → normalized |
| `sentimentTrend` | 15% | Linear regression slope of recent sentiment | [-1, +1] → normalized |
| `priceMomentum` | 15% | `(price - SMA50) / SMA50 × 5`, clamped | [-1, +1] |
| `options` | 20% | IV percentile, put/call ratio | (disabled in backtest) |
| `fundamentals` | 25% | Valuation + growth scores | (disabled in backtest) |

### 1.2 Composite Score Calculation

```typescript
// From replayRunner.ts
function computeCompositeScore(sentiment, sentimentTrend, priceVsSma50, weights) {
  let score = 0;
  let totalWeight = 0;

  if (sentiment !== null) {
    score += weights.sentiment * sentiment;
    totalWeight += weights.sentiment;
  }
  if (sentimentTrend !== null) {
    const normalizedTrend = clamp(sentimentTrend * 10, -1, 1);
    score += weights.sentimentTrend * normalizedTrend;
    totalWeight += weights.sentimentTrend;
  }
  if (priceVsSma50 !== null) {
    const normalizedMomentum = clamp(priceVsSma50 * 5, -1, 1);
    score += weights.priceMomentum * normalizedMomentum;
    totalWeight += weights.priceMomentum;
  }

  const rawScore = score / totalWeight;  // [-1, +1]
  return (rawScore + 1) / 2;             // [0, 1]
}
```

### 1.3 EWMA Smoothing

Raw composite scores are smoothed with **Exponential Weighted Moving Average** to reduce noise:

```typescript
compositeEwma = α × currentScore + (1 - α) × previousEwma
// Default α = 0.10 (slow adaptation)
```

---

## 2. Entry Logic (ACCUMULATE Plans)

### 2.1 Plan Creation

When `compositeEwma >= buyThreshold` (default: 0.70):

1. Create an **ACCUMULATE plan** for the symbol
2. Calculate conviction: `(score - buyThreshold) / (1 - buyThreshold)`
3. Calculate target weight: `min(5% × (0.5 + conviction), maxPositionWeight)`
4. Calculate target shares: `portfolioValue × targetWeight / price`

### 2.2 Tranche Execution

Plans execute in multiple tranches to reduce timing risk:

| Setting | Default | Description |
|---------|---------|-------------|
| `defaultTrancheCount` | 4 | Number of tranches per plan |
| `minDaysBetweenTranches` | 5 | Minimum days between executions |

Each tranche buys: `remainingShares / remainingTranches`

### 2.3 Plan Lifecycle

```
ACTIVE → executes tranches when:
  - compositeEwma >= pauseThreshold (0.60)
  - minDaysBetweenTranches elapsed
  - regime is not RISK_OFF

PAUSED → when:
  - compositeEwma < pauseThreshold (0.60)
  - regime is RISK_OFF

CANCELLED → when:
  - compositeEwma < cancelThreshold (0.45)

COMPLETED → when:
  - all tranches executed
```

---

## 3. Exit Logic (TRIM Plans)

### 3.1 Current Implementation

When `compositeEwma < sellThreshold` (default: 0.45):

1. Create a **TRIM plan** for the position
2. Sell in tranches (same as ACCUMULATE, but reversed)

### 3.2 Critical Gap: No Price-Based Exits

The current strategy has **no stop-loss mechanism**. Positions are only sold when:
- Sentiment score drops below threshold

Positions are **NOT** sold when:
- Price drops X% from cost basis
- Price drops X% from peak (trailing stop)
- Position has been held for too long with no progress
- Profit target is reached

---

## 4. Regime Detection

### 4.1 Risk Score Calculation

```typescript
let riskScore = 0;

// VIX contribution
if (vix > vixExtremeThreshold)      riskScore += 0.50;  // VIX > 35
else if (vix > vixRiskOffThreshold) riskScore += 0.30;  // VIX > 25

// Yield curve contribution
if (yieldCurveEnabled && yieldCurve < 0) riskScore += 0.25;  // Inverted

riskScore = min(1, riskScore);
```

### 4.2 Regime States

| Regime | Condition | Effect |
|--------|-----------|--------|
| `RISK_ON` | riskScore < 0.25 | Normal trading |
| `NEUTRAL` | 0.25 ≤ riskScore < 0.50 | Normal trading |
| `RISK_OFF` | riskScore ≥ 0.50 | Pause ACCUMULATE plans |

### 4.3 Limitation

Regime detection only **pauses new buys**. It does not:
- Force sell existing positions
- Create defensive hedge positions
- Increase cash reserves

---

## 5. Risk Management Settings

```typescript
risk: {
  maxPositionWeightPercent: 20,      // Max 20% in single position
  maxConcurrentPositions: 10,        // Max 10 positions
  maxNewPositionsPerRun: 3,          // Max 3 new positions per day
  maxNewAllocationPercentPerRun: 15, // Max 15% deployed per day
  minCashReservePercent: 10,         // Keep 10% cash
  maxOrderNotionalCents: 500000,     // Max $5,000 per order
  maxDrawdownPercent: 30,            // (not enforced in backtest)
}
```

---

## 6. Known Issues & Gaps

### 6.1 No Stop-Loss

**Problem**: Positions are held through massive drawdowns if sentiment stays positive.

**Example from backtest**:
- AAPL: -34% return despite AAPL being up ~300% in the period
- AMZN: 148 buys, 0 sells, $0 proceeds (still holding at end)

**Solution needed**: Sell if position down X% from cost basis.

```typescript
// Proposed
if ((costBasis - currentValue) / costBasis >= stopLossPercent) {
  // Force sell regardless of sentiment
}
```

### 6.2 No Trailing Stop

**Problem**: Winners can turn into losers. No mechanism to lock in profits.

**Solution needed**: Track peak value, sell if drops X% from peak.

```typescript
// Proposed
const peakValue = Math.max(currentValue, previousPeak);
if ((peakValue - currentValue) / peakValue >= trailingStopPercent) {
  // Sell to lock in remaining profit
}
```

### 6.3 No Profit-Taking

**Problem**: Winners are never trimmed. MSFT +156% was held but never reduced.

**Solution needed**: Trim positions at target gain thresholds.

```typescript
// Proposed
if (unrealizedGainPercent >= profitTargetPercent) {
  // Trim 25-50% of position
}
```

### 6.4 Slow Tranche Entry

**Problem**: 4 tranches × 5 days = 20+ days to build full position. Misses momentum in fast rallies.

**Solution needed**: Single-tranche mode for high-conviction signals.

```typescript
// Proposed
if (conviction >= highConvictionThreshold) {
  trancheCount = 1;  // Immediate full entry
}
```

### 6.5 Time-Based Exit

**Problem**: Stale positions with no progress tie up capital.

**Solution needed**: Exit positions held > N days with < X% gain.

```typescript
// Proposed
if (daysHeld >= maxHoldingDays && unrealizedGainPercent < minExpectedGain) {
  // Exit stale position
}
```

### 6.6 Sentiment-Price Disconnect

**Problem**: FinBERT sentiment doesn't correlate well with short-term price returns. Positive news ≠ price going up.

**Solution needed**: Reduce sentiment weight, increase price-based signals.

---

## 7. Proposed Settings Additions

```typescript
// In settings.signals or settings.risk
exitRules: {
  // Stop-loss
  stopLossEnabled: boolean,
  stopLossPercent: number,           // e.g., 0.10 = sell if down 10%

  // Trailing stop
  trailingStopEnabled: boolean,
  trailingStopPercent: number,       // e.g., 0.15 = sell if 15% below peak
  trailingStopActivation: number,    // e.g., 0.10 = activate after 10% gain

  // Profit-taking
  profitTakingEnabled: boolean,
  profitTargetPercent: number,       // e.g., 0.25 = trim at 25% gain
  profitTakingTrimPercent: number,   // e.g., 0.50 = trim 50% of position

  // Time-based
  maxHoldingDays: number,            // e.g., 90 = exit after 90 days
  minExpectedGainForHold: number,    // e.g., 0.05 = need 5% gain to keep holding
}
```

---

## 8. Backtest Results Analysis

### 8.1 Sample Run: "top 20 on s&p 500 at 2019"

| Metric | Strategy | Benchmark (SPY) |
|--------|----------|-----------------|
| Total Return | 34.01% | 96.15% |
| Max Drawdown | -22.83% | — |
| Sharpe Ratio | 0.12 | — |
| Sortino Ratio | 0.16 | — |
| Win Rate | 49.14% | — |
| Total Trades | 1,759 | — |

### 8.2 Per-Symbol Analysis

| Symbol | Return | Trades | Issue |
|--------|--------|--------|-------|
| MSFT | +156% | 19 | ✓ Winner, but few trades (slow entry) |
| LLY | +122% | 41 | ✓ Winner |
| AAPL | -34% | 57 | ✗ Held through drawdowns |
| NEE | -25% | 37 | ✗ No stop-loss |
| PFE | -17% | 59 | ✗ No stop-loss |
| AMZN | null | 148 | ✗ 148 buys, 0 sells, still holding |
| MCD | null | 3 | ✗ Still holding |
| WMT | null | 4 | ✗ Still holding |

### 8.3 Root Causes of Underperformance

**Primary cause: Symbol selection, not strategy flaws.**

Comparison of two runs with identical settings:

| Run | Symbols | Return | vs SPY |
|-----|---------|--------|--------|
| CLI (NASDAQ tech) | 22 | +175% | +79% |
| Top 20 SP500 | 51 | +34% | -62% |

The CLI run included high-growth tech (NVDA +73%, AMD +82%, MSFT +128%) while SP500 run included value traps (T, VZ, KO, PFE, IBM, XOM).

**Even in the winning CLI run, the strategy showed the same behaviors:**
- AAPL: -7.5% (held through drawdowns)
- TSLA: -12.7% (no stop-loss)
- AMZN: still holding at end (no sells triggered)
- INTC: -7.7%

The winners were simply large enough to overwhelm the losers.

**Secondary cause: Missing price data.**
- BRK.B, UNH, VZ had no data in fnspid.db
- These symbols consumed capital allocation but generated no returns

**Strategy limitations (real but not primary cause):**
1. No stop-loss — holds losers, but winners can compensate
2. No profit-taking — but in trending markets, holding winners works
3. Slow tranche entry — but reduces risk in volatile markets
4. Sentiment-only exits — works when sentiment correlates with sector performance

---

## 9. Recommendations

### High Impact (Symbol Selection)

1. **Focus on growth/momentum sectors**: NASDAQ tech outperformed significantly
2. **Avoid value traps**: Telecom (T, VZ), legacy pharma (PFE, MRK), old tech (IBM)
3. **Validate data coverage**: Ensure all symbols have price data before running
4. **Smaller watchlist**: 20-25 high-conviction symbols beats 50 diversified

### Medium Impact (Strategy Tuning)

5. **Add stop-loss**: 15-20% hard stop — safety net for sector downturns
6. **Add trailing stop**: Lock in gains during momentum reversals
7. **Reduce symbol count**: Concentration in winners > diversification across laggards

### Lower Priority (Nice to Have)

8. **Profit-taking**: Less critical in trending markets, but useful for mean-reversion
9. **Faster entry**: Single-tranche for high conviction
10. **Time-based exit**: Clean up stale positions

---

[← back to index](README.md) · [next: Backtest Guide →](04-backtest-guide.md)
