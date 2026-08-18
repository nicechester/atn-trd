# 05 — Implementation Plan

[← back to index](README.md)

Steps are phase-tagged and role-tagged (`[senior]`/`[junior]`) per this
project's routing convention (junior = mechanical/small edits, senior =
multi-file/cross-cutting/service-layer work). Phase 1 should be handed to
programmer agents first and validated before Phase 2 starts.

## Phase 1 — Skeleton, persistence, settings UI (ship and validate before Phase 2)

1. `[junior]` Init repo: `git init`, root `package.json` with npm workspaces
   `["shared","server","web"]`, `tsconfig.base.json`, `.gitignore`,
   `.dockerignore`, `.env.example`, README stub. Root scripts: `build` =
   shared → web → server, `dev`, `typecheck`.
2. `[junior]` Scaffold `shared/` workspace: `package.json`, `tsconfig.json`,
   empty `src/index.ts`. Scaffold `web/` via Vite React-TS template with a
   `/api` dev proxy. Scaffold `server/` package.json mirroring lexchat's
   deps (add `croner`, `yahoo-finance2`; drop MCP/Atlassian deps).
3. `[senior]` `shared/src/settings.ts`: the complete zod `SettingsSchema` +
   `DEFAULT_SETTINGS`, covering trading, watchlist behavior, dataSources,
   llm (OpenAI), schedule, risk, paper. Include the `minIntervalHours` cron
   refinement from doc 03. Every field needs a `.default()` so old docs
   upgrade cleanly. Also `shared/src/domain.ts` and `api.ts`.
4. `[senior]` `server/src/db/index.ts` (open, WAL, foreign_keys pragma) +
   `db/migrate.ts` (numbered runner, `schema_migrations`) +
   `db/migrations/001_init.sql` per doc 01 Migration 001.
5. `[senior]` `server/src/lib/secretBox.ts` — port lexchat's
   `secretBox.ts`, renaming the env var to `ATN_ENC_KEY` and the scrypt salt
   to `atn-trd-secrets-v1`. Keep `secretBoxAvailable()`; never fall back to
   plaintext. Add `server/src/lib/money.ts` (cents helpers, `toCents`,
   `notionalCents(qty, priceCents)`) and `lib/logger.ts`.
6. `[senior]` `config/settingsService.ts` — `getSettings()` (read doc,
   zod-parse with defaults, cache in memory, invalidate on write),
   `updateSettings(patch)` (deep merge, validate, persist, bump
   `updated_at`, emit a change event the scheduler subscribes to),
   `getSecret(name)` / `setSecret` / `clearSecret` / `listSecretStatus`, and
   `resolveSecret(name)` = DB value ?? `process.env[name]`. Plus
   `repos/settingsRepo.ts`, `secretsRepo.ts`, `watchlistRepo.ts`,
   `portfolioRepo.ts`.
7. `[senior]` `app.ts` + `main.ts`: Express factory with JSON body limit,
   error middleware mapping typed errors to status codes, `ATN_ROLE` gate,
   static/Vite serving per doc 04, migrations before `listen`.
8. `[junior]` `routes/health.ts` — `GET /api/health` returning version,
   migration version, db path/size, `encKeyPresent`, uptime.
9. `[junior]` `routes/settings.ts` (`GET`/`PATCH /api/settings`) and
   `routes/secrets.ts` (`GET /api/secrets` status-only,
   `PUT /api/secrets/:name`, `DELETE /api/secrets/:name`). Never return
   secret values.
10. `[senior]` `datasources/types.ts` + `datasources/http.ts` +
    `datasources/prices/yahooPrices.ts` + `services/symbolService.ts`
    (validate symbol via `quote()`), and `routes/watchlist.ts` +
    `POST /api/symbols/validate`. This is the Phase 1 vertical slice.
11. `[senior]` `llm/openaiChatModel.ts` — use `@langchain/openai`'s
    `ChatOpenAI`, taking an explicit config object (OpenAI API key)
    with env fallback. Add `routes/llm.ts` →
    `POST /api/llm/test` doing a minimal completion and surfacing any API
    errors. Handle rate limiting.
12. `[senior]` Stub the four connectors with real `isConfigured()` +
    `healthCheck()` (a cheap real request each) and `fetch()` implemented
    for news/fundamentals/macro/options as described in doc 02 (full fetch
    is fine here since Phase 2 only wires them into tools). Add
    `routes/datasources.ts`: `GET /api/datasources` (id, provider,
    configured, enabled) and `POST /api/datasources/:id/test`.
13. `[senior]` `scheduler/marketCalendar.ts` (NYSE holidays/early closes
    through 2030, `isTradingDay`, `nextSessionOpen/Close`) and
    `scheduler/index.ts` registering jobs from settings and re-registering
    on settings change. In Phase 1 register only the snapshot job as a
    no-op placeholder; expose `getNextRuns(n)` for the UI.
