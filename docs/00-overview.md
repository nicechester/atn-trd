# 00 — Overview & Stack

[← back to index](README.md)

## Summary

An autonomous, LLM-driven stock research and paper-trading app. A scheduler
fires a **daily** decision cycle; a LangGraph agent (backed by Disney Jedai)
researches watchlist symbols across four data sources, produces auditable
per-symbol assessments and a portfolio-level decision set; a deterministic
risk engine converts decisions into orders; a `PaperBroker` simulates fills
against fetched prices and tracks a virtual portfolio. A React UI configures
and observes everything. Ships as one Docker container.

**Phase 1** is a self-contained, shippable milestone: workspace skeleton,
SQLite persistence + migrations, settings service, and a complete
configuration UI working end-to-end — including live "Test connection" calls
to Jedai and each data source. **No trading logic ships in Phase 1.** Phase 1
is validated before Phase 2 starts.

## 1. Stack decisions

| Concern | Choice | Rationale |
|---|---|---|
| Language/runtime | Node 22 + TypeScript, ESM | Matches lexchat; Jedai client reuses near-verbatim |
| HTTP | Express 4 | Matches lexchat |
| Persistence | better-sqlite3, WAL | Matches lexchat; synchronous API keeps repos trivial |
| Frontend | Vite + React 18 + TS | Matches lexchat; served by the same Express process |
| LLM | `@langchain/openai` `ChatOpenAI` → Jedai, `@langchain/langgraph` | Per confirmed decision |
| Validation | zod (shared between server and web) | One settings schema, two consumers |
| Scheduler | **croner** (`croner` npm) | First-class IANA timezone support (`America/New_York`, DST-correct), `nextRun()`/`nextRuns(n)` for the UI's "next 5 runs" preview, zero deps. `node-cron` lacks a clean next-run API. |
| Money | Integer cents (`*_cents`), quantities `REAL` | No float drift in cash/P&L; fractional shares still possible |
| Container init | `tini` as PID 1 | Signal handling + zombie reaping for a single Node process |

**Deviation from lexchat, and why:** lexchat's `jedaiChatModel.ts` /
`authTokenProvider.ts` read credentials from `process.env` at build time.
Here, credentials are UI-managed and live in the DB, so
`buildJedaiChatOpenAI()` must take an explicit config object with env as
fallback. Everything else about that file — OAuth2 client_credentials with
expiry skew, `apiKey` set to the current token, the custom `fetch` that
re-sets `Authorization` per request and retries once on 401, the
`X-Disney-Internal-*` headers, and the
`modelKwargs: { frequency_penalty: undefined, presence_penalty: undefined, top_p: undefined }`
trick that strips those fields from the Bedrock/LiteLLM request body — is
reused as-is. `authTokenProvider.ts` is copied verbatim.

Because Jedai is an OpenAI-compatible endpoint (`ChatOpenAI` pointed at a
configurable `baseURL`), fixing on Jedai now carries little lock-in risk:
switching gateway or backing model later is a `baseURL` + auth-config change,
not an agent rewrite.

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
│  ├─ llm/authTokenProvider.ts  jedaiChatModel.ts  prompts/*.ts
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
