# Project Status — August 2026

[← back to index](README.md)

## Overview

**atn-trd** is an autonomous, LLM-driven stock research and paper-trading system. **Phase 2 is substantially complete** (risk filtering + free news infrastructure); **Phase 3** (backtesting, embeddings, screener agent) is queued; **Phase 4** (multi-agent debate, event triggers) deferred.

---

## Phase 1 — Skeleton, Persistence, Settings UI ✅ COMPLETE

**Status:** Shipped and validated

**Delivered:**
- SQLite persistence with migrations (02_trading.sql deployed)
- Full settings schema (trading, watchlist, dataSources, LLM, risk, schedule)
- React web UI for configuration
- Data source health checks (news, fundamentals, macro, options)
- OpenAI integration with credential management
- Market calendar with holiday awareness
- Single Docker container deployment

**Key files:** `server/src/config/settingsService.ts`, `server/src/db/`, `web/src/pages/Settings*`

---

## Phase 2 — Autonomous Trading Cycle ✅ MOSTLY COMPLETE

### Completed (Merged to main)

#### ✅ #85 — Volatility Calculation Service
- **Status:** Merged (commit f7279fc)
- **What:** Historical volatility metrics (20d, 60d annualized)
- **Files:**
  - `server/src/services/volatilityService.ts` — Core calculations
  - `server/src/services/volatilityService.test.ts` — 9 passing tests
  - `server/src/agent/tools.ts` — Integrated `get_volatility` agent tool
- **Caching:** 300-second TTL for performance
- **Integration:** Risk engine filters by `maxVolatility`, analyst uses for confidence
- **Testing:** Production verified (5m 23s run, 11 symbols)

#### ✅ #86 — RSS Feed News Ingestion (Free, Unlimited)
- **Status:** Merged (commit 92e9d37)
- **What:** Free alternative to paid news APIs (Finnhub, Yahoo)
- **Feed sources:**
  - **Ticker news:** Google News, Yahoo Finance RSS, Seeking Alpha
  - **Macro:** Federal Reserve, CNBC
  - **Filings:** SEC 8-K, SEC 10-Q
- **Files:**
  - `server/src/datasources/news/rssNews.ts` — RSS connector (298 lines)
  - `server/src/datasources/news/rssNews.test.ts` — 6 passing tests
  - `server/src/datasources/news/index.ts` — RssPrimaryDataSource with fallback
- **Strategy:** RSS primary (free), Finnhub fallback (sentiment enrichment)
- **Testing:** Production verified (11 symbols, 20+ articles each from RSS)

### Remaining Phase 2 Issues

All core Phase 2 infrastructure now complete. The system:
- ✅ Runs daily trading cycles
- ✅ Calculates risk metrics (volatility, position sizing)
- ✅ Fetches news from multiple sources (RSS primary, fallback APIs)
- ✅ Routes through analyst agents
- ✅ Executes portfolio manager decisions
- ✅ Tracks P&L and positions
- ✅ Persists research artifacts

**Code quality:** TypeScript strict mode, full test coverage, production tested

---

## Phase 3 — Advanced Autonomy 🔄 IN PROGRESS

**4 open issues, 3 unassigned** (1 completed: backtesting)

### Completed

#### ✅ #66 — Backtesting Infrastructure
- **Status:** Merged (commit 6c3186e, "Phase 3: Backtesting Infrastructure")
- **What:** Replay historical data to validate strategy performance
- **Scope:** BacktestRunner (date range, mock datasources, P&L metrics)
- **Features:**
  - Historical price data replay via Alpaca backfill
  - Buy-and-hold strategy simulation
  - Performance vs SPY benchmark
  - Sharpe/Sortino ratios, max drawdown tracking
  - Auto-backtest debounce (configurable interval)
- **Files:** `server/src/backtest/`, `server/src/routes/backtest.ts`, `server/src/repos/backtestRepo.ts`
- **Database:** `006_backtest.sql` migration deployed
- **Testing:** Integrated with settings, runs via `/api/backtest` endpoint
- **Related:** #93 (Semantic Memory) split from this issue for agent learning

### High Priority (Remaining)

#### #67 — Embedding Store for Historical Context `[senior]`
- **What:** Vector search over past assessments for "similar situations"
- **Implementation:** sqlite-vss or ChromaDB
- **Complexity:** Medium (embedding model calls, index maintenance)
- **Impact:** Enables agent learning and improved risk assessment

#### #67 — Embedding Store for Historical Context `[senior]`
- **What:** Vector search over past assessments for "similar situations"
- **Implementation:** sqlite-vss or ChromaDB
- **New tool:** `get_similar_situations({ symbol, description })`
- **Complexity:** Medium (embedding model calls, index maintenance)
- **Impact:** Enables agent learning and improved risk assessment

