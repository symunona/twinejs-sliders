# 11 — Server storage (autosave backend + server library)

**Status: design only. Nothing built.** Review artifact for `~/twine-server-storage.md`.

Go backend in `server/`, token auth, throttled autosave, server stories on the main screen,
version history, presence and soft locks. Internal tool, 2–3 people, one shared token.

## Why

Everything the fork writes lives in the browser: story text in `localStorage`, assets in
OPFS/IndexedDB, both bound to one origin (spec 03, spec 08). Clearing site data loses the
lot. `.sliders.zip` (spec 08) is a manual round trip you have to remember to make.

This is the unattended version, plus a shared library: stories on the server appear on the
main screen of every connected editor, a story that has been **checked out** pushes itself
as you work, and you can see who else is in the passage you just opened.

**In scope:** push, checkout, per-story `sync` flag, deletion that does not follow you,
version history with restore, presence, advisory passage locks.
**Not doing:** real-time character-level co-editing (see the end), shared undo, prefs sync,
per-user tokens, the legacy shared asset library.

## Standing assumptions

Written down because half the design falls out of them:

- **2–3 people, effectively no concurrent writes.** Two people editing the *same story* at
  the same second is the rare case, not the normal one. Locks exist to keep it rare;
  conflict handling exists to make the rare case non-destructive, not seamless.
- **Undo is single-user.** The undo stack stays local and is *cleared for a story when that
  story is replaced by a pull* — otherwise an undo could resurrect a passage that someone
  else deleted, from a state that never existed on the server.
- **Assets are per story.** `AssetStore.scope` is the story id. The legacy shared library
  (scope `''`) and `store/migrate-legacy-assets.ts` are removed as part of this work — no
  server support, no dual path, one rule.

## Shape of the thing

```
server/                  Go module, no framework, net/http + gorilla/websocket
  main.go
  config.go              .env → Config
  auth.go                bearer middleware, constant-time compare
  api/                   handlers, one file per resource
  hub/                   websocket: change bus + presence + locks (in memory)
  store/                 filesystem store, atomic writes, keep-N revisions
  data/                  DATA_DIR default, gitignored
```

```
data/
  stories/
    <storyId>/
      story.json           current Story object, verbatim
      assets.json          current manifest: AssetMeta[] + Character[]
      meta.json            rev, updatedAt, lastClient, deleted, deletedAt
      revs/
        index.json         [{rev, at, client, bytes, hash, passages, restoredFrom?}]
        000042.json.gz     story body at rev 42
        000042.assets.gz   manifest at rev 42
      assets/
        a_8f21.webp        raw bytes, filename = <assetId><ext from mime>
```

No zip: autosave writes every few seconds and the 95% case is "one passage changed, no
asset changed". Separate files keep a story PUT at a few hundred KB and asset PUTs rare.

`story.json`, not published HTML: `publishStory()` drops passage ids, `lastUpdate`,
`snapToGrid` and `ifid` (spec 08). A *pull* that lost passage ids would renumber the story
on every device. HTML is available on request with `?format=html`.

## Versioning

Simple on purpose: **keep the last N story bodies, restore one with a button.**

| | What it is | Bumps when |
|---|---|---|
| `rev` | write counter, per story, monotonic, never reused | every accepted write |
| snapshot | a stored copy of a body at some rev | every write that changed something |

`rev` is the concurrency token — `ETag`, `If-Match`, broadcast payloads. Snapshots are
storage policy and can be pruned without touching concurrency.

On an accepted `PUT /stories/{id}`:

1. new body → temp file → `rename` over `story.json` (atomic; a crash leaves the old one)
2. gzip the **previous** body into `revs/<oldRev>.json.gz`, plus the manifest as
   `revs/<oldRev>.assets.gz` when it changed
3. rewrite `revs/index.json` (a few KB, atomic)
4. `meta.json` gets the new rev, time, client
5. delete everything past the newest `REV_KEEP` (default 20)
6. broadcast `{"t":"story","id","rev","by"}` on the bus

