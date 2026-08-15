#!/usr/bin/env bash
# Serve the built Sliders-Twine editor on the tailnet.
#
#   ./scripts/serve-sliders.sh [port]
#
# Builds if dist/web is missing or stale, then serves it bound to 0.0.0.0 so the
# tailnet address works. Prints the tailscale URL to use.
set -euo pipefail

PORT="${1:-8817}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f dist/web/index.html ]; then
	echo "==> dist/web missing, building…"
	npm run build:web
fi

TS_IP="$(tailscale ip -4 2>/dev/null | head -1 || true)"

echo "==> serving $ROOT/dist/web on port $PORT"
if [ -n "$TS_IP" ]; then
	echo "==> tailnet URL:  http://${TS_IP}:${PORT}/"
fi
echo "==> local URL:    http://127.0.0.1:${PORT}/"

# `vite preview` honours the app's relative base and serves the SPA correctly.
exec npx vite preview --outDir dist/web --port "$PORT" --host 0.0.0.0 --strictPort
