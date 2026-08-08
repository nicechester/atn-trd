# 01 — Data Model (SQLite)

[← back to index](README.md)

Money is `INTEGER` cents. Quantities are `REAL`. Timestamps are `INTEGER`
epoch-ms except `as_of_date`/`bar_date` which are `TEXT` `YYYY-MM-DD` (ET
calendar date). Use numbered SQL migrations with a
`schema_migrations(version, applied_at)` table — not lexchat's single
`CREATE TABLE IF NOT EXISTS` blob, since this schema evolves across two
phases.

## Migration 001 (Phase 1)

- **`app_settings`** — `id INTEGER PK CHECK(id=1)`, `doc TEXT NOT NULL` (JSON),
  `updated_at`. Single JSON document validated by the shared zod schema on
  every read and write.
- **`secrets`** — `name TEXT PK`, `value_enc TEXT NOT NULL`, `updated_at`.
  AES-256-GCM sealed via the `secretBox` pattern; key from `ATN_ENC_KEY`.
  Never returned to the client — the API returns
  `{ name, isSet: boolean, updatedAt }` only.
- **`watchlist`** — `symbol TEXT PK`, `enabled INTEGER DEFAULT 1`,
  `note TEXT`, `added_at`.
- **`portfolio`** — `id INTEGER PK CHECK(id=1)`, `cash_cents`,
  `starting_cash_cents`, `started_at`, `reset_at`,
  `base_currency TEXT DEFAULT 'USD'`.

## Migration 002 (Phase 2)

- **`agent_runs`** — `id TEXT PK` (uuid), `trigger TEXT`
  (`scheduled|manual`), `status TEXT`
  (`running|succeeded|failed|skipped`), `started_at`, `finished_at`,
  `model TEXT`, `settings_snapshot TEXT` (JSON — what config produced this
  run), `error TEXT`, `token_usage_json TEXT`, `skip_reason TEXT`.
- **`research_artifacts`** — `id`, `run_id`, `symbol TEXT NULL`, `source TEXT`
  (`news|fundamentals|macro|options|prices`), `provider TEXT`, `fetched_at`,
  `payload_json TEXT`, `summary TEXT`, `citations_json TEXT`. This is the
  evidence trail.
- **`agent_messages`** — `id`, `run_id`, `symbol TEXT NULL`, `seq INTEGER`,
  `role TEXT` (`system|human|ai|tool`), `content TEXT`, `tool_name TEXT`,
  `tool_args_json TEXT`, `tool_result_json TEXT`, `created_at`. Full
  transcript.
- **`assessments`** — `id`, `run_id`, `symbol`, `score REAL` (-5..+5),
  `confidence REAL` (0..1), `thesis TEXT`, `risks TEXT`, `catalysts TEXT`,
  `evidence_ids_json TEXT`, `created_at`.
- **`decisions`** — `id`, `run_id`, `symbol`, `action TEXT`
  (`buy|sell|hold|trim|add`), `target_weight REAL NULL`, `confidence REAL`,
  `rationale TEXT`, `assessment_id`, `created_at`.
- **`orders`** — `id TEXT PK`, `client_order_id TEXT UNIQUE NOT NULL`,
  `decision_id NULL`, `run_id NULL`, `broker TEXT`, `broker_order_id TEXT
  NULL`, `mode TEXT` (`paper|live`), `symbol`, `side TEXT` (`buy|sell`),
  `qty REAL`, `type TEXT` (`market|limit`), `limit_price_cents NULL`,
  `tif TEXT` (`day|gtc`), `status TEXT`
  (`pending|accepted|partially_filled|filled|canceled|rejected|expired`),
  `reject_reason TEXT`, `submitted_at`, `updated_at`.
- **`fills`** — `id`, `order_id`, `qty REAL`, `price_cents`, `fee_cents`,
  `filled_at`, `bar_date TEXT`. Separate from `orders` so partial fills and
  real-broker fill streams map cleanly.
- **`positions`** — `symbol TEXT PK`, `qty REAL`, `avg_cost_cents`,
  `realized_pnl_cents`, `opened_at`, `updated_at`. Materialized from fills.
- **`price_bars`** — `PRIMARY KEY(symbol, bar_date)`, `open_cents, high_cents,
  low_cents, close_cents, adj_close_cents, volume INTEGER, provider TEXT,
  fetched_at`. Cache backing fills, NAV, and benchmark.
- **`portfolio_snapshots`** — `id`, `as_of_date TEXT UNIQUE`, `cash_cents`,
  `positions_value_cents`, `total_value_cents`, `created_at`.
- **`benchmark_snapshots`** — `PRIMARY KEY(symbol, as_of_date)`,
  `close_cents`, `adj_close_cents`.

## SPY benchmark support

`portfolio_snapshots` + `benchmark_snapshots` are written by a **separate
daily snapshot job** that runs whether or not the agent ran, and
`portfolio.starting_cash_cents`/`started_at` anchor the series. That is
sufficient to compute, later, `strategyReturn = total_value/starting_cash - 1`
vs `spyReturn = spy_adj_close(t)/spy_adj_close(t0) - 1` with no schema
change. The comparison UI is a stretch goal.

---
[← Overview](00-overview.md) · [back to index](README.md) · [next: Broker & Data Sources →](02-broker-and-data-sources.md)
