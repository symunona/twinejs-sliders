#!/usr/bin/env bash
# Control the cloudflared tunnel that exposes the local vite dev server.
#
#   npm run deploy-tunnel-dev -- start|stop|restart|status|logs
#   ./scripts/tunnel-dev.sh start
#
# The tunnel publishes the dev server running on 127.0.0.1:5173 at
# https://twine-dev-xayah.tmpx.space -- it does NOT start the dev server itself.
set -euo pipefail

UNIT="cloudflared-twine-dev"
DEV_HOST="127.0.0.1"
DEV_PORT="5173"
PUBLIC_URL="https://twine-dev-xayah.tmpx.space"

usage() {
	cat <<EOF
Usage: npm run deploy-tunnel-dev -- <action>
   or: ./scripts/tunnel-dev.sh <action>

Note the '--' when going through npm: it passes the action to the script
instead of letting npm swallow it.

Actions:
  start     Start the $UNIT service
  stop      Stop the $UNIT service
  restart   Restart the $UNIT service
  status    Show service status, and whether the dev server is up
  logs      Follow the service journal (Ctrl-C to quit)

The tunnel fronts the vite dev server on ${DEV_HOST}:${DEV_PORT}
and serves it at $PUBLIC_URL
EOF
}

# Print whether the vite dev server is actually listening. Informational only:
# never fails the script, because the unit can legitimately be up on its own.
check_dev_server() {
	if ss -tln | grep -q "${DEV_HOST}:${DEV_PORT}"; then
		echo "OK: dev server is listening on ${DEV_HOST}:${DEV_PORT}"
	else
		echo "WARNING: nothing is listening on ${DEV_HOST}:${DEV_PORT}"
		echo "WARNING: the tunnel will return errors until you run 'npm start'"
	fi
}

ACTION="${1:-}"

case "$ACTION" in
	start)
		sudo systemctl start "$UNIT"
		echo "==> Started $UNIT"
		echo ""
		check_dev_server
		echo ""
		echo "REMINDER: the tunnel only forwards traffic. The vite dev server"
		echo "          must be running separately -- 'npm start' in this repo."
		echo ""
		echo "Public URL: $PUBLIC_URL"
		;;
	stop)
		sudo systemctl stop "$UNIT"
		echo "==> Stopped $UNIT"
		;;
	restart)
		sudo systemctl restart "$UNIT"
		echo "==> Restarted $UNIT"
		echo ""
		check_dev_server
		echo ""
		echo "Public URL: $PUBLIC_URL"
		;;
	status)
		# systemctl status exits non-zero when the unit is inactive or missing;
		# that is information, not a script failure, so do not let set -e abort
		# before the dev-server check below runs.
		sudo systemctl status "$UNIT" --no-pager || true
		echo ""
		check_dev_server
		;;
	logs)
		sudo journalctl -u "$UNIT" -f -n 50
		;;
	"")
		echo "ERROR: no action given." >&2
		echo "" >&2
		usage >&2
		exit 1
		;;
	*)
		echo "ERROR: unknown action '$ACTION'." >&2
		echo "" >&2
		usage >&2
		exit 1
		;;
esac
