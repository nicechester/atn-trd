# Analysis — Strategic Trading Plan Backtest

[← back to index](README.md)

> Backtest of [08 — Strategic Plan-Based Trading](08-strategic-trading.md) against 19 years of S&P 500 history.
> **Window:** 2007-01-03 → 2026-09-04 · **Universe:** 503 symbols · **Sessions:** 4,950

---

## Verdict

The plan is **a risk-control system, not a return-generation system** — and it is worth keeping on those terms. Against the same universe it trades, it gives up 2.3 points of annual return to buy roughly **17 points less drawdown**.

Two components carry that: the regime gate and tranching. Three components — the sector cap, the 3-day regime confirmation, and the auto-hedge — pay for nothing. And `buyThreshold: 0.70` is arithmetically unreachable as the composite score is currently defined.

| Metric | Strategy | PIT universe EW | SPY B&H |
|--------|----------|-----------------|---------|
| CAGR | **11.20%** | 13.46% | 11.00% |
| Max drawdown | **−35.3%** | −52.1% | −55.2% |
| Sharpe | **0.73** | 0.71 | 0.63 |

*Point-in-time S&P 500 membership. "PIT universe EW" is an equal-weight portfolio of the same symbols the strategy is allowed to trade.*

---

## 1. The number that changed everything

The first run of this backtest returned **25.3% CAGR** against SPY's 11.0%. That result was an artifact, and finding out why is the most useful thing in this report.

The universe was today's S&P 500 membership applied backwards to 2007. But 276 of those 503 companies joined the index *after* 2007, and index addition is a post-hoc event that follows a large run-up. A rank-momentum selector doesn't dilute that bias across the universe the way an equal-weight benchmark does — it concentrates directly on it. In the biased run, **47% of all buy trades were in names that were not yet index members on the trade date**: NFLX, BLDR, TPL, URI, NVDA, AXON, CVNA.

Masking each symbol until its actual index-addition date collapses the result. Every number below comes from the point-in-time run.

| Universe construction | Strategy | EW benchmark | Spread |
|-----------------------|----------|--------------|--------|
| Today's members, applied backwards | 25.29% | 16.38% | +8.91 pp |
| **Point-in-time membership** | **12.54%** | **13.46%** | **−0.93 pp** |

*Point-in-time masking removes 12.8 points from the strategy but only 2.9 from the benchmark — the gap was the bias, not the edge. The PIT universe is still survivorship-biased on the deletion side, so 13.46% remains a generous benchmark.*

