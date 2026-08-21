#!/usr/bin/env bash
# Build the static Twine/Sliders web app and publish it to Cloudflare Pages.
#
#   ./deploy-cloudflare.sh
#
# Target is driven by one environment variable:
#
#   DEPLOY_TARGET   public hostname to publish to   (default: twine-ig.tmpx.space)
#
# The Pages project name is derived from the first DNS label of DEPLOY_TARGET
# (twine-ig.tmpx.space -> project "twine-ig"), so pointing this at a different
# hostname is a one-variable change:
#
#   DEPLOY_TARGET=twine-foo.tmpx.space ./deploy-cloudflare.sh
#
# Credentials come from ~/.config/cloudflare.env (mode 0600, never committed).
# The token needs Account > Cloudflare Pages > Edit, plus Zone > DNS > Edit on
# tmpx.space if you want this script to attach the custom domain itself.
set -euo pipefail

DEPLOY_TARGET="${DEPLOY_TARGET:-twine-ig.tmpx.space}"
PROJECT_NAME="${PROJECT_NAME:-${DEPLOY_TARGET%%.*}}"
BUILD_DIR="dist/web"
CONFIG_FILE="${CLOUDFLARE_ENV_FILE:-$HOME/.config/cloudflare.env}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$REPO_ROOT"

# set -a so everything the file defines is exported -- wrangler reads the token
# from the environment, not from an argument.
if [[ -f "$CONFIG_FILE" ]]; then
	echo "==> Loading credentials from $CONFIG_FILE"
	set -a
	# shellcheck disable=SC1090
	source "$CONFIG_FILE"
	set +a
fi

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
	cat >&2 <<-MSG
	ERROR: CLOUDFLARE_API_TOKEN is not set.

	Create $CONFIG_FILE containing:

	    CLOUDFLARE_API_TOKEN=<your token>
	    CLOUDFLARE_ACCOUNT_ID=<your account id>

	Token: https://dash.cloudflare.com/profile/api-tokens
	       Account > Cloudflare Pages > Edit
	MSG
	exit 1
fi

echo "==> Target:  https://$DEPLOY_TARGET"
echo "==> Project: $PROJECT_NAME"

if [[ ! -d node_modules ]]; then
	echo "==> Installing dependencies (npm ci)"
	npm ci
fi

echo "==> Building (npm run build:web)"
npm run build:web

# A vite build that half-failed still leaves a dist directory behind, so check
# for the entry point rather than the directory.
if [[ ! -f "$BUILD_DIR/index.html" ]]; then
	echo "ERROR: build finished but $BUILD_DIR/index.html does not exist." >&2
	echo "Refusing to deploy a broken build." >&2
	exit 1
fi

echo "==> Deploying $BUILD_DIR to Cloudflare Pages project '$PROJECT_NAME'"
npx --yes wrangler@4 pages deploy "$BUILD_DIR" \
	--project-name "$PROJECT_NAME" \
	--branch main \
	--commit-dirty=true

echo ""
echo "==> Deployed. Live at: https://$DEPLOY_TARGET"
echo "    (Cloudflare also prints a per-deployment *.pages.dev URL above.)"
