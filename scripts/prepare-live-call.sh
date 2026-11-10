#!/bin/sh
# pnpm live:prepare: get ready for a real call (plan Task 20, Step 1).
# Resets data/blink.db (a disposable dev database) to the Halvorsen case at intake with the
# manual policy active, then prints what to run next. It starts nothing and leaves nothing running.
set -eu
cd "$(dirname "$0")/.."

rm -f data/blink.db data/blink.db-wal data/blink.db-shm
mkdir -p data
pnpm exec drizzle-kit migrate
pnpm exec tsx scripts/seed.ts --manual-policy

cat <<'MSG'

Ready: data/blink.db holds the Halvorsen case at intake with the manual policy active.

Next, in this folder, start the server in live mode (leave it running):
  BLINK_LLM_MODE=live BLINK_AUTH_MODE=switcher pnpm dev

Then open the packaged Mac app (build it first with `pnpm desktop:build` if desktop/out is missing):
  open desktop/out/Blink-darwin-arm64/Blink.app
MSG
