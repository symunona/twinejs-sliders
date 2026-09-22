# Environment — run, test, deploy

Pod rules (ports, services, `/cache`, jest memory cap) live in `/root/CLAUDE.md`.

## Run

```sh
npx vite --port 27020 --host 127.0.0.1      # dev server, pod port block
npm run build:web                            # production bundle -> dist/web
npm run build:format                         # -> public/story-formats/sliders-0.2.0/format.js
```

- Branches `develop` and `sliders` have different deps (sliders adds yaml, fflate,
  onnxruntime-web). `npm install` after a switch or `build:web` fails with TS2307.
- `voice-mode` adds `html-to-image`. Same rule.

## Test

```sh
pgrep -af 'bin/jest'                         # ALWAYS first
flock /cache/tmp/jest.lock npx jest --maxWorkers=2 --watchAll=false <paths>
npx jest format/src/twine-extensions         # after any format/ change
```

Never `npm test` — it is `--watch`.

### e2e

- Playwright on **27020**. Several specs call `page.goto` with a literal URL instead of
  `baseURL`, so changing the config alone points them at a dead port.
- Fresh pod: `npx playwright install chromium` (browsers in `/cache/playwright`).
- `server-sync` project needs `SLIDERS_GO=/usr/local/go/bin/go`.
- Full suite ~16 min. Several specs fail on a **clean checkout** — get a baseline before
  blaming your change: `git worktree add /cache/tmp/<name> <commit>` + symlinked
  `node_modules`.

## twine-cli

Not on PATH here.

```sh
node packages/twine-cli/dist/twine-cli.mjs <cmd>
node packages/twine-cli/build.mjs            # dist/ is gitignored and goes STALE
```

A stale bundle lints wrong (false "Unknown key"). Rebuild after any scene-schema change.

| profile | store |
|---|---|
| `live` (default) | https://twine-story-store.tmpx.space |
| `dev` | http://127.0.0.1:27100 (local Go store) |

Live store CORS allows `https://twine-ig.tmpx.space` only — browser work against live must
use the deployed app, not the dev origin.

**A checked-out editor OWNS the library.** `twine-cli put` while a browser holds the story
auto-syncing loses: the editor pushes its whole library back. Upload art BEFORE checkout,
or through the editor.

## Deploy

```sh
npm run deploy-cloudflare                    # -> https://twine-ig.tmpx.space
npm run deploy-cloudflare rebuild            # force
```

- Skips the build when a content FINGERPRINT of `BUILD_INPUTS` is unchanged. **A new
  top-level source directory must be added to `BUILD_INPUTS`** or it is invisible to the
  check and ships stale.
- Deploy from a clean worktree at the pushed head — the script builds the WORKING TREE.
- One refresh is enough now. If it ever needs more, suspect the service worker's precache
  and `navigateFallback`, not Cloudflare.

## Go

`~/.local/go/bin/go` for `go test ./...` in `server/`.
`SLIDERS_GO` for Playwright is `/usr/local/go/bin/go`.
