# atn-trd

Autonomous LLM-driven stock research and paper-trading app.

## Overview

An autonomous trading system that uses Google Gemini on GCP to research watchlist symbols across multiple data sources, produces auditable per-symbol assessments, and simulates trading on a virtual portfolio.

## Development

```bash
# Install dependencies
npm install

# Build all workspaces (shared → web → server)
npm run build

# Start dev servers (web + server)
npm run dev

# Type checking
npm run typecheck
```

## Workspaces

- **shared**: Shared types, schemas, and domain models
- **server**: Express API and trading engine
- **web**: React UI for configuration and observation

## Project Structure

See [docs/00-overview.md](docs/00-overview.md) for complete architecture.

## License

Proprietary
