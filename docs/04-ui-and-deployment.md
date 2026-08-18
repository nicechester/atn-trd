# 04 — Phase 1 Web UI & Deployment

[← back to index](README.md)

## Phase 1 web UI

Phase 1 is complete and shippable when these render, persist, and round-trip
through the API. No trading logic required.

1. **Dashboard (shell)** — trading enabled/disabled, mode badge, next
   scheduled run (from `croner.nextRun()`), last run (empty in Phase 1),
   data-source health tiles, "Run now" button rendered **disabled** with
   "Available in Phase 2".
2. **Settings → General & Trading** — mode `paper` / `live` (`live` disabled
   with an explanatory tooltip), starting cash, base currency, global kill
   switch, "Reset paper account" (destructive, confirm dialog).
3. **Settings → Watchlist** — add/remove/enable symbols; add validates via
   `POST /api/symbols/validate` (a real `yahoo-finance2` `quote()` lookup
   returning name + last price). Best Phase 1 end-to-end vertical slice.
4. **Settings → Data Sources** — per-source enable toggle, provider select
   (news: Finnhub | Yahoo), API-key entry using a write-only `SecretField`
   (shows `••••••` + "Set"/"Not set" + Clear, never echoes the value), and a
   **Test connection** button hitting `healthCheck()`.
5. **Settings → LLM (OpenAI)** — OpenAI API key
   (`SecretField`), model selection (e.g., `gpt-4`), temperature, timeout
   seconds, and a **Test** button that runs a one-token completion and reports
   latency or any API errors.
6. **Settings → Schedule** — timezone, a friendly builder ("weekdays at
   HH:MM") that emits cron plus an advanced raw-cron field, **next 5 runs
   preview**, skip-holidays toggle.
7. **Settings → Risk & Sizing** — max position %, max positions, max new
   positions/run, cash reserve %, max order notional, slippage bps,
   commission, min confidence, earnings-blackout days, fill model.
   Persisted and validated in Phase 1; consumed in Phase 2.
8. **About / Health** — version, DB path and size, `ATN_ENC_KEY` present
   indicator, migration version.

Phase 2 adds: Runs list, Run detail (transcript + artifacts + assessments +
decisions + resulting orders), Portfolio, Trades, Performance vs SPY.

## Single-container Docker

**Multi-stage build on `node:22-bookworm` → `node:22-bookworm-slim`.** Do
**not** use Alpine: `better-sqlite3` is a native module and musl builds are a
recurring source of pain. Build stage compiles `shared` → `web` → `server`;
runtime copies `node_modules`, `server/dist`, and the Vite build output into
`server/public`. If the runtime base ever diverges from the builder, run
`npm rebuild better-sqlite3` in the runtime stage.

**Process supervision: none needed — one Node process.** Express and the
croner scheduler run in the same process. The agent cycle is entirely
I/O-bound (HTTP to OpenAI API and data APIs), so it will not block the event loop
meaningfully; adding s6-overlay or supervisord would be pure overhead here.
`tini` is PID 1 for signal handling. Static serving: `express.static(staticRoot)`
plus a catch-all `GET *` that skips `/api` and non-GET and returns `index.html`;
in dev, the Vite middleware is mounted in-process behind `ATN_VITE_DEV=1`.

- Volume `/data` (`ATN_DATA_DIR=/data`) holding `atn.db` + WAL files.
  Migrations run on boot before the server listens.
- `HEALTHCHECK` → `GET /api/health`.
- `EXPOSE 8080`; `PORT` overridable.
- Env: `ATN_ENC_KEY` (required), `ATN_DATA_DIR`, `ATN_ROLE`, `PORT`, plus
  optional bootstrap fallbacks `OPENAI_API_KEY`, `FINNHUB_API_KEY`, `FRED_API_KEY`.

**The condition that would force a split:** if a cycle becomes CPU-bound
(local backtesting, large numeric work) or needs to restart independently of
the UI. The path is already open — `ATN_ROLE=web` and `ATN_ROLE=worker` run
the same image twice. The real constraint at that point is SQLite: WAL
multi-process works on one host with a shared volume, but not across hosts;
that is the point to move to Postgres. Do not build for that now.

---
[← Agent & Trading Design](03-agent-and-trading-design.md) · [back to index](README.md) · [next: Implementation Plan →](05-implementation-plan.md)
