#!/usr/bin/env bash
# Build the static Twine/Sliders web app and deploy it to Cloudflare Pages.
#
#   npm run deploy-cloudflare                        # the default target
#   npm run deploy-cloudflare twine.tmpx.space       # a named one
#   npm run deploy-cloudflare twine                  # same thing, short
#   npm run deploy-cloudflare list                   # what is known
#   npm run deploy-cloudflare twine dry-run          # resolve it, build nothing
#   npm run deploy-cloudflare rebuild                # build even if unchanged
#
# The build is SKIPPED when nothing it reads has changed since the last one:
# every tracked and untracked-but-not-ignored file under the build's inputs is
# content-hashed into one fingerprint, written next to the output and compared
# on the next run. A commit is not the unit — this tree is edited by several
# sessions at once and is dirty most of the time, so a commit hash would both
# miss real changes and rebuild for changes to files the build never reads.
# `rebuild` forces one; deleting dist/web or the stamp does the same.
#
# The keywords take dashes too (`--list`), but only when this script is run
# directly: `npm run` keeps a leading-dash argument for itself unless it comes
# after a `--`. Hence the bare spellings.
#
# WHERE it goes is the public hostname, given as the first argument. A bare
# label gets DEFAULT_ZONE appended, so `twine-ig` means twine-ig.tmpx.space.
#
# The Pages project is usually the hostname's first DNS label, but not always —
# twine.tmpx.space lives in a project called "twine-sliders" — so TARGETS below
# maps the exceptions. Keep new ones there rather than in your memory: a wrong
# project name fails as "project X does not exist", which reads like a
# credentials problem and is not one.
#
# With no argument the target comes from DEPLOY_TARGET in the environment, then
# the repo's .env (or .env.local, which overrides .env and is never committed),
# then DEFAULT_TARGET below. PROJECT_NAME in the environment still wins over the
# table, for a project this script has never heard of.
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

# hostname -> Cloudflare Pages project, for the hostnames whose project is not
# simply their first DNS label. Anything absent here uses that label.
declare -A TARGETS=(
	[twine.tmpx.space]=twine-sliders
	[twine-ig.tmpx.space]=twine-ig
)

DEFAULT_TARGET=twine-ig.tmpx.space
DEFAULT_ZONE=tmpx.space

# What `npm run build:web` reads. Anything outside this list is invisible to the
# skip check, so add a new top-level source directory here as well as to the
# build — a missed entry means a stale deploy, which is the expensive failure.
BUILD_INPUTS=(
	src packages format public scripts
	index.html package.json package-lock.json .env
	vite.config.mts tsconfig.json tsconfig.electron.json
)

# The stamp lives outside dist/ so it is never uploaded, and the build output is
# checked separately — a wiped dist with a surviving stamp must still rebuild.
STAMP_FILE="$REPO_ROOT/node_modules/.cache/deploy-cloudflare-build-stamp"

# One hash over the content of every build input. Untracked files count (a new
# source file is usually the whole point of the deploy); ignored ones do not.
build_fingerprint() {
	{
		git -C "$REPO_ROOT" ls-files -z -- "${BUILD_INPUTS[@]}"
		git -C "$REPO_ROOT" ls-files -z --others --exclude-standard -- "${BUILD_INPUTS[@]}"
	} | sort -z | (cd "$REPO_ROOT" && xargs -0 -r sha1sum) | sha1sum | cut -d' ' -f1
}

usage() {
	echo "usage: npm run deploy-cloudflare [hostname|label] [dry-run] [rebuild]"
	echo ""
	echo "known targets:"

	local host
	for host in "${!TARGETS[@]}"; do
		printf '    %-24s -> project %s%s\n' "$host" "${TARGETS[$host]}" \
			"$([[ $host == "$DEFAULT_TARGET" ]] && echo ' (default)')"
	done | sort

	echo ""
	echo "Any other hostname works too; its project defaults to the first DNS"
	echo "label, or set PROJECT_NAME to say otherwise."
}

# Order does not matter, and the keywords are accepted with or without dashes:
# `npm run` keeps any leading-dash argument for itself unless it is written
# after a `--`, so `npm run deploy-cloudflare --list` never reaches this script.
DRY_RUN=
FORCE_BUILD=
TARGET_ARG=

while [[ $# -gt 0 ]]; do
	case "${1#--}" in
		list | help | h)
			usage
			exit 0
			;;
		dry-run | dry)
			DRY_RUN=1
			;;
		rebuild | force | force-build)
			FORCE_BUILD=1
			;;
		'')
			# A bare `--`, which npm uses to stop eating arguments. Not ours.
			;;
		*)
			if [[ -n $TARGET_ARG ]]; then
				echo "ERROR: more than one target given: '$TARGET_ARG' and '$1'" >&2
				echo "" >&2
				usage >&2
				exit 1
			fi

			TARGET_ARG="$1"
			;;
	esac

	shift
done

if [[ -n $TARGET_ARG ]]; then
	DEPLOY_TARGET="$TARGET_ARG"
else
	DEPLOY_TARGET="${DEPLOY_TARGET:-$(env_file_value DEPLOY_TARGET)}"
	DEPLOY_TARGET="${DEPLOY_TARGET:-$DEFAULT_TARGET}"
fi

# A bare label is this zone's. Anything already dotted is taken as written, so a
# host outside tmpx.space still deploys.
[[ $DEPLOY_TARGET == *.* ]] || DEPLOY_TARGET="$DEPLOY_TARGET.$DEFAULT_ZONE"

PROJECT_NAME="${PROJECT_NAME:-${TARGETS[$DEPLOY_TARGET]:-${DEPLOY_TARGET%%.*}}}"
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

# Enough to check a target resolves the way you meant before spending a build on
# it — the mistake this script exists to make hard.
if [[ -n $DRY_RUN ]]; then
	echo "==> Dry run, stopping before the build."
	exit 0
fi

FINGERPRINT="$(build_fingerprint)"
STAMPED=""
[[ -f "$STAMP_FILE" ]] && STAMPED="$(cat "$STAMP_FILE")"

if [[ -z $FORCE_BUILD && -f "dist/web/index.html" && $STAMPED == "$FINGERPRINT" ]]; then
	echo "==> Build inputs unchanged since the last deploy, reusing dist/web"
	echo "    (fingerprint ${FINGERPRINT:0:12}; 'npm run deploy-cloudflare rebuild' to force one)"
else
	echo "==> Building (npm run build:web)"
	# Cleared first: a stamp left over from the previous build would survive an
	# interrupted one and skip the next deploy's build over a half-written dist.
	rm -f "$STAMP_FILE"
	npm run build:web
fi

if [[ ! -f "dist/web/index.html" ]]; then
	echo "ERROR: build finished but dist/web/index.html does not exist." >&2
	echo "Something went wrong with the build; refusing to deploy." >&2
	exit 1
fi

# Written only once the build is known good, and re-read from the tree rather
# than reused: a build that takes minutes can finish after someone else's edit,
# and stamping the older fingerprint would skip the build that edit needs.
mkdir -p "$(dirname "$STAMP_FILE")"
build_fingerprint > "$STAMP_FILE"

echo "==> Deploying dist/web to Cloudflare Pages project '$PROJECT_NAME'"
npx --no-install wrangler pages deploy dist/web \
	--project-name "$PROJECT_NAME" \
	--branch main \
	--commit-dirty=true

echo ""
echo "==> Deployed. Live at: $PUBLIC_URL"
echo "    (Cloudflare also prints a per-deployment *.pages.dev preview URL above.)"