#### #79 — Autonomous Watchlist Selection (Screener Agent) `[senior]`
- **What:** Auto-populate watchlist based on screens (not manual entry)
- **Scope:** Sector bias, fundamentals filters, technical screens
- **Integration:** Runs before analyst agents
- **Complexity:** Medium (new agent type, screening logic)
- **Impact:** Reduces manual configuration, enables dynamic universe

### Medium Priority

#### #92 — Local ML Sentiment (FinBERT) `[enhancement]`
- **What:** Replace Finnhub sentiment with local transformer model
- **Implementation:** FinBERT on news headlines
- **Benefit:** No API cost, offline, faster
- **Complexity:** Low (model wrapper, integration)
- **Impact:** Reduces dependency on paid APIs

#### #93 — Semantic Memory for Agent Learning `[phase-3]`
- **What:** Persistent memory of agent decisions + outcomes (split from #66)
- **Dependency:** Requires backtesting (#66) to validate learned patterns
- **Use case:** "What did we decide last time this symbol was like this?"
- **Storage:** Vector DB + structured memory
- **Complexity:** Medium
- **Impact:** Improves agent consistency over time through historical pattern matching

---

## Phase 4 — Multi-Agent & Event-Driven ⏳ DEFERRED

**3 open issues, unassigned**

These require Phase 3 completion and are stretch goals for autonomous sophistication.

#### #71 — Phase 4 Capabilities (Overview)
- Strategic container for Phase 4 initiatives

#### #72 — Multi-Agent Debate (Bull vs Bear) `[senior]`
- **What:** Run adversarial analysts per symbol, PM synthesizes
- **Cost:** 2-3x tokens, mitigates confirmation bias
- **Complexity:** Medium (parallel agents, schema changes)
- **Target:** High-conviction positions only

#### #73 — Event-Driven Runs `[senior]`
- **What:** Trigger analysis on earnings, Fed days, VIX spikes, price gaps
- **Guard:** `minIntervalHours` prevents runaway costs
- **Complexity:** Medium (event detection, partial-run logic)
- **Benefit:** Captures intraday catalysts beyond daily cadence

---

## Data Model & Architecture

**Key tables (deployed):**
- `settings` — user configuration
- `runs` — trading cycle executions
- `agent_messages` — LangGraph transcript
- `research_artifacts` — news, fundamentals, macro, options payloads
- `symbol_assessments` — analyst output per symbol
- `trading_decisions` — portfolio manager output
- `orders` — submitted to PaperBroker
- `fills` — order executions
- `positions` — current holdings
- `portfolio_snapshots` — daily NAV + P&L

**See:** [01 — Data Model](01-data-model.md), [02 — Broker & Data Sources](02-broker-and-data-sources.md)

---

## Development Workflow

### Current Branches

- `main` — production (Phase 2 complete)
- Feature branches for each issue (e.g., `issue-86-rss-feed-news-ingestion`)

### Testing & Validation

- **Unit tests:** TypeScript strict mode, test suites for each service
- **Integration tests:** Full trading cycles with mock data
- **Production tests:** Manual runs via `/api/runs` endpoint, logs verified
- **Build:** `npm run build` compiles all workspaces

### Deployment

```bash
docker build -t atn-trd .
docker run -v ./data:/data \
  -e ATN_ENC_KEY=<generated> \
  -e OPENAI_API_KEY=<your-key> \
  -p 8080:8080 atn-trd
```

**Configuration:** Web UI at `/settings`, live test connections to all data sources

---

## Known Limitations & Deferred Work

**By design (Phase 1 scope):**
- No real brokerage integration (PaperBroker only)
- No intraday trading (daily cadence only)
- Daily snapshots only (not minute-level data)
- No supply-chain audit (agent decisions not fully explainable)

**Deferred to Phase 3/4:**
- Backtesting infrastructure
- Multi-agent debate
- Event-triggered runs
- Vector store for historical context
- Real broker adapters

**See:** [06 — Edge Cases & Out of Scope](06-edge-cases-and-scope.md)

---

## Next Steps

**To start Phase 3:**
1. Assign one of: #66 (backtesting), #67 (embeddings), #79 (screener)
2. Follow same workflow: `/tackle <issue-number>` → feature branch → PR → merge
3. Each should take 2-4 hours depending on complexity

**To start Phase 4:**
- Requires Phase 3 completion (backtesting validated strategy)
- Costs 2-3x token budget (debate mode, event polling)
- Deferred until Phase 3 business value proven

---

**Last updated:** 2026-08-22 (Phase 2 complete)

[← back to index](README.md) · [next: Future Improvements →](07-future-improvements.md)
