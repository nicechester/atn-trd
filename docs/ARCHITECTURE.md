# Architecture

atn-trd is a self-hosted autonomous paper-trading system built as a Node.js monorepo.

## Directory Layout

```
atn-trd/
├── shared/          # Zod schemas shared between server and web
│   └── src/
│       ├── settings.ts   # SettingsSchema + defaults
│       ├── domain.ts     # Shared domain types
│       └── api.ts        # Shared API response shapes
├── server/          # Express API + scheduler + LLM + data sources
│   └── src/
│       ├── main.ts            # Entry point: DB → scheduler → Express
│       ├── app.ts             # Route registration
│       ├── config/            # Settings service (read/write/resolve)
│       ├── db/                # SQLite connection + migrations runner
│       ├── repos/             # Data access (settings, secrets, watchlist, portfolio)
│       ├── routes/            # Express route handlers
│       ├── datasources/       # External data connectors (news, fundamentals, macro, options, prices)
│       ├── llm/               # OpenAI-compatible chat model wrapper
│       ├── scheduler/         # croner scheduler + market calendar
│       ├── services/          # Business logic (symbol validation)
│       └── lib/               # Shared utilities (errors, logger, money, secretBox)
├── web/             # React SPA (Vite + TypeScript)
│   └── src/
│       ├── api/           # Typed HTTP client
│       ├── components/    # Reusable UI components
│       ├── context/       # React context (Toast)
│       └── pages/         # Route pages
├── docs/            # Design documents and architecture reference
├── Dockerfile       # Multi-stage production image
└── docker-compose.yml
```

## Module Boundaries

```mermaid
graph TD
    subgraph Web ["Web (React SPA)"]
        UI[Pages & Components]
        Client[api/client.ts]
    end

    subgraph Server ["Server (Express)"]
        Routes[Routes]
        Services[Services / Scheduler]
        Repos[Repos]
        DS[Data Sources]
        LLM[LLM Wrapper]
        DB[(SQLite)]
    end

    subgraph Shared
        Schema[Settings & Domain Schemas]
    end

    UI --> Client
    Client -->|HTTP JSON| Routes
    Routes --> Services
    Routes --> Repos
    Routes --> DS
    Routes --> LLM
    Services --> Repos
    Repos --> DB
    Schema --> Repos
    Schema --> Client
```

## Data Flow: Settings Write

```mermaid
sequenceDiagram
    participant UI as Settings Page
    participant API as PATCH /api/settings
    participant Svc as settingsService
    participant DB as SQLite

    UI->>API: { llm: { model, baseUrl, ... } }
    API->>Svc: patchSettings(patch)
    Svc->>DB: UPDATE app_settings SET doc = merge(existing, patch)
    DB-->>Svc: ok
    Svc-->>API: merged SettingsDocument
    API-->>UI: 200 { data: SettingsDocument }
```

## Data Flow: LLM Config Resolution

```mermaid
flowchart LR
    A[Explicit config arg] -->|non-empty| R[Resolved value]
    A -->|absent| B[DB settings]
    B -->|non-empty| R
    B -->|absent| C[Env var]
    C -->|non-empty| R
    C -->|absent| D[Hardcoded default]
    D --> R
```

Applies to **model**, **baseUrl**, **API key** (key checks secret store instead of DB settings).

## Data Flow: Data Source Test

```mermaid
sequenceDiagram
    participant UI as Data Sources Page
    participant API as POST /api/datasources/:id/test
    participant Reg as DataSourceRegistry
    participant DS as Connector
    participant Ext as External API

    UI->>API: test(id)
    API->>Reg: registry.get(id)
    Reg-->>API: connector instance
    API->>DS: probe()
    DS->>Ext: HTTP request
    Ext-->>DS: response
    DS-->>API: { ok, detail }
    API-->>UI: { ok, detail }
```

## Database Schema (Phase 1)

```mermaid
erDiagram
    app_settings {
        INTEGER id PK
        TEXT doc
        INTEGER updated_at
    }
    secrets {
        TEXT name PK
        TEXT value_enc
        INTEGER updated_at
    }
    watchlist {
        TEXT symbol PK
        INTEGER enabled
        TEXT note
        INTEGER added_at
    }
    portfolio {
        INTEGER id PK
        INTEGER cash_cents
        INTEGER starting_cash_cents
        INTEGER started_at
        INTEGER reset_at
        TEXT base_currency
    }
    audit_log {
        INTEGER id PK
        TEXT action
        TEXT entity_type
        TEXT entity_id
        TEXT old_value
        TEXT new_value
        TEXT user_id
        INTEGER created_at
    }
```

## Key Design Decisions

### Singleton settings document
`app_settings` holds a single JSON document (`id = 1`). Reads deserialize + validate with Zod; writes deep-merge the patch over the existing document. This avoids per-field schema migrations as settings evolve.

### Encrypted secret store
API keys are stored in `secrets.value_enc` using XSalsa20-Poly1305 (`lib/secretBox.ts`). The encryption key is `ATN_ENC_KEY` (hex, 32 bytes), required at startup. Keys are never logged or returned in API responses.

### Repos own SQL
All SQL lives in `repos/`. Routes and services call repo methods — never `db.prepare()` directly.

### Env-var fallback for LLM config
DB values take precedence; env vars (`LLM_API_KEY`, `LLM_API_URL`, `LLM_MODEL`) serve as fallbacks so Docker deployments work without touching the DB.

### Single Node process
Express routes and the croner scheduler run in the same process. Both are I/O-bound; no worker threads needed in Phase 1.
