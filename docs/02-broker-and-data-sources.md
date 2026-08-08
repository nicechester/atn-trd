# 02 — Broker Interface & Data Sources

[← back to index](README.md)

## `Broker` interface + `PaperBroker`

`server/src/brokers/types.ts` — this contract is load-bearing; implement it
exactly:

```ts
export interface OrderRequest {
  clientOrderId: string;        // caller-supplied UUID — idempotency key
  symbol: string;
  side: "buy" | "sell";
  qty: number;                  // fractional allowed
  type: "market" | "limit";
  limitPriceCents?: number;
  tif: "day" | "gtc";
}

export interface Broker {
  readonly id: string;                                  // "paper"
  readonly supportsFractionalShares: boolean;
  getAccount(): Promise<Account>;                       // cashCents, equityCents, buyingPowerCents
  getPositions(): Promise<BrokerPosition[]>;
  submitOrder(req: OrderRequest): Promise<OrderState>;  // idempotent on clientOrderId
  getOrder(orderId: string): Promise<OrderState | null>;
  listOrders(f: { status?: OrderStatus[]; since?: number }): Promise<OrderState[]>;
  cancelOrder(orderId: string): Promise<void>;
  getClock(): Promise<{ isOpen: boolean; nextOpen: number; nextClose: number }>;
}
```

Contract rules the implementation must honor:

1. **`submitOrder` is idempotent on `clientOrderId`.** Re-submitting an
   existing id returns the existing `OrderState` without creating a second
   order. This is what prevents a retried agent run from double-buying, and
   every real broker (Alpaca, IBKR) supports it — designing it in now is the
   main thing that keeps a real adapter drop-in.
2. **`submitOrder` returns `accepted`/`pending`, never a guaranteed
   synchronous fill.** Callers must poll `getOrder`. `PaperBroker` may fill
   immediately internally, but the caller cannot assume it.
3. **All money in integer cents; all ids are strings.** No `Date` objects
   across the boundary — epoch-ms numbers.
4. **The broker never reasons about strategy.** No knowledge of decisions,
   assessments, or watchlist.
5. **`orders`/`fills`/`positions` tables are the canonical local record for
   every broker.** `PaperBroker` writes them as it simulates; a future real
   adapter would write them from the remote API's responses via a sync pass.
   Agent and reporting code read only these tables, so swapping brokers
   touches nothing above `brokers/`.

### `PaperBroker` plan

Constructed with `{ priceFeed, repos, config }`.

- **Price feed dependency** — it needs only `PriceFeed.getLatestBar(symbol)`
  and `getBar(symbol, date)`, satisfied by `datasources/prices/yahooPrices.ts`
  reading through the `price_bars` cache. **No broker account or API key.**
- **Fill model** — config `paper.fillModel`:
  - `last_close` (**v1 default, implement first**): fill immediately at the
    most recent daily close.
  - `next_open` (stretch, more honest): mark `pending`, settle on the next
    scheduler tick at the next session's open. Avoids the lookahead bias
    baked into `last_close`.

  Implement the `pending → accepted → filled` state machine either way so
  `next_open` and real brokers slot in.
- **Slippage & fees** — `paper.slippageBps` (default 5) applied adversely
  (buys fill higher, sells lower); `paper.commissionCents` per order
  (default 0).
- **Validation** — reject with a reason on: insufficient cash (buy notional +
  fee > cash), insufficient shares (sell qty > position qty; **no shorting in
  v1**), unknown/no-price symbol, qty ≤ 0.
- **Bookkeeping** — on fill, in a single SQLite transaction: insert `fills`,
  update `positions` (weighted-average cost on buys; realized P&L on sells),
  update `portfolio.cash_cents`, update `orders.status`.
- **`getClock`** — delegates to `scheduler/marketCalendar.ts`, not to a
  broker API.

## Data source connectors

`server/src/datasources/types.ts`:

```ts
export interface DataSourceResult<T> {
  data: T;
  provider: string;
  fetchedAt: number;
  citations: { title: string; url: string }[];
  raw?: unknown;                 // persisted to research_artifacts.payload_json
}

export interface DataSource<Q, T> {
  readonly id: "news" | "fundamentals" | "macro" | "options";
  readonly provider: string;
  isConfigured(): boolean;                 // required secret present?
  healthCheck(): Promise<{ ok: boolean; detail: string; latencyMs: number }>;
  fetch(q: Q, ctx: { signal?: AbortSignal }): Promise<DataSourceResult<T>>;
}
```

`healthCheck()` is what the Phase 1 Settings → Data Sources "Test" button
calls — that is the vertical slice proving Phase 1 works end to end.

| # | Source | Recommended MVP provider | Key? | Notes |
|---|---|---|---|---|
| 1 | **News headlines** | **Finnhub** `/company-news` + `/news?category=general` | Free key, 60 req/min | Fallback impl behind the same interface: `yahoo-finance2` `search()` news (zero-key). Gives the Data Sources page a real provider toggle. |
| 2 | **Fundamentals** | **`yahoo-finance2`** `quoteSummary(sym, { modules: ["financialData","defaultKeyStatistics","summaryDetail","earnings","calendarEvents"] })` | None | P/E, margins, revenue growth, debt/equity, **and `calendarEvents.earnings.earningsDate`** — feed that to the risk engine's earnings-blackout rule. Secondary: Finnhub `/stock/metric?metric=all`. |
| 3 | **Macro** | **FRED** `api.stlouisfed.org/fred/series/observations` | Free key | Curated series in settings: `DGS10`, `DGS2`, `T10Y2Y`, `CPIAUCSL`, `UNRATE`, `FEDFUNDS`, `VIXCLS`, `UMCSENT`. Return latest + prior + Δ + release date per series. |
| 4 | **Options / derivatives** | **`yahoo-finance2`** `options(symbol)` | None | Chain gives `openInterest`, `volume`, `impliedVolatility`, `strike` per contract. Cross-check/fallback: CBOE delayed JSON `cdn.cboe.com/api/global/delayed_quotes/options/{SYM}.json` (no key). |
| — | **Price feed** (infrastructure, not one of the four) | **`yahoo-finance2`** `chart()` / `quote()`, cached into `price_bars` | None | Backs PaperBroker fills, NAV snapshots, SPY benchmark. |

**Options connector must derive locally** (`optionsCalendar.ts`, pure
functions, no API): put/call open-interest ratio, put/call volume ratio,
total OI, max-pain strike, IV skew (nearest-OTM put vs call IV),
per-contract `volume/openInterest` ratio flagged as unusual above a
threshold, days to next expiry, days to next **monthly OpEx (3rd Friday)**,
and whether the next monthly is a **quarterly/triple-witching** (3rd Friday
of Mar/Jun/Sep/Dec). This directly encodes the expiration-driven effect the
user's friend raised, and needs no paid data.

**Risk to flag:** `yahoo-finance2` is explicitly unofficial ("neither
created nor endorsed by Yahoo Inc.", no availability or consistency
guarantees) and has historically broken on Yahoo's cookie/crumb changes. It
is by far the best free option and the current release is actively
maintained, but the `DataSource` interface exists precisely so Finnhub or FMP
can replace it per-category without touching agent code. Every connector
must degrade to `{ ok: false }` rather than throw into the run.

`datasources/http.ts` provides shared `fetchJson` with timeout,
exponential-backoff retry on 429/5xx, and a per-provider token bucket. Keep
it under ~120 lines — do not build a caching framework.

---
[← Data Model](01-data-model.md) · [back to index](README.md) · [next: Agent & Trading Design →](03-agent-and-trading-design.md)
