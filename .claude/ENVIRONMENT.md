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

## Legacy art → asset library

Old per-story art (server `assets.json` + blobs) is NOT migrated by the app. One-shot import:

```sh
node scripts/lib-import-legacy.mjs --dry-run --all <backupRoot>     # plan, writes nothing
node scripts/lib-import-legacy.mjs --all <backupRoot>               # or <storyDir>...
```

- Server/token: `--server/--token`, else `LIB_SERVER_URL/LIB_TOKEN`, else twine-cli profile.
- Per story: own collection (story name, numbered if taken), binding id = story id,
  assets (recipe, owner, sourceAsset remapped), characters (old `frames` migrated, poses
  -> new uuids), binding refs. Exact dup assets folded. Pose image named like its
  character -> `<name>-pose`. Re-run = skip. Story itself untouched.
- No pixelHash/phash (no decoder in node).
- Local try: `LIB_PORT=29101 scripts/lib-server-test.sh`, PUT the story, run with env.
- Backup 2026-09-28 (pre asset-library deploy): `/mnt/data_ssd/dev/twinery/ignotas/backups/`
  `pre-asset-library-2026-09-28.tgz` (DATA_DIR+binary+.env, has token) and
  `demos-2026-09-28/` (per story: story.json, assets.json, characters.json,
  blobs-by-id/, blobs-by-name/, INDEX.md). Also taskbot `~/dev/twinejs-sliders/server/backups/`.