14. `[senior]` Web app shell: router, nav, `api/client.ts` with typed calls
    against `shared/src/api.ts`, and the reusable `SecretField` /
    `TestButton` / `Toast` components.
15. `[junior]` Pages: `SettingsGeneral`, `SettingsWatchlist`,
    `SettingsSchedule`, `SettingsRisk`. Straight form ↔ zod ↔ API wiring
    using the components from step 14.
16. `[senior]` Pages: `SettingsDataSources`, `SettingsLlm`, `Dashboard`.
    These own the test-connection flows and health tiles.
17. `[senior]` `Dockerfile` (multi-stage per doc 04), `.dockerignore`,
    `tini`, healthcheck, `/data` volume. README: build/run commands, env
    var table, first-run instructions (generate `ATN_ENC_KEY`).
18. `[junior]` `docs/ARCHITECTURE.md` (this spec, trimmed) and
    `docs/CODING_GUIDELINES.md` (cents-not-floats, repos own SQL, routes
    call only services, connectors never throw into a run, no secrets in
    logs or API responses).

**Phase 1 done means:** `docker build && docker run -v ./data:/data -e
ATN_ENC_KEY=... -p 8080:8080`, open the UI, add a symbol and see it
validated against a live quote, enter OpenAI credentials and get a green
Test, toggle and test each data source, set a schedule and see the next 5
runs, restart the container and find everything persisted.

## Phase 2 — Autonomous trading cycle

19. `[junior]` `db/migrations/002_trading.sql` per doc 01 Migration 002.
20. `[senior]` `repos/` for runs, artifacts, agent messages, assessments,
    decisions, orders, fills, positions, prices, snapshots.
21. `[senior]` `services/priceService.ts` — read-through `price_bars` cache
    over `yahooPrices`, batch fetch, split/dividend note, plus `PriceFeed`
    interface for the broker.
22. `[senior]` `brokers/types.ts` + `brokers/paperBroker.ts` +
    `brokers/index.ts` factory, per doc 02. Include the
    `pending → accepted → filled` state machine and `clientOrderId`
    idempotency even though v1 fills at `last_close`.
23. `[senior]` `services/portfolioService.ts` — position/NAV computation
    from fills, weights, unrealized/realized P&L, `resetPaperAccount()`.
24. `[senior]` `services/snapshotService.ts` +
    `scheduler/jobs/snapshot.ts` — daily NAV + SPY snapshot at 16:45 ET,
    backfill-safe (idempotent per `as_of_date`).
25. `[senior]` `agent/runCollector.ts` — modeled on lexchat's
    `agentCollector.ts`, persisting `agent_messages` and
    `research_artifacts` from `streamEvents` `on_tool_start` /
    `on_tool_end` / `on_chat_model_stream`.
26. `[senior]` `agent/tools.ts` — the seven read-only LangChain `tool()`
    definitions from doc 03, each with a zod schema, each writing an
    artifact. Explicitly no order-placing tool.
27. `[senior]` `llm/prompts/analyst.ts` + `agent/analystAgent.ts` —
    `createReactAgent` per symbol, bounded `recursionLimit`,
    `withStructuredOutput(AssessmentSchema)`, one retry on
    schema-validation failure, graceful per-symbol failure that does not
    abort the run.
28. `[senior]` `llm/prompts/portfolioManager.ts` +
    `agent/portfolioManagerAgent.ts` — single structured-output call
    producing the `DecisionSet`.
29. `[senior]` `services/riskService.ts` — deterministic sizing/guardrails
    per doc 03 Stage C, returning `{ orders, rejections }`.
30. `[senior]` `services/tradingCycleService.ts` — the orchestrator: acquire
    the run lock, snapshot settings, resolve the watchlist, run analysts
    (bounded concurrency, e.g. 3), run the PM, run risk, submit orders
    through the `Broker`, persist everything, release the lock, handle
    timeout/partial failure.
31. `[junior]` `scheduler/jobs/tradingCycle.ts` + registration in
    `scheduler/index.ts`; holiday and kill-switch guards; `skipped` runs
    recorded with a reason.
32. `[junior]` `routes/runs.ts` (`GET /api/runs`, `GET /api/runs/:id` with
    transcript/artifacts/decisions/orders, `POST /api/runs` manual
    trigger), `routes/portfolio.ts`, `routes/trades.ts`.
33. `[senior]` Web pages: Runs list, Run detail (collapsible transcript,
    evidence with citations, assessments, decisions, resulting orders),
    Portfolio, Trades. Enable the Dashboard "Run now" button.
34. `[senior]` *(Stretch)* `routes/performance.ts` + Performance page —
    strategy vs SPY buy-and-hold from `portfolio_snapshots` /
    `benchmark_snapshots`, with total return, max drawdown, and a simple
    line chart.
35. `[senior]` *(Stretch)* `next_open` fill model: pending-order settlement
    pass on the next trading day's open.

---
[← UI & Deployment](04-ui-and-deployment.md) · [back to index](README.md) · [next: Edge Cases & Scope →](06-edge-cases-and-scope.md)
