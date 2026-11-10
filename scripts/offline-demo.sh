#!/bin/sh
# pnpm demo:offline — the Phase 7 exit check (§16): `pnpm demo` with the network
# disabled runs the demo script (§19) end to end.
#
# The whole run happens inside a macOS sandbox that denies every network
# connection except loopback: DNS, outside hosts by name or by IP, and the LAN
# all fail. That switches the network off for the demo's own processes (pnpm,
# the build, the web server, the worker, and the test browser) without turning
# off Wi-Fi for the rest of the machine.
#
# It runs exactly what the demo runbook says: `pnpm db:reset`, then `pnpm demo`.
# So it resets data/blink.db.
set -eu

# Denied: everything on the network. Allowed back: loopback TCP (the app and the
# test browser talk over localhost) and local unix sockets (tsx and the build use
# them for IPC; they never leave the machine). The system resolver's socket stays
# denied, so not even a DNS query goes out.
PROFILE='(version 1)(allow default)(deny network*)(allow network-outbound (remote ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))(allow network-bind (local ip "*:*"))(allow network-bind (local unix-socket))(allow network-inbound (local unix-socket))(allow network-outbound (remote unix-socket))(deny network-outbound (literal "/private/var/run/mDNSResponder"))'

if [ "${BLINK_OFFLINE_INNER:-}" != "1" ]; then
  if ! command -v sandbox-exec >/dev/null 2>&1; then
    echo "pnpm demo:offline uses the macOS sandbox (sandbox-exec), which this system does not have."
    echo "Do the same check by hand: turn the network off, then run"
    echo "  pnpm db:reset && pnpm demo"
    echo "and, in a second terminal,"
    echo "  BLINK_E2E_BASE_URL=http://localhost:3000 pnpm e2e"
    exit 2
  fi
  exec sandbox-exec -p "$PROFILE" env BLINK_OFFLINE_INNER=1 sh "$0" "$@"
fi

# ── From here on, every process is inside the sandbox ─────────────────────────
export PORT="${PORT:-3000}"
BASE="http://localhost:$PORT"
LOG="${TMPDIR:-/tmp}/blink-offline-demo.log"

echo "1. Network check (must fail for every outside address)"
for url in https://api.anthropic.com/ https://registry.npmjs.org/ https://1.1.1.1/; do
  if curl -s -o /dev/null -m 6 "$url"; then
    echo "   REACHABLE: $url — the network is not disabled; stopping."
    exit 1
  fi
  echo "   unreachable: $url"
done
if curl -s -o /dev/null -m 3 "$BASE/"; then
  echo "   Something is already listening on $BASE. Stop it, or set PORT, and run again."
  exit 1
fi

echo "2. node $(node -v) · pnpm db:reset"
pnpm db:reset

echo "3. pnpm demo (production build, then web and worker; log: $LOG)"
# Its own process group, so the whole tree can be stopped at the end.
perl -e 'setpgrp(0, 0); exec @ARGV' pnpm demo >"$LOG" 2>&1 &
DEMO_PID=$!
trap 'kill -TERM -- "-$DEMO_PID" 2>/dev/null || true' EXIT INT TERM

tries=0
until curl -s -o /dev/null -m 3 "$BASE/"; do
  tries=$((tries + 1))
  if ! kill -0 "$DEMO_PID" 2>/dev/null; then
    echo "   pnpm demo exited before the server came up:"
    tail -30 "$LOG"
    exit 1
  fi
  if [ "$tries" -gt 150 ]; then
    echo "   the server did not come up within 5 minutes:"
    tail -30 "$LOG"
    exit 1
  fi
  sleep 2
done
echo "   serving on $BASE"

echo "4. The demo script (§19), in a browser, against that server"
BLINK_E2E_BASE_URL="$BASE" pnpm e2e

echo "5. Audit chain of the database the demo just wrote"
pnpm audit:verify

if grep -qi "LLM_REPLAY_MISS\|ENOTFOUND\|ECONNREFUSED\|fetch failed" "$LOG"; then
  echo "The server log mentions a replay miss or a failed network call:"
  grep -i "LLM_REPLAY_MISS\|ENOTFOUND\|ECONNREFUSED\|fetch failed" "$LOG" | head -10
  exit 1
fi
echo "Done: pnpm demo ran the whole demo script with the network disabled."
