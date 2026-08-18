# 00 — Overview & Stack

[← back to index](README.md)

## Summary

An autonomous, LLM-driven stock research and paper-trading app. A scheduler
fires a **daily** decision cycle; a LangGraph agent (backed by OpenAI)
researches watchlist symbols across four data sources, produces auditable
per-symbol assessments and a portfolio-level decision set; a deterministic
risk engine converts decisions into orders; a `PaperBroker` simulates fills
against fetched prices and tracks a virtual portfolio. A React UI configures
and observes everything. Ships as one Docker container.

**Phase 1** is a self-contained, shippable milestone: workspace skeleton,
SQLite persistence + migrations, settings service, and a complete
configuration UI working end-to-end — including live "Test connection" calls
to OpenAI and each data source. **No trading logic ships in Phase 1.** Phase 1
is validated before Phase 2 starts.

## 1. Stack decisions

| Concern | Choice | Rationale |
|---|---|---|
| Language/runtime | Node 22 + TypeScript, ESM | Strong typing, modern tooling |
| HTTP | Express 4 | Lightweight, proven |
| Persistence | better-sqlite3, WAL | Synchronous API keeps repos trivial; works well for single-container setup |
| Frontend | Vite + React 18 + TS | Fast dev loop, served by the same Express process |
| LLM | `@langchain/openai` `ChatOpenAI`, `@langchain/langgraph` | OpenAI with proper auth handling |
| Validation | zod (shared between server and web) | One settings schema, two consumers |
| Scheduler | **croner** (`croner` npm) | First-class IANA timezone support (`America/New_York`, DST-correct), `nextRun()`/`nextRuns(n)` for the UI's "next 5 runs" preview, zero deps. `node-cron` lacks a clean next-run API. |
| Money | Integer cents (`*_cents`), quantities `REAL` | No float drift in cash/P&L; fractional shares still possible |
| Container init | `tini` as PID 1 | Signal handling + zombie reaping for a single Node process |

**OpenAI setup:** Credentials (OpenAI API key) are
UI-managed and persisted in the DB. `buildOpenAIChatModel()` reads from the
settings service, with env fallback for development. Uses `@langchain/openai`
with proper error handling. API key is managed via environment or settings.

## 2. Directory / module layout

```
atn-trd/
├─ package.json                  # npm workspaces: shared, server, web
├─ tsconfig.base.json
├─ Dockerfile  .dockerignore  .env.example  README.md
├─ docs/ARCHITECTURE.md  docs/CODING_GUIDELINES.md
│
├─ shared/src/
│  ├─ settings.ts                # zod SettingsSchema + DEFAULT_SETTINGS + Settings type
│  ├─ domain.ts                  # Order, Position, Decision, Run, Assessment types
│  ├─ api.ts                     # request/response DTOs
│  └─ index.ts
│
├─ server/src/
│  ├─ main.ts                    # composition root; reads ATN_ROLE
│  ├─ app.ts                     # createApp(deps) -> express.Application
│  ├─ config/env.ts              # process.env parsing (bootstrap only)
│  ├─ config/settingsService.ts  # read/write settings doc + secret resolution
│  ├─ db/index.ts  db/migrate.ts  db/migrations/*.sql
│  ├─ repos/                     # settings, secrets, watchlist, portfolio, orders,
│  │                             # positions, runs, decisions, artifacts, prices, snapshots
│  ├─ routes/                    # health, settings, secrets, watchlist, datasources,
│  │                             # llm, schedule, runs, portfolio, trades, performance
│  ├─ services/                  # symbol, price, portfolio, snapshot, risk, tradingCycle
│  ├─ brokers/types.ts  paperBroker.ts  index.ts
│  ├─ datasources/
│  │  ├─ types.ts  http.ts
│  │  ├─ news/{finnhubNews,yahooNews,index}.ts
│  │  ├─ fundamentals/{yahooFundamentals,index}.ts
│  │  ├─ macro/{fredMacro,index}.ts
│  │  ├─ options/{yahooOptions,optionsCalendar,index}.ts
│  │  └─ prices/yahooPrices.ts
│  ├─ llm/openaiChatModel.ts  prompts/*.ts
│  ├─ agent/{tools,analystAgent,portfolioManagerAgent,runCollector}.ts
│  ├─ scheduler/index.ts  marketCalendar.ts  jobs/{tradingCycle,snapshot}.ts
│  └─ lib/{money,logger,errors}.ts
│
└─ web/src/
   ├─ main.tsx  App.tsx  api/client.ts
   ├─ components/{Nav,Card,SecretField,TestButton,Toast}.tsx
   └─ pages/{Dashboard,SettingsGeneral,SettingsWatchlist,SettingsDataSources,
             SettingsLlm,SettingsSchedule,SettingsRisk}.tsx
```

**Boundary rule (keeps a future container split cheap):** `app.ts` knows only
Express; `scheduler/index.ts` knows only croner + services; `main.ts` is the
only file that starts both, gated on `ATN_ROLE=all|web|worker` (default
`all`). Splitting later = run the same image twice with a different env var,
no refactor. Routes never call data sources or brokers directly — only
`services/`. Services never import Express types.

---
[← back to index](README.md) · [next: Data Model →](01-data-model.md)
