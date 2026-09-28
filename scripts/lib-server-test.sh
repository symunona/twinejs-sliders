#!/usr/bin/env bash
# Throwaway Go server for the asset-library contract tests.
#
#   scripts/lib-server-test.sh               # run until Ctrl-C
#   scripts/lib-server-test.sh -- <cmd...>   # run cmd with LIB_SERVER_URL + LIB_TOKEN set, then stop
#
# Fresh DATA_DIR under /mnt/data_ssd/tmp (not /tmp: keep churn off the system SSD),
# port 27101 (override: LIB_PORT), fixed token. Everything is removed on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GO="${GO:-$(command -v go || echo /snap/bin/go)}"
PORT="${LIB_PORT:-27101}"
TOKEN="lib-test-token-0123456789abcdef"
BASE="${LIB_TMP_BASE:-/mnt/data_ssd/tmp}"
mkdir -p "$BASE"
WORK="$(mktemp -d "$BASE/lib-server-test.XXXXXX")"
PID=""

cleanup() {
	if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
		kill "$PID" 2>/dev/null || true
		wait "$PID" 2>/dev/null || true
	fi
	rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

(cd "$ROOT/server" && "$GO" build -o "$WORK/twine-story-store" .)

AUTH_TOKEN="$TOKEN" DATA_DIR="$WORK/data" CORS_ORIGINS='*' \
	"$WORK/twine-story-store" --addr "127.0.0.1:$PORT" --env "$WORK/none.env" \
	>"$WORK/stdout.log" 2>"$WORK/stderr.log" &
PID=$!

URL="http://127.0.0.1:$PORT"
for _ in $(seq 1 100); do
	if curl -fsS "$URL/api/v1/health" >/dev/null 2>&1; then break; fi
	if ! kill -0 "$PID" 2>/dev/null; then
		echo "lib-server-test: server died (port $PORT busy? set LIB_PORT):" >&2
		cat "$WORK/stderr.log" >&2
		exit 1
	fi
	sleep 0.1
done
curl -fsS "$URL/api/v1/health" >/dev/null || { echo "lib-server-test: no /health" >&2; exit 1; }

export LIB_SERVER_URL="$URL" LIB_TOKEN="$TOKEN"
echo "LIB_SERVER_URL=$LIB_SERVER_URL" >&2
echo "LIB_TOKEN=$LIB_TOKEN" >&2
echo "DATA_DIR=$WORK/data" >&2

if [[ "${1:-}" == "--" ]]; then
	shift
	"$@"
else
	echo "Ctrl-C to stop" >&2
	wait "$PID"
fi