> **Implication for issue [#131](https://github.com/nicechester/atn-trd/issues/131)**
> Success criterion "Historical signal data enables backtesting" is checked off in the doc. It shouldn't be — not until the backtest harness reads point-in-time index membership. Any threshold tuned on a survivor universe will be tuned to a fiction.

---

## 2. Component ablation

Each row removes exactly one mechanism from the plan and re-runs the full 19 years. Read the drawdown column, not the CAGR column — that is where this system does its work.

| Configuration | CAGR | Max DD | Sharpe | Trades | Action days | Verdict |
|---------------|-----:|-------:|-------:|-------:|------------:|---------|
| **Full plan as designed** | **11.20%** | **−35.3%** | **0.73** | **7,045** | **45.6%** | — |
| − regime gate | 12.31% | −57.5% | 0.62 | 9,050 | 52.2% | ✅ Keep |
| − tranching (single shot) | 9.19% | −41.1% | 0.62 | 1,592 | 14.7% | ✅ Keep |
| − TRIM plans | 11.12% | −47.8% | 0.68 | 144 | 0.8% | ✅ Keep |
| − hysteresis bands | 10.22% | −38.4% | 0.68 | 9,503 | 51.1% | ✅ Keep |
| + conviction scaling | 11.88% | −36.0% | 0.76 | 8,552 | 50.1% | ✅ Adopt |
| − EWMA decay (α=0.1) | 11.35% | −32.7% | 0.76 | 11,339 | 61.8% | ⚠️ Retune |
| − 3-day regime confirmation | 11.19% | −35.9% | 0.74 | 6,914 | 45.9% | ❌ Cut |
| − sector cap (30%) | 12.11% | −35.8% | 0.75 | 7,306 | 46.4% | ❌ Cut |
| − auto-hedge (GLD) | 12.54% | −38.4% | 0.68 | 9,429 | 52.8% | ⚠️ Retune |
| *Benchmark: PIT universe, equal weight* | *13.46%* | *−52.1%* | *0.71* | — | — | |
| *Benchmark: SPY buy & hold* | *11.00%* | *−55.2%* | *0.63* | — | — | |

*All variants: point-in-time universe, signals lagged one day, 5 bp one-way slippage, $100k start, 20 concurrent plans at 5% target weight. "Action days" is the share of sessions with at least one fill.*

**The regime gate is the single biggest contributor**, and it earns its keep in a way the doc doesn't anticipate: removing it *raises* return by 1.1 points while blowing drawdown out from −35% to −57%. That's the trade the whole architecture exists to make.

**TRIM is the other load-bearing piece** — without it the system deploys its capital in the first months and never recycles it, which is why the no-TRIM row shows 144 trades across nineteen years and −47.8% drawdown.

The **sector cap costs 0.9 points of return and buys 0.5 points of drawdown** — close to pure drag at the 30% level, and tightening it to 20% makes things worse (10.56% / −34.9%). At 20 concurrent positions the portfolio is already diversified; the cap binds on the sector that happens to be working. Issue [#171](https://github.com/nicechester/atn-trd/issues/171) is not worth building at 0.30.

---

## 3. The regime detector fires at bottoms, not tops

This is the most counterintuitive result in the study, and it has direct consequences for issues [#170](https://github.com/nicechester/atn-trd/issues/170) and [#173](https://github.com/nicechester/atn-trd/issues/173).

Tested as a standalone market-timing signal against next-day SPY returns, `RISK_OFF` is not a warning — it's a *buy* signal. Days flagged `RISK_OFF` were followed by the highest forward returns in the sample; days flagged `RISK_ON` by the lowest.

| Regime state | Days | Fwd return (ann.) | Read |
|--------------|-----:|------------------:|------|
| `RISK_ON` | 3,227 | +8.6% | lowest in sample |
| `NEUTRAL` | 1,238 | +12.9% | — |
| `RISK_OFF` | 633 | **+42.6%** | highest in sample |
| ↳ 1–2 day spike | 109 | **−17.3%** | the only bearish subset |
| ↳ 3-day confirmed | 524 | +59.8% | what the doc acts on |

*Annualized next-session SPY return conditioned on regime state. The `RISK_OFF` threshold set at VIX > 25 is, empirically, a volatility-risk-premium harvesting signal.*

The **3-day confirmation delay actively removes the only predictive part of the signal.** Unconfirmed 1–2 day `RISK_OFF` spikes — exactly what `shouldPausePlans()` is designed to filter out — are the one subset followed by *negative* forward returns (−17.3% annualized). The confirmed episodes it lets through are followed by +59.8%. In the full strategy, dropping the confirmation from 3 days to 1 changes nothing measurable (11.19% vs 11.20%).

The reason the gate still helps the portfolio is that **it pauses buying rather than selling.** It's a position-sizing brake, and a brake doesn't need to predict direction to reduce damage. Sold as market timing, it fails: routing SPY to cash on `RISK_OFF` returns 7.5% CAGR against 11.0% for holding.

| Indicator | Days triggered | Fwd return when triggered | Fwd return otherwise |
|-----------|---------------:|--------------------------:|---------------------:|
| `vix > 25` | 880 | +31.4% | +10.0% |
| `vix > 35` | 253 | +102.6% | +10.0% |
| `yieldCurve < 0` | 807 | +18.3% | +12.5% |
| `breadth < 0.40` | 797 | +26.3% | +11.1% |

*Each indicator from the doc's regime table, evaluated independently. All four are contrarian — every trigger condition is followed by above-average returns.*

> **Auto-hedge — issues [#170](https://github.com/nicechester/atn-trd/issues/170) and [#173](https://github.com/nicechester/atn-trd/issues/173)**
> Rotating into GLD when the detector says `RISK_OFF` means buying gold at the moment equities have historically been most attractive. With hedging enabled the strategy returns 11.20% against 12.54% with it off, for 2.5 points of drawdown relief — the worst risk-adjusted trade in the whole ablation table.
> Also worth knowing: the gate condition `cash > 20%` is nearly unreachable in practice. Median cash on `RISK_OFF` days is 19.5%, sitting just under its own trigger. In the original run the hedge fired **zero times in 19 years**.

---

## 4. `buyThreshold: 0.70` cannot be reached

This is an arithmetic bug, not a calibration preference. The composite is defined as:

```
composite = 0.4 × sentiment + 0.3 × sentiment_trend + 0.3 × price_momentum
```

with `price_momentum` documented as "price vs 50-day SMA, % above/below". Across 2.3 million symbol-days, that quantity has a median of **0.016** and a 95th percentile of **0.130**. Its weighted contribution at the 95th percentile is `0.3 × 0.130 =` **0.039**.

So a symbol in the top 5% of momentum still needs the two sentiment terms to supply 0.661 of the 0.70 threshold. If sentiment and its trend are equal, that requires a FinBERT score of **0.944 on a scale that maxes at 1.0** — sustained, not a single headline. With neutral sentiment the composite has never once reached 0.70 in nineteen years of data; its maximum possible value is 0.56.

There is a second scale problem underneath it. `sentiment_trend` is specified as a "14-day slope" with no units. A per-day slope of a series bounded in [−1, 1] lands around ±0.02; a 14-day total change lands around ±2.0. Those two readings differ by a factor of 100, and the doc doesn't say which one `signal_snapshots.sentiment_trend` stores.

> **Fix**
> Normalize every component cross-sectionally to [−1, 1] before weighting — rank each symbol against the watchlist that day. Thresholds then mean "top ~15% of the watchlist" instead of an absolute score no combination of inputs produces. Every backtest in this report uses that normalization; without it the system executes zero trades.

---

## 5. How good does FinBERT have to be?

Historical news sentiment can't be reconstructed for 500 symbols across 19 years, so the sentiment terms were simulated instead: a signal built from forward returns blended with noise, tuned to a target information coefficient, then run through the plan's real machinery at matched threshold-crossing rates.

| Sentiment IC | Realized composite IC | Strategy CAGR | vs momentum-only |
|-------------:|----------------------:|--------------:|-----------------:|
| 0.00 | −0.016 | 21.98% | −4.3 pp |
| 0.02 | −0.004 | 25.02% | −1.2 pp |
| **0.05** | **0.017** | **26.09%** | **−0.1 pp** |
| 0.08 | 0.038 | 28.44% | +2.2 pp |
| 0.10 | 0.051 | 32.86% | +6.6 pp |
| 0.15 | 0.086 | 34.75% | +8.5 pp |
| 0.20 | 0.120 | 36.10% | +9.9 pp |
| 0.30 | 0.193 | 42.12% | +15.9 pp |
| *momentum only* | *−0.019* | *26.23%* | — |

*Levels sit on the survivorship-biased universe — read the crossing point, not the absolute returns. Published FinBERT-on-headlines ICs against daily forward returns typically fall in the 0.01–0.04 band, i.e. below break-even.*

Sentiment has to reach an IC of roughly **0.05** before the 0.4/0.3 weighting beats simply using momentum alone. Below that, allocating 70% of the composite to sentiment is *worse than not having it*: at IC = 0, the system returns 22.0% against momentum-only's 26.2% on the same universe. Diluting a working signal to 30% weight in favor of noise costs about four points a year.

Two caveats, pulling in opposite directions. The simulated `sentiment_trend` leg is derived from the same oracle, so it carries forward information a real 14-day change wouldn't — which makes 0.05 an *optimistic* floor. Against that, the achieved IC ran roughly 15–25% below its label, which pushes the true crossing point slightly down. Call it 0.05 with a wide band, and note that it sits at or above the top of what headline-level FinBERT typically delivers.

Separately: the plan's own EWMA works against noisy signals in a way worth knowing. At α = 0.1, a signal whose cross-sectional rank flips daily gets smoothed toward zero and never crosses the threshold at all. Before the turnover-matching correction, the low-IC variants executed 15–68 trades in nineteen years. **EWMA doesn't just damp noise — on an unskilled signal it silences the system entirely.** That's arguably a safety feature, but it isn't the documented intent.

---

## 6. Where the results come from

Performance is not evenly distributed, and the pattern is consistent with the risk-control reading rather than a return edge.

| Period | Strategy | PIT universe EW | SPY |
|--------|---------:|----------------:|----:|
| 2007–2009 · GFC | +1.6% / −35.3% | +1.6% / −52.1% | −5.6% / −55.2% |
| 2010–2014 · recovery | +5.5% / −23.1% | +19.3% / −20.7% | +15.0% / −18.6% |
| 2015–2019 · grind | +9.9% / −14.4% | +13.5% / −18.1% | +11.6% / −19.3% |
| 2020–2022 · COVID + rates | +6.5% / −19.1% | +11.7% / −38.7% | +7.3% / −33.7% |
| 2023–2026 · AI cycle | +34.5% / −21.0% | +17.0% / −17.4% | +22.7% / −18.8% |

*CAGR / max drawdown by sub-period.*

2007–2009 is the clearest case for the architecture: the same return as the universe with 17 points less drawdown, while SPY lost money. 2010–2014 is the clearest cost: 5.5% against the universe's 19.3%, because the regime gate spent the recovery paused. **The 2023–2026 outperformance is one period out of five and should not be extrapolated** — a top-30 momentum book in an AI-led market is a known regime, not a validated edge.

Parameter sweeps were flat, which is a good sign for robustness and a bad sign for the specific defaults:

- `buyThreshold` from 0.50 to 0.90 spans 11.20%–12.66%.
- `minDaysBetweenTranches` from 1 to 42 spans 10.00%–11.86% — with the **longest** spacing scoring best on both drawdown (−30.5%) and Sharpe (0.80).
- `defaultTrancheCount` of 4 is a genuine optimum — 1 and 8 are both worse.

No parameter sits on a cliff; none of the documented defaults sits on a peak either.

---

## 7. "Most days, no action" is not what the parameters produce

The doc's central philosophy is patience: *"Could be weeks of nothing, then action."* The success criteria list "System can go weeks without trading" as met.

Run as specified, the system trades on **45.6% of sessions** — a median of roughly 370 fills a year, and the longest quiet stretch is nowhere near weeks. Nothing is broken; the arithmetic just doesn't produce what the prose promises. Twenty concurrent plans, each firing a tranche every five days, is four fills per day in expectation. Patience at the level of an individual plan does not aggregate to patience at the level of the portfolio.

This matters because it's the assumption behind issue [#174](https://github.com/nicechester/atn-trd/issues/174). Waiting notifications designed for a system that acts a few times a month will behave differently in a system that acts most days. Either accept that the portfolio is continuously active and scope the notifications to per-plan state, or cut concurrency hard — at 20 positions and 5% target weight the book is fully deployed, and the engine logged **21,841 "insufficient cash" skips**. The chunky-stock edge case in §1 of the doc isn't an edge case; it's the steady state.

---

## 8. What to change

| Action | Item | Rationale | Evidence |
|--------|------|-----------|----------|
| ❌ **Cut** | Auto-hedging — [#170](https://github.com/nicechester/atn-trd/issues/170), [#173](https://github.com/nicechester/atn-trd/issues/173) | Trigger fires when equities are historically most attractive. The `cash > 20%` gate is unreachable at documented position sizing. The regime pause already captures the defensive benefit. | 11.20% / −35.3% with · 12.54% / −38.4% without |
| ❌ **Cut** | Sector caps at 0.30 — [#171](https://github.com/nicechester/atn-trd/issues/171) | Costs 0.9 pp return for 0.5 pp drawdown; tightening to 0.20 makes both worse. 8,035 tranches blocked over the run. Cap by position count instead if concentration needs addressing. | 0.20: 10.56% · 0.30: 11.20% · 0.50: 12.13% · uncapped: 12.11% |
| ❌ **Cut** | The 3-day regime confirmation | Filters out precisely the 1–2 day VIX spikes that are the only bearish subset, with no measurable portfolio effect. Act on regime immediately, or drop `regime_streak`. | 3-day: 11.20% / −35.3% · 1-day: 11.19% / −35.9% |
| ⚠️ **Fix** | Rescale the composite — do this first | Cross-sectionally normalize sentiment, trend and momentum to [−1, 1] against the watchlist daily, then weight. Pin the units of `sentiment_trend` in `signal_snapshots`. Until this lands every downstream threshold is meaningless. | momentum's weighted contribution at p95: 0.039 of the required 0.70 |
| ⚠️ **Fix** | Make the backtest harness point-in-time | Feed it historical index membership before tuning anything. Thresholds optimized against the survivor universe are optimized against the bias. | 25.29% survivor → 12.54% point-in-time |
| ✅ **Adopt** | Conviction-scaled tranches — [#172](https://github.com/nicechester/atn-trd/issues/172) | Best standalone improvement in the study: +0.7 pp CAGR and the highest Sharpe of any variant, drawdown flat. The formula in §6 of the doc works as written. Promote above #170 and #171. | 11.88% / −36.0% / 0.76 vs 11.20% / −35.3% / 0.73 |
| ⚠️ **Test** | Widen tranche spacing | `minDaysBetweenTranches` of 42 produced the best drawdown and Sharpe in the sweep. Cheaper to test than any new component, and moves the system toward the patience the doc describes. | 5 days: 11.20% / −35.3% / 0.73 · 42 days: 11.86% / −30.5% / 0.80 |
| ⚠️ **Decide** | Whether sentiment earns 70% of the composite | Measure the FinBERT pipeline's realized IC against forward returns on the signal data already being collected. Below ~0.05 the weights destroy value and momentum should carry the composite. Scope [#155](https://github.com/nicechester/atn-trd/issues/155) as a measurement task first. | IC 0.00: 22.0% · IC 0.05: 26.1% · momentum-only: 26.2% |

### Revised build order

```
1. Rescale composite (blocks everything downstream)
2. Point-in-time backtest harness
3. #172 conviction-scaled tranches
4. Measure FinBERT IC  →  decide on #155
5. #169 watchlist pruning
6. #174 waiting notifications (rescoped to per-plan state)

Dropped: #170, #171, #173, regime_streak confirmation
```

---

## Method

Daily adjusted closes, 503 current S&P 500 constituents plus `^VIX`, `^TNX`, `^IRX`, `SPY`, `GLD`, `TLT`, `SHY`. Symbols masked until their index-addition date. Signals computed on close *t−1* and executed at close *t*. 5 bp one-way slippage, no commissions or borrow costs. $100k initial capital, 20 concurrent plans at 5% target weight, 4 tranches, 5-day minimum spacing.

Regime uses 10Y−3M as the curve spread — the 2Y series specified in the doc isn't available from this data source, and 10Y−3M is the better-documented recession signal regardless.

### Known limitations

- The point-in-time universe corrects for index **additions but not deletions** — companies removed from the index aren't in the membership file, so delisting and post-removal losses are absent. 13.46% remains a generous benchmark.
- Sentiment results are **simulations, not measurements**.
- Sub-period results are single-path; no bootstrap confidence intervals were computed.
- Every conclusion here is about historical behavior. None of it is investment advice.

---
[← Strategic Plan-Based Trading](08-strategic-trading.md) · [back to index](README.md)
