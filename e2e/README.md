# Playwright suites

`playwright.config.ts` sets `testDir: './e2e'` and starts vite on 27020 itself
(`reuseExistingServer`, so a dev server you already have is used as is). Chromium only.

Two projects:

| Project | Files | What it needs |
|---|---|---|
| `chromium` | everything except `server-*.spec.ts` | the dev server |
| `server-sync` | `server-*.spec.ts` | the dev server **and** a Go toolchain |

```sh
npx playwright test              # both projects, each file once
npm run e2e:sync                 # only the server-sync project
npx playwright test e2e/server-locks.spec.ts     # one file
npx playwright test --project=server-sync -g "Soft lock"
```

## The server-sync suite (spec 11)

Two browser contexts, `alice` and `bob`, against a real `twine-story-store` process.
Contexts rather than pages because `localStorage`, IndexedDB and OPFS are per context —
two pages in one context would share a story library and prove nothing.

| File | Spec 11 stories |
|---|---|
| `server-sync.spec.ts` | 1 publish → ghost, 2 check out, 3 edit flows across (the change bus) |
| `server-locks.spec.ts` | 4 presence, 5 soft lock, 6 lock expiry, 7 take over |
| `server-conflict.spec.ts` | 8 conflict, resolved both ways |
| `server-library.spec.ts` | 9 version history, 10 delete and republish, 11 copy stays local |
| `server-offline.spec.ts` | 12 offline and back — its own file because it kills the server |
| `server-prefs.spec.ts` | the prefs form and **Test**, the one path the others skip |

`e2e/server-helpers.ts` is the harness:

- **The binary is built once.** `go build` into `$TMPDIR/sliders-server-e2e/twine-store`,
  written to a private path and `rename`d into place so parallel workers cannot collide.
  Set `SLIDERS_GO` if your Go is not at `/home/ignotas/.local/go/bin/go`.
- **One server per worker**, spawned `--addr 127.0.0.1:0 --data <fresh tmpdir>` with
  `AUTH_TOKEN` and `CORS_ORIGINS=*` in its environment. The port comes from the binary's
  first stdout line. A worker-scoped fixture owns it; an auto fixture purges every story
  before each test, so tests never inherit each other's library. The temp directory goes
  with the fixture.
- **Prefs are seeded through `context.addInitScript`** in the shape
  `local-storage/prefs/load.ts` reads — `backendUrl`, `backendToken`, `backendUsername`,
  a distinct `backendClientId` per editor, `backendAutosave`, plus
  `sliders.sync.debounceMs = 50` so nothing waits out the shipped five second debounce.
- **No `waitForTimeout`.** Assertions either poll `window.__slidersSync` (records,
  ghosts, presence, connected) with `expect.poll` or use `expect(locator)` auto-waiting.
  Where a test needs the network to go away it uses `context.route` for HTTP and a
  `window.WebSocket` switch installed at context creation — Playwright 1.45 has no
  `page.routeWebSocket`, and `context.route` never sees an upgrade.

Run times: the conflict specs wait out the push queue's 5s → 15s → 60s retry ladder, and
`server-offline.spec.ts` waits for it to give up entirely, so those two files take one to
two minutes each. Everything else is seconds.

### Known gaps

- **Story 6 covers a closed browser, not an idle one.** Closing Alice's context kills her
  socket, and the hub drops her presence with the connection. The *idle* path — a laptop
  that stops sending heartbeats — expires after `hub.defaultPresenceTTL`, 60 s, and
  `server/config.go` exposes no `PRESENCE_TTL`, so covering it from outside the binary
  would cost a minute of wall clock per run for a rule `hub_test.go` already asserts at
  200 ms. Wire `PRESENCE_TTL` into `Config` and the test can cover both.
- **`Version history` is `test.fixme`** against a real defect: every publish, checkout and
  pull is followed by a duplicate PUT differing only in `lastUpdate`, so three saved
  versions list as four rows. The comment on the test names the code. The restore half of
  story 9 is covered by `Version history: restore round trip`, which passes.
