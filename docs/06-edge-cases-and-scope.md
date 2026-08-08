# 06 — Edge Cases & Out of Scope

[← back to index](README.md)

## Edge cases

- **LLM returns invalid structured output** — zod-validate, retry once with
  the validation error appended, then fail that symbol only. Never let one
  bad symbol kill a run.
- **Partial data-source failure** — connectors return
  `{ ok: false, detail }`; the analyst prompt is told which sources are
  unavailable this cycle. A run degrades; it does not crash.
- **Concurrent runs** — DB-level lock on `agent_runs.status='running'`;
  sweep runs older than `runTimeoutMinutes` to `failed` at scheduler start.
- **Timezone/DST** — always pass `America/New_York` to croner; never
  compute market times from the container's local clock. Container
  `TZ=UTC`.
- **Holidays and 1pm early closes** — `marketCalendar.ts`; verify a few
  known dates (Good Friday, Juneteenth, the day after Thanksgiving) in a
  unit test.
- **Corporate actions** — v1 does **not** adjust existing positions for
  splits or dividends. Known limitation; document it in the README. Use
  `adj_close` for the SPY benchmark, raw `close` for fills.
- **Delisted / bad symbols** — `yahoo-finance2` warns historical data can
  vanish entirely for delisted names. Mark the watchlist entry `enabled=0`
  with a note rather than failing the run.
- **Rate limits** — Finnhub 60/min and FRED both need the token bucket in
  `http.ts`; back off on 429 rather than retrying tightly.
- **Missing `ATN_ENC_KEY`** — the app must boot (so the UI can explain the
  problem) but every secret write returns a clear 503, and the Health page
  shows the key as absent. Do not silently store plaintext.
- **Float drift** — all cash and P&L arithmetic goes through
  `lib/money.ts`. Reject any PR that does `price * qty` in floats for
  money.
- **PaperBroker with no price data** — reject the order with
  `reject_reason='no_price'`; never fill at 0.
- **Settings changed mid-run** — the run uses its `settings_snapshot`; the
  scheduler re-registers cron jobs only between runs.

## Out of scope for this spec

Real broker execution and any broker API credentials; live-mode order
placement (UI toggle exists but is disabled); shorting, options trading, and
margin; intraday or minute/second cadence; social-sentiment, SEC-filings, and
deep options-flow sources (deferred past v1's four); multi-user auth, RBAC,
or multi-tenancy; docker-compose, k8s, or any multi-container topology;
backtesting; Postgres; the Performance-vs-SPY UI and the `next_open` fill
model (both explicit stretch goals — the schema supports them, the code need
not).

## Key reference files (patterns to copy, not to modify)

- `/Users/chester.kim/workspace/lexicon/agents/lexchat/server/src/authTokenProvider.ts` — copy verbatim
- `/Users/chester.kim/workspace/lexicon/agents/lexchat/server/src/jedaiChatModel.ts` — copy, adapt env → settings config object
- `/Users/chester.kim/workspace/lexicon/agents/lexchat/server/src/agent.ts` — `createReactAgent` + `streamEvents` shape
- `/Users/chester.kim/workspace/lexicon/agents/lexchat/server/src/agentCollector.ts` — collector pattern for the audit trail
- `/Users/chester.kim/workspace/lexicon/agents/lexchat/server/src/secretBox.ts` — AES-256-GCM envelope
- `/Users/chester.kim/workspace/lexicon/agents/lexchat/server/src/index.ts` (lines 382–426) — Vite-dev vs static serving in one process

Nothing has been written to `/Users/chester.kim/workspace/trashcan/atn-trd`
outside of `docs/` yet — implementation is pending review.

---
[← Implementation Plan](05-implementation-plan.md) · [back to index](README.md)
