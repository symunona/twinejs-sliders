#!/usr/bin/env bash
# Build the static Twine/Sliders web app and deploy it to Cloudflare Pages.
#
#   ./scripts/deploy-cloudflare.sh
#   npm run deploy-cloudflare
#
# WHERE it goes is one variable, DEPLOY_TARGET: the public hostname. The Pages
# project is its first DNS label, so twine-ig.tmpx.space deploys to the project
# "twine-ig". Set it in the repo's .env (or .env.local, which overrides .env and
# is never committed), or pass it for one run:
#
#   DEPLOY_TARGET=twine-foo.tmpx.space npm run deploy-cloudflare
#
# Requires CLOUDFLARE_API_TOKEN. Put it in ~/.config/cloudflare.env
# (see cloudflare.env.example next to it) so it does not have to live in your
# interactive shell environment.
#
# Cache headers live in public/_headers, which vite copies to the site root.
# Read it before wondering why a deploy has not reached a browser: Pages puts a
# 4-hour floor under every Cache-Control it is given, and that file says which
# ones actually get through.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${CLOUDFLARE_ENV_FILE:-$HOME/.config/cloudflare.env}"

# One key out of the env files, last file wins. Read rather than sourced on
# purpose: .env holds build vars like `REACT_APP_VERSION=$npm_package_version`,
# and sourcing that under `set -u` outside npm aborts the script.
env_file_value() {
	local key="$1" value="" file line

	for file in "$REPO_ROOT/.env" "$REPO_ROOT/.env.local"; do
		[[ -f "$file" ]] || continue
		line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
		[[ -n "$line" ]] || continue
		value="${line#*=}"
		value="${value%$'\r'}"
		value="${value#"${value%%[![:space:]]*}"}"
		value="${value%"${value##*[![:space:]]}"}"
		value="${value%\"}"; value="${value#\"}"
		value="${value%\'}"; value="${value#\'}"
	done

	printf '%s' "$value"
}

DEPLOY_TARGET="${DEPLOY_TARGET:-$(env_file_value DEPLOY_TARGET)}"
DEPLOY_TARGET="${DEPLOY_TARGET:-twine-ig.tmpx.space}"
PROJECT_NAME="${PROJECT_NAME:-${DEPLOY_TARGET%%.*}}"
PUBLIC_URL="https://$DEPLOY_TARGET"

# Load the token file first, so the check below can see it. set -a exports
# everything the file defines, which is what wrangler needs.
if [[ -f "$CONFIG_FILE" ]]; then
	echo "==> Loading credentials from $CONFIG_FILE"
	set -a
	# shellcheck disable=SC1090
	source "$CONFIG_FILE"
	set +a
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
	echo "ERROR: CLOUDFLARE_API_TOKEN is not set." >&2
	echo "" >&2
	echo "Create the file:" >&2
	echo "    $CONFIG_FILE" >&2
	echo "" >&2
	echo "containing:" >&2
	echo "    CLOUDFLARE_API_TOKEN=<your token>" >&2
	echo "" >&2
	echo "There is a template at ${CONFIG_FILE}.example" >&2
	echo "Create a token at https://dash.cloudflare.com/profile/api-tokens" >&2
	echo "with permission: Account > Cloudflare Pages > Edit" >&2
	exit 1
fi

cd "$REPO_ROOT"

echo "==> Target:  $PUBLIC_URL"
echo "==> Project: $PROJECT_NAME"
echo "==> Building (npm run build:web)"
npm run build:web

if [[ ! -f "dist/web/index.html" ]]; then
	echo "ERROR: build finished but dist/web/index.html does not exist." >&2
	echo "Something went wrong with the build; refusing to deploy." >&2
	exit 1
fi

echo "==> Deploying dist/web to Cloudflare Pages project '$PROJECT_NAME'"
npx wrangler@4 pages deploy dist/web \
	--project-name "$PROJECT_NAME" \
	--branch main \
	--commit-dirty=true

echo ""
echo "==> Deployed. Live at: $PUBLIC_URL"
echo "    (Cloudflare also prints a per-deployment *.pages.dev preview URL above.)"
