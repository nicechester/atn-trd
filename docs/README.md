# atn-trd — Architecture & Implementation Spec

Autonomous, LLM-driven stock research and paper-trading app. A scheduler fires a
**daily** decision cycle; a LangGraph agent (backed by OpenAI) researches
watchlist symbols across four data sources, produces auditable per-symbol
assessments and a portfolio-level decision set; a deterministic risk engine
converts decisions into orders; a `PaperBroker` simulates fills against fetched
prices and tracks a virtual portfolio. A React UI configures and observes
everything. Ships as one Docker container.

**Phase 1** is a self-contained, shippable milestone: workspace skeleton, SQLite
persistence + migrations, settings service, and a complete configuration UI
working end-to-end — including live "Test connection" calls to OpenAI and each
data source. **No trading logic ships in Phase 1.** Phase 1 is validated before
Phase 2 starts.

## Documents

1. [00 — Overview & Stack](00-overview.md) — summary, stack decisions, directory/module layout
2. [01 — Data Model](01-data-model.md) — SQLite schema for both phases
3. [02 — Broker & Data Sources](02-broker-and-data-sources.md) — `Broker`/`PaperBroker` contract, the four v1 data connectors
4. [03 — Agent & Trading Design](03-agent-and-trading-design.md) — LangGraph agent, three-stage decision pipeline, daily cadence
5. [04 — UI & Deployment](04-ui-and-deployment.md) — Phase 1 web UI screens, single-container Docker setup
6. [05 — Implementation Plan](05-implementation-plan.md) — 35-step spec, phase- and role-tagged (`[senior]`/`[junior]`)
7. [06 — Edge Cases & Out of Scope](06-edge-cases-and-scope.md) — failure handling, explicit non-goals, key reference files

## Confirmed decisions (do not re-litigate)

- Two phases, in order: **configure** (Phase 1), then **autonomously trade** (Phase 2).
- **Daily** decision cadence — explicitly not intraday/minute-level.
- **Broker**: undecided real broker; v1 ships only a `PaperBroker` (ticker/price data only, no account needed) behind a `Broker` interface that a real adapter can later implement.
- **LLM backend fixed to OpenAI** — using `@langchain/openai` with proper credential management (API key). Credentials are UI-managed and persisted in settings.
- **v1 data sources**, exactly four: news headlines, company fundamentals, macro indicators, options/derivatives trends. Social sentiment, SEC filings, and deep options-flow are deferred.
- **Single Docker container** for v1 (web + API + scheduler in one process), with module boundaries kept clean enough to split later if needed.
- Portfolio/trade history is modeled from day one to support a later SPY buy-and-hold benchmark comparison (stretch goal for the UI itself).
