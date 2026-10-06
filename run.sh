#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}atn-trd production mode (node only)${NC}"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo -e "${YELLOW}Creating .env from .env.example${NC}"
  cp .env.example .env
fi

# Build
echo -e "${YELLOW}Building...${NC}"
npm run build
cp -r web/dist/* server/public/
echo -e "${GREEN}✓ Build complete${NC}"
echo ""

# Clear any stale server process from a previous run
lsof -ti :8080 | xargs kill -9 2>/dev/null || true

# Export .env vars
set -a
. .env
set +a

# Run with node (no tsx)
echo -e "${GREEN}Starting server with node${NC}"
echo -e "${YELLOW}API: http://localhost:8080${NC}"
echo ""
node server/dist/main.js
