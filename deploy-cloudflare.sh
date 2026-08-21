#!/usr/bin/env bash
# Deploy the web build to Cloudflare Pages.
#
#   ./deploy-cloudflare.sh
#
# A forwarder, kept because the old notes and muscle memory point at this path.
# The real script is scripts/deploy-cloudflare.sh, and it is the only one: two
# copies with two different defaults is how a deploy ends up on the wrong host.
#
# The target is one variable, DEPLOY_TARGET -- set it in .env (or .env.local, per
# box and never committed), or pass it for a single run:
#
#   DEPLOY_TARGET=twine-foo.tmpx.space ./deploy-cloudflare.sh
set -euo pipefail

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/deploy-cloudflare.sh" "$@"
