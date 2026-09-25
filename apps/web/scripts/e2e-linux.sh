#!/usr/bin/env bash
# Runs the Playwright specs in CI's image (Linux), on a copy of this checkout, and copies its
# screenshot baselines back (`-linux` ones are made here, as CI compares against them) and its
# test-results/ (failure screenshots, traces).
#
#   apps/web/scripts/e2e-linux.sh e2e/themes.spec.ts --update-snapshots
#
# Needs Docker. The copy leaves out node_modules and build output: `bun install` makes Linux ones.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PLAYWRIGHT="$(node -p "require('$ROOT/apps/web/package.json').devDependencies['@playwright/test']")"
IMAGE="mcr.microsoft.com/playwright:v$PLAYWRIGHT-noble"
BUN="$(bun --version)"

docker run --rm --ipc=host -e CI=1 -v "$ROOT:/src:ro" -v "$ROOT/apps/web/e2e/__snapshots__:/out" \
  -v "$ROOT/apps/web/test-results:/results" \
  "$IMAGE" bash -euo pipefail -c "
    npm install -g bun@$BUN >/dev/null
    mkdir /work && cd /src
    tar --exclude=node_modules --exclude=dist --exclude=.wrangler --exclude=test-results \
      --exclude=.tsc --exclude='*.tsbuildinfo' -cf - . | tar -xf - -C /work
    cd /work && bun install --frozen-lockfile >/dev/null
    cd apps/web && status=0
    bunx playwright test --project=chromium $* || status=\$?
    cp -r e2e/__snapshots__/. /out/
    cp -r test-results/. /results/ 2>/dev/null || true
    exit \$status
  "
