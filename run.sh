#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}atn-trd local development setup${NC}"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
  echo -e "${YELLOW}Creating .env from .env.example${NC}"
  cp .env.example .env

  # Generate encryption key if ATN_ENC_KEY is empty
  if ! grep -q "ATN_ENC_KEY=[^ ]" .env; then
    echo -e "${YELLOW}Generating ATN_ENC_KEY...${NC}"
    ENC_KEY=$(openssl rand -hex 32)
    sed -i '' "s/^ATN_ENC_KEY=$/ATN_ENC_KEY=$ENC_KEY/" .env
    echo -e "${GREEN}✓ Generated ATN_ENC_KEY${NC}"
  fi
  echo ""
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
  echo -e "${YELLOW}Installing dependencies...${NC}"
  npm install
  echo -e "${GREEN}✓ Dependencies installed${NC}"
  echo ""
fi

# Clear any stale server process from a previous run
lsof -ti :8080 | xargs kill -9 2>/dev/null || true

# Export .env vars so server picks up LLM_API_KEY, FRED_API_KEY, etc.
set -a
. .env
set +a

# Run dev servers
echo -e "${GREEN}Starting dev servers (web + server)${NC}"
echo -e "${YELLOW}Web: http://localhost:5173${NC}"
echo -e "${YELLOW}API: http://localhost:8080${NC}"
echo ""
npm run dev