A write whose body hashes the same as the current one stores no snapshot — autosave that
changed nothing costs nothing. Twenty snapshots of a 200 KB story is about 400 KB gzipped
per story, so `REV_KEEP` can be raised in `.env` without anyone noticing.

### Reading and restoring

| Method | Path | Does |
|---|---|---|
| `GET` | `/stories/{id}/revisions` | `revs/index.json`, newest first — no bodies read |
| `GET` | `/stories/{id}/revisions/{rev}` | that `Story` body |
| `GET` | `/stories/{id}/revisions/{rev}/assets` | the manifest as of that rev |
| `POST` | `/stories/{id}/restore` | `{"rev":37}` → copies that body to current, bumps rev, records `restoredFrom: 37` |

Restore is **server side and is an ordinary write**: it bumps the rev, snapshots what it
replaced, and broadcasts, so every other editor pulls it like any other change. Restoring
never destroys — the version you restored over is itself a snapshot now.

**Assets and old revisions.** Blobs orphaned for `ORPHAN_TTL` (7 days) get swept, so a body
older than that can land on art the server no longer holds. The manifest snapshot next to
each body makes that answerable rather than mysterious: `POST /restore` returns
`{"missingAssets":[…]}` and the dialog says which pictures did not come back.

### In the UI

**History…** in the story-edit route menu. One list, newest first: *when*, *who*, passage
count, size, and a **Restore** button per row; the current version sits at the top marked
*now*. Restore asks once ("Restore the version from 10:12 by mira? The current version
stays in history."), then the story updates in place. That is the whole feature — no
diffing, no branching, no labels.

## Deployment

Runs on **taskbot** (public VPS) at `https://twine-story-store.tmpx.space`, behind Caddy.
The Go process binds `127.0.0.1:8080`; Caddy terminates TLS. Editor is HTTPS, backend is
HTTPS, no mixed content anywhere.

```caddy
twine-story-store.tmpx.space {
  encode zstd gzip
  request_body { max_size 80MB }   # ≥ MAX_ASSET_BYTES, or Caddy 413s before Go sees it
  reverse_proxy 127.0.0.1:8080
}
```

Websockets need nothing extra — modern Caddy passes `Upgrade` through. Systemd unit next to
the existing `cloudflared-twine-dev` one (`scripts/tunnel-dev.sh` is the pattern to copy).

### CORS

Editor origin is `https://twine-ig.tmpx.space` or `http://127.0.0.1:5173`; the API is a
different origin, and every request carries `Authorization`, so every request is
preflighted. `OPTIONS` answers with `Access-Control-Allow-Origin` echoing an allowed
origin, `-Allow-Headers: authorization, content-type, if-match, if-none-match, x-asset-hash, x-client-id, x-client-name`,
`-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS`, `-Expose-Headers: etag`,
`-Max-Age: 86400`. Origins from `CORS_ORIGINS` (comma list). No `Allow-Credentials` —
there are no cookies. Done in Go, not Caddy: one place, and it varies per route anyway.

## Auth and identity

`Authorization: Bearer <token>` against `AUTH_TOKEN` from `.env`, compared with
`crypto/subtle.ConstantTimeCompare`. Server refuses to start on an empty or under-16-char
token. Everything needs it except `GET /api/v1/health`.

**One token, several people — accepted.** This is an internal tool. Identity is a label,
not a credential: every request carries `X-Client-Id` (uuid minted once per browser, kept
in prefs) and `X-Client-Name` (the **Username** preference). They drive presence, lock
ownership, revision history and "who changed this" messages. Anyone with the token can
claim any name; nobody is trying to.

Username defaults to `user-<first 4 of client id>` and is a plain text field at the top of
the backend prefs section, above URL and token, because it is the one people actually want
to change. It is sent on every request and on the websocket `hello`.

## API

Base path `/api/v1`. JSON in, JSON out. Errors are `{"error":{"code":"…","message":"…"}}`,
codes: `unauthorized`, `not_found`, `conflict`, `deleted`, `too_large`, `bad_request`,
`hash_mismatch`, `internal`.

### Probe

| | |
|---|---|
| `GET /health` | **no auth.** `{"ok":true,"service":"twine-sliders-server","apiVersion":1}` |
| `GET /ping` | auth. version, `storyCount`, `bytesUsed`, `maxAssetBytes`, `maxStoryBytes`, `events:true`, `clients:[{id,name}]` |

Two endpoints so **Test** can separate three failures: unreachable ("wrong address or
server down"), `/health` ok + `/ping` 401 ("server is there, token rejected"), both ok
("Connected — 3 stories, 46 MB, also here: mira").

### Stories

| Method | Path | Does |
|---|---|---|
| `GET` | `/stories` | index, no passage text |
| `GET` | `/stories/{id}` | the `Story`. `ETag: "<rev>"`, honours `If-None-Match` → `304`. `?format=html` publishes |
| `PUT` | `/stories/{id}` | write; `?revive=1` to undelete |
| `DELETE` | `/stories/{id}` | tombstone: drop current body and asset bytes, keep `meta.json` and `revs/`. `?purge=1` erases the directory |

Index entry — enough to draw a card without downloading anything:

```json
{"id":"…","ifid":"…","name":"Lighthouse","rev":42,"updatedAt":"…","lastClient":"mira",
 "passageCount":83,"bytes":214880,"assetCount":31,"assetBytes":41221904,"deleted":false}
```

Tombstones are included and flagged: a client that has the story must be able to learn it
was deleted; one that never had it filters them out. Tombstones and their history expire
after `TOMBSTONE_TTL` (90 days).

`PUT` body is `{"story": {…}, "client": "twine-sliders 2.10.0-sliders"}` →
`{"id","rev","updatedAt","bytes"}`. `sync` is **stripped** on write and never returned:
whether a story syncs is each editor's local decision.

`If-Match: "<rev>"` means "I am updating the version I last saw". Mismatch → `412`, nothing
written, body carries `{"rev":44,"updatedAt":"…","lastClient":"mira"}`. PUT to a tombstone
without `?revive=1` → `409 deleted`; with it, the tombstone clears and the rev chain
*continues* — a monotonic rev per story id is what makes every other rule work.

### Assets

Per story, always. No library-wide endpoints — there is no shared library any more.

| Method | Path | Does |
|---|---|---|
| `GET` | `/stories/{id}/assets` | `{"version":1,"assets":[…],"characters":[…],"rev":7,"missing":[…]}` |
| `PUT` | `/stories/{id}/assets` | replace the manifest (own rev, own `If-Match`) |
| `POST` | `/stories/{id}/assets/diff` | `{"assets":[{"id","hash","bytes"}]}` → `{"missing","present","stale"}` |
| `HEAD` | `/stories/{id}/assets/{assetId}` | `Content-Length`, `ETag: "<hash>"` |
| `GET` | `/stories/{id}/assets/{assetId}` | bytes |
| `PUT` | `/stories/{id}/assets/{assetId}` | upload; `X-Asset-Hash` required |
| `DELETE` | `/stories/{id}/assets/{assetId}` | remove bytes; manifest untouched |

`AssetMeta` and `Character` are verbatim `@sliders/scene-types`. `missing` lists manifest
entries whose bytes are absent, so a checkout knows it is incomplete before it starts.
`diff` is what stops autosave re-uploading a 4 MB background; `stale` = present under a
different hash.

Upload verifies `X-Asset-Hash` against the received bytes (`422 hash_mismatch` otherwise) —
the hash is whatever `packages/asset-store` already computes for `AssetMeta.hash`, never a
second one. Temp file + `rename`, so a dropped connection cannot leave a truncated asset
that then passes `HEAD`. The manifest is written **after** the blobs it names.

Bytes are not deduped across stories: per-story directories make delete `os.RemoveAll`,
worth more than the disk a shared background costs. A blob absent from the manifest for
`ORPHAN_TTL` (7 days) is swept by a janitor on start and daily.

### Limits

`MAX_ASSET_BYTES` (64 MB), `MAX_STORY_BYTES` (32 MB), both from `.env`, both in `/ping` so
the client complains before uploading. `http.MaxBytesReader` on every body.

### Websocket: bus, presence, locks

`GET /api/v1/events`, upgraded. Browsers cannot set headers on a WS handshake, so auth
rides the subprotocol: the client offers `bearer, <token>`; the server checks and echoes
`bearer`. Same token, same middleware.

**The server takes no writes over the socket.** Story and asset writes stay on HTTP, where
auth, limits, atomic writes and revisions already live. The socket carries notifications
and ephemeral state only — that is what keeps it a day of work and unable to corrupt
anything.

Client → server:

```json
{"t":"hello","client":"…","name":"mira","stories":["…"]}
{"t":"focus","story":"…","passage":"…"}      // passage null = in the story map
{"t":"blur","story":"…","passage":"…"}
{"t":"steal","story":"…","passage":"…"}      // take over a lock
{"t":"ping"}                                  // every 20 s
```

Server → client:

```json
{"t":"story","id":"…","rev":43,"by":"mira"}      {"t":"deleted","id":"…"}
{"t":"revived","id":"…","rev":44}                {"t":"assets","story":"…","rev":8}
{"t":"presence","story":"…","clients":[{"id","name","passage":"…","since":"…"}]}
{"t":"stolen","story":"…","passage":"…","by":"mira"}
```

Presence lives in memory only — a map of client → focus, nothing on disk, and it is empty
after a restart, which is correct. An entry expires 60 s after its last `ping`, so a closed
laptop releases its locks; `beforeunload` sends an explicit `blur` for the common case.

Everything degrades to polling `GET /stories` every 30 s when the socket is down: changes
still arrive, presence and locks simply go away. Same client code path, so the socket can
ship after everything else.

## Soft locks

Advisory, per passage, no server-side truth beyond the presence map:

- Opening a passage sends `focus`. Anyone else with that passage open sees it **locked**.
- A locked passage editor opens **read-only**, with a banner: *"mira is editing this
  passage"*, and a **Take over** button. The story map marks the passage too.
- **Take over** sends `steal`: both editors become writable, both get a banner saying so.
  It does not kick anyone — kicking a person mid-sentence is how you lose the sentence.
  With 2–3 people, "we can both see this is happening" is enough.
- Locks are per passage, not per story: two people in different passages of one story is a
  normal, unremarked situation.
- No CodeMirror sync, no OT, no CRDT. The unit of merge is a whole passage, saved by
  whoever holds it.

Who wins a genuine race is still `rev` + `If-Match` (below). Locks make races rare;
they do not pretend to prevent them.

## Conflicts

The server never merges and never loses a version.

```
A  edit … debounce … PUT If-Match:"42"  → 200 rev 43
B  edit … debounce … PUT If-Match:"42"  → 412 rev 43     B parks that story's queue
B  banner: "Lighthouse changed on the server (mira, 10:12). Resolve…"
```

Only B's queue for that story parks; B's other stories keep syncing and B's edits are still
in B's `localStorage`. Resolve dialog, three buttons:

- **Keep mine** — re-`GET` the current rev, `PUT If-Match` with it. The other version is
  already a snapshot in `revs/`, one click from coming back.
- **Take theirs** — the local version is first duplicated as *"Lighthouse (my copy)"* with
  `sync: false`, then the server body replaces the synced one.
- **Later** — stays parked, card stays red.

**No three-way merge.** It was in the previous draft; with presence, locks and no
concurrent writes it would be a few days of work plus a diff UI for a case that should fire
a handful of times a year, and every firing already ends with both versions intact. If it
turns out to fire weekly, the story's stable passage ids make `merge-story.ts` a pure
function and it can be added then, with no protocol change.

## The library on the main screen

Three rules:

1. **The local store is the only thing the UI renders from.** A server story is either
   *checked out* — an ordinary local story with `sync: true` — or a **ghost**: an index
   entry with no local story, drawn as a dimmed card. No third, half-remote object, so
   nothing else in the fork has to change.
2. **`sync` is a per-story, local-only `Story` prop**, default `false`, stripped on the
   wire. Each editor decides for itself and an archive never drags someone else's setting
   along.
3. **No sync path destroys anything.** Worst case, something gets renamed.

### Cards

Checked-out stories are **pinned above everything else**, in their own group at the top of
the list, each with a cloud badge; the rest of the library sorts as it does today, and
ghosts come last, dimmed, newest first.

| State | When | Card |
|---|---|---|
| checked out | `sync: true`, rev matches | pinned top, cloud tick, "Synced 10:12 · mira" |
| pushing / pulling | queue busy | pinned top, cloud with up/down arrow |
| ghost | in index, not local | bottom, dimmed, "On server · 83 passages · 41 MB" → **Check out** |
| local | `sync: false` | normal card → **Publish to server** |
| conflict | index rev > local, local dirty | pinned top, red cloud → **Resolve…** |
| gone | `sync: true`, tombstoned | pinned top, "Removed from server", sync auto-off → **Republish** |
| error | 3 failed pushes | pinned top, cloud-slash + tooltip → Retry |

The badge is also the presence spot: when someone else is in that story, their initial sits
next to the cloud.

### Flows

**Connect / refresh.** `GET /stories`, then per id:

| Local | Server | Do |
|---|---|---|
| — | present | ghost |
| `sync: false` | present | nothing; card notes "also on server" |
| `sync: true`, clean, behind | present | pull silently, clear that story's undo stack |
| `sync: true`, dirty, behind | present | conflict |
| `sync: true` | tombstone / absent | `gone`; flip `sync: false`, keep the text |
| `sync: true`, dirty, current | present | push |

**Open a checked-out story.** `GET /stories/{id}` with `If-None-Match: "<rev>"` — usually
`304` and nothing happens. `200` + clean → replace and clear undo. `200` + dirty →
conflict.

**Check out.** `GET /stories/{id}` → `createStory` keeping the **server's id and ifid**,
`sync: true`, card jumps to the pinned group. Then `GET /assets`, `POST /assets/diff`, and
**download every missing asset eagerly** through `AssetStore.importAsset` — the same
plan/outcome rules bundle import already implements (`AssetPlanItem`, spec 08). The card
shows a progress bar; the editor opens as soon as the text lands and art fills in behind
it. Eager because a story with half its backgrounds missing is a bug report, and 40 MB on
an internal LAN is a few seconds.

**Publish.** Menu item on a local story: `sync: true`, `PUT` with no `If-Match`, then
manifest and assets. If that id already exists on the server, the dialog offers *Overwrite*
or *Publish as new* (mints fresh id + ifid first), which is what almost everyone means.

**Copy stays local.** `duplicateStory` spreads `...story`, so it must explicitly set
`sync: false` and drop the sync record; it already mints a new `id` and `ifid`. Same for
`importStories` and archive import. Anything arriving from a file is local until someone
publishes it.

**Delete.** Local delete never touches the server; the confirmation grows an *Also remove
from server* checkbox, off by default. Removing from the server tombstones it — every other
editor's copy flips to `gone`, text intact, **Republish** (`PUT ?revive=1`) restarting the
same rev chain, and the history in `revs/` survives the whole round trip.

### Sync state

Local side table, one small record per story, not on the `Story`:

```ts
{storyId, rev, pushedHash, state, lastError, lastPushedAt, lastPulledAt}
```

`pushedHash` hashes the story JSON as last pushed; "dirty" is `hash(now) !== pushedHash`,
which beats comparing `lastUpdate` (it moves on trivial actions and cannot survive a clock
difference). Small enough for `localStorage` next to Twine's own keys.

## Client code map

```
src/store/persistence/server/
  client.ts            fetch wrapper: bearer, client id + name, ETag, error mapping
  sync-record.ts       the local side table
  sync-queue.ts        per-story debounce 5 s / max wait 30 s, backoff 5→15→60, cap 3
  use-server-sync.ts   hook mounted beside <StateLoader>
  asset-sync.ts        diff → upload missing → PUT manifest
  checkout-story.ts    pull story, then all assets via the bundle-import plan
  events.ts            websocket + polling fallback
  presence.ts          presence map, lock lookup, focus/blur/steal
src/dialogs/server-conflict/
src/dialogs/story-history/
src/components/story/story-card/     cloud badge, ghost variant, pinned group
```

Mounted **alongside** `usePersistence()`, never inside it: `usePersistence` picks one of
electron/localStorage as the store of record, and a failing network must not be able to
break the local save path. Trivial changes are filtered through the existing
`isPersistableStoryChange` / `isPersistablePassageChange` before anything hits the network.
Flush on `visibilitychange → hidden` with `fetch(…, {keepalive: true})`.

Prefs (`prefs.types.ts` + `defaults.ts`): `backendUsername`, `backendUrl`, `backendToken`,
`backendAutosave`, `backendClientId`. The token sits in `localStorage` in the clear,
exactly like `geminiApiKey` and `openAiApiKey` — same note, same words, next to the field.

## Testing

Three layers, cheapest first. The E2E layer is designed now and written when the feature
exists.

### 1. Go tests (`server/`)

`go test ./...`, no network, `t.TempDir()` for data:

- `store`: rev monotonic across writes; `If-Match` accept/reject; atomic write leaves the
  old body on a simulated crash; tombstone → revive keeps the rev chain; purge removes
  everything; orphan sweep respects TTL.
- `store` revisions: N+5 writes leave exactly `REV_KEEP` snapshots, newest kept; an
  unchanged body adds none; restore snapshots what it replaced and reports missing assets.
- `api`: `httptest` handlers for every route, including 401 without a token, 412 on stale
  `If-Match`, 409 on a tombstone, 422 on a bad `X-Asset-Hash`, 413 over the limits.
- `hub`: presence expiry after a missed heartbeat, `steal` fan-out, slow-client drop.
- one concurrency test: 50 goroutines PUT the same story; assert every response rev is
  unique, the final body is one of the written bodies, and `revs/index.json` parses.

### 2. Jest (`src/store/persistence/server/__tests__/`)

Fake timers, mocked `fetch`, no server:

- `sync-queue`: debounce coalesces a burst into one PUT; max-wait fires during continuous
  typing; backoff 5→15→60 then park; a 412 parks only that story.
- `sync-record`: dirty detection by hash, survives a `lastUpdate` change alone.
- decision table from "Connect / refresh" as a pure function — every row above is a case.
- `presence`: lock lookup, self is never a lock, expiry.
- `checkout-story`: asset plan reuse, missing bytes reported not thrown.

### 3. Playwright, two browsers (`e2e/server-sync.spec.ts`)

The point of this layer is the thing unit tests cannot show: **two editors, one server,
watching each other**.

Harness (`e2e/server-helpers.ts`):

- a fixture spawns the real Go binary per spec file: `--data <tmpdir> --addr 127.0.0.1:0`,
  `AUTH_TOKEN` from env, port read from its first stdout line. Parallel-safe, no shared
  state, torn down with the temp dir.
- **two browser contexts**, not two pages — `localStorage`, IndexedDB and OPFS are
  per-context, so two contexts are two genuinely independent editors. Call them `alice` and
  `bob`; each gets `page.addInitScript` seeding prefs (url, token, username) plus
  `sliders.sync.debounceMs = 50` so tests do not sit through a 5 s debounce. One separate
  spec sets prefs through the real UI and clicks **Test**, so the manual path stays covered.
- assertions poll `window.__slidersSync` (sync record + presence, exposed in dev builds)
  with `expect.poll`, and stable `data-testid`s on every badge and banner. No `waitForTimeout`.
- reuses `e2e/sliders-helpers.ts` (`createStory`, `openPassage`, `setPassageText`) and the
  existing asset fixtures, so a checkout test carries real image bytes.

**The stories, in the order they should be written:**

1. **Publish makes a ghost.** Alice creates a story, Publish. Bob refreshes → a ghost card
   with the right name and passage count, dimmed, at the bottom.
2. **Check out pins it.** Bob checks out the ghost → card moves to the top group with a
   cloud badge, passage text matches Alice's, and an asset Alice uploaded opens in Bob's
   asset manager (eager download landed real bytes, not a stub).
3. **Edit flows across.** Alice edits a passage; within a couple of seconds Bob's card shows
   pulling then synced, and Bob's copy of that passage has Alice's text — **without a
   reload**. This is the one that proves the bus.
4. **Presence.** Alice opens the story map → Bob's card shows Alice's initial. Alice
   navigates away → it clears within the heartbeat window.
5. **Soft lock.** Alice opens passage *Harbour*. Bob opens the same passage → read-only,
   banner names alice, story map marks it. Alice closes the editor → Bob's banner clears
   and typing works again.
6. **Lock expiry.** Alice's context is closed outright (no `beforeunload` delivered) → Bob's
   lock clears after the expiry window, not before.
7. **Take over.** With Alice holding *Harbour*, Bob clicks **Take over** → both editors
   writable, both showing the shared-editing banner. Then Bob types, Alice types, both
   saves land, last write wins on the passage — asserted explicitly so the behaviour is a
   decision and not a surprise.
8. **Conflict and resolve.** Bob's socket and HTTP are blocked with `context.route`; both
   edit the same story; Bob comes back → 412, red card, resolve dialog. *Keep mine* → Alice
   pulls Bob's version. Repeat the test with *Take theirs* → Bob keeps a
   *"… (my copy)"* local story with his text.
9. **Version history.** Alice saves three distinct versions, opens **History**, sees three
   rows with her username, restores the first → her editor shows the old text and Bob
   receives it too.
10. **Delete and republish.** Alice removes from server → Bob's card says *Removed from
    server*, text intact, sync off. Bob republishes → Alice sees it return as a ghost, checks
    it out, and the history from before the delete is still listed.
11. **Copy stays local.** Bob duplicates a checked-out story → the duplicate has no cloud
    badge and never appears in Alice's list.
12. **Offline and back.** Kill the server mid-edit: Alice keeps editing, local saves keep
    working, the badge goes to error. Restart → the parked push flushes without a reload,
    and nothing was lost.

Run with `npm run e2e:sync` (a Playwright project that only builds the server once). Story 3
and story 5 are the two worth having; the rest exist so a refactor cannot quietly break the
edges.

## Complexity, in build order

| Phase | What | Rough cost |
|---|---|---|
| 1 | Go: auth, CORS, stories CRUD, revisions (keep N), tombstones, limits, tests | 2.5 d |
| 2 | Go: assets — manifest, diff, blobs, janitor, tests | 1 d |
| 3 | Prefs section (username, url, token, Test), client id | 0.5 d |
| 4 | Push autosave: queue, debounce, backoff, badge | 1.5 d |
| 5 | Library: index, ghosts, checkout, publish, delete/republish, pinned group | 2 d |
| 6 | Conflict dialog | 1 d |
| 7 | Websocket: bus + polling fallback | 1 d |
| 8 | Presence + soft locks | 1 d |
| 9 | History dialog: list + restore | 0.5 d |
| 10 | Playwright two-browser suite | 1.5 d |
| — | Remove legacy shared asset library and its migration | 0.5 d |

~14 days of work, and phases 1–6 are usable on their own.

## Not doing: real-time co-editing

For the record, since it is the obvious "why not just": character-level co-editing needs
CRDT or OT. The wire part is cheap — Yjs plus a room router, and `y-codemirror` does bind
CodeMirror 5, which is what this fork uses. The cost is in this repo: the stories store is a
reducer plus `undoable-stories`, and with a CRDT the `Y.Doc` becomes the source of truth
while the reducer becomes a projection of it — every action creator turns into a Y
transaction, undo becomes a per-origin `Y.UndoManager`, persistence becomes an update log.
Three to six weeks, plus a permanent tax on every store change and every merge from upstream
twinejs. Assets could not ride it anyway, and scene YAML merged character-by-character can
be textually clean and still fail to parse.

Nothing here blocks it later: revs, tombstones and per-story directories survive, a
`ydoc.bin` appears beside `story.json`, and `story.json` becomes a snapshot.
