#!/bin/sh
# The production start (Task 42): the container's command on Railway, and the local production check.
#
#   1. migrate the database at BLINK_DB_PATH (Railway: /data/blink.db, on the volume);
#   2. seed it in full when it holds no users yet, otherwise insert or update the users only, so a
#      restart keeps every case, call and review;
#   3. run the web server and the worker together; if either exits, both stop and the container
#      restarts.
#
# Expects `pnpm build` to have run. PORT defaults to 3000. Never prints BLINK_SEED_PASSWORDS.
set -eu

# A stop during migrate or seed ends that step and exits at once. sh runs a trap only after a
# foreground command returns, so each step runs in the background and is waited for. (As PID 1 in
# the container, sh would otherwise ignore the platform's TERM entirely.)
CHILD=""
stop() {
  echo "[start] stopped during startup" >&2
  if [ -n "$CHILD" ]; then kill "$CHILD" 2>/dev/null || true; fi
  exit "$1"
}
trap 'stop 143' TERM
trap 'stop 130' INT
run() {
  "$@" &
  CHILD=$!
  wait "$CHILD"
}

cd "$(dirname "$0")/.."
export PATH="$PWD/node_modules/.bin:$PATH"

# A public deployment never lets a visitor pick their role or play a scripted call.
if [ "${BLINK_ALLOW_SWITCHER:-}" = "1" ] || [ "${BLINK_ALLOW_SCRIPTED_CALLS:-}" = "1" ]; then
  echo "[start] refusing to start: BLINK_ALLOW_SWITCHER and BLINK_ALLOW_SCRIPTED_CALLS must not be set in production" >&2
  exit 1
fi
if [ -z "${BLINK_SEED_PASSWORDS:-}" ]; then
  echo "[start] warning: BLINK_SEED_PASSWORDS is not set, so a user without a password cannot sign in" >&2
fi

DB="${BLINK_DB_PATH:-./data/blink.db}"
case "$DB" in
  /data/*) ;;
  *) echo "[start] warning: BLINK_DB_PATH is $DB, not under /data, so on Railway the database is lost on every deploy" >&2 ;;
esac
mkdir -p "$(dirname "$DB")"

echo "[start] migrating $DB"
run drizzle-kit migrate
echo

USERS=$(node -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
console.log(db.prepare("select count(*) as n from users").get().n);
db.close();
' "$DB")

if [ "$USERS" = "0" ]; then
  echo "[start] empty database: full seed"
  run tsx scripts/seed.ts
else
  echo "[start] database has $USERS users: seeding users only"
  run tsx scripts/seed.ts --users-only
fi

exec concurrently -k -n web,worker "next start -p ${PORT:-3000}" "tsx scripts/worker.ts"
