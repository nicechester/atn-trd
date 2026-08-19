#!/bin/sh
set -e

echo "Cleaning build artifacts..."

# Compiled output
rm -rf shared/dist server/dist web/dist server/public

# Stale generated files in source
find shared/src -name "*.d.ts" -o -name "*.d.ts.map" | xargs rm -f 2>/dev/null || true
find web/src -name "*.module.css.d.ts" | xargs rm -f 2>/dev/null || true

# TypeScript build info
find . -name "*.tsbuildinfo" -not -path "*/node_modules/*" | xargs rm -f 2>/dev/null || true

echo "Done."
