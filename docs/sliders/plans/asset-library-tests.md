# Asset library — multi-user test suite

Status: plan, written before the code. Suite lives in
`packages/asset-library/src/__tests__/multi-user/`.

## Shape

Two (or three) independent "browsers" against one server. No React, no DOM. Only the sync
library.

```
World
 ├─ server: FakeLibServer        in-memory, implements asset-library-contract.md exactly
 │           (or real Go server when LIB_SERVER_URL is set — same suite)
 ├─ ana: Browser                 own LocalDb (memory), own BlobCache (memory), own engine
 └─ bo:  Browser
```

`Browser`:
- `engine` — the real `LibraryEngine`, same code the app runs.
- `db`, `blobs` — memory impls of the persisted stores. Survive `reload()`.
- `reload()` — drop the engine and everything in memory, build a new engine over the
  same `db` + `blobs`. Simulates F5.
- `offline()` / `online()` — transport throws `NetworkError` while offline. Socket
  messages dropped while offline.
- `requests` — log of every transport call: method, path, status. Used to assert
  "no writes" and "blob before record".

`World`:
- `settle()` — loop: deliver pending socket messages, drain every online outbox, run
  pulls, until one full pass issues zero requests. Fails after 50 passes = ping-pong.
- `socket: 'auto' | 'manual' | 'dead'` — `dead` = messages never delivered; clients must
  catch up by poll (`engine.poll()`).
- Deterministic. No timers. Engine debounce injected as a clock the test advances.

Fixtures: `png(color, w, h)` → real PNG bytes (tiny), so hashes differ per colour.
A fixture decoder (`pngDecoder`) stands in for createImageBitmap. Harness + fixtures live
in `src/testing/` (jest runs every file under `__tests__/` as a suite).

Each browser's engine talks to the fake through the real `HttpTransport` (fake exposes a
`fetch`), so the request log is method / path / status / If-Match / error code.

Real server: **multi-user runs against the fake only.** It needs socket delivery and
exact request counts (D2, E3), which a real server + real websocket cannot give
deterministically. What keeps the fake honest is `contract.test.ts`, which runs the same
cases against both:
`LIB_PORT=29101 scripts/lib-server-test.sh -- npx jest packages/asset-library/src/__tests__/contract`
(fresh `DATA_DIR` per run).

## Scenarios

Each named after the bug class it pins. `→` = expected.

### A. Edited art reaches the other browser (past: "edited never arrived")

| # | Steps | Expect |
|---|---|---|
| A1 | ana uploads `night`. settle. bo sees it. ana overwrites pixels (new blob). settle. | bo's `night` points at new sha, blob in bo's cache on demand. Server rev +1. |
| A2 | …then bo reloads, settles. | bo still new sha. bo sent zero record PUTs. Server rev unchanged. (past: B pushed old pixels back) |
| A3 | ana changes only `recipe.effect`. settle. | bo has effect. Same for `edits`, `tuning`, `mask`, `walk`, `origin`. |
| A4 | ana sets an unknown field `recipe.futureThing = 1`. settle. | bo has it. No whitelist. |
| A5 | ana writes sidecars `src` + `cutout`. settle. | bo's record names both, both blobs fetchable. |
| A6 | ana uploads art no scene references. settle. | bo sees it. (past: unreferenced art never sent) |
| A7 | ana renames `night` → `tavern-night`. settle. | bo resolves new name, old name fails. (past: rename never synced) |
| A8 | ana changes tags only. socket dead. bo polls. | bo has tags. (past: metadata-only change never woke B) |

### B. Modified while checked out (past: "clobbered when the other had it open")

"Checked out" = bo holds a dirty local edit not yet pushed (debounce pending, or offline).

| # | Steps | Expect |
|---|---|---|
| B1 | bo edits `tags` (dirty, not flushed). ana edits `recipe.effect`, pushes. settle. | both changes on server and on both browsers. No conflict. |
| B2 | bo repaints `night` offline. ana repaints `night`, pushes. bo online, settle. | bo's record in `conflict` state. Server = ana's. Nothing lost: bo's blob still in bo's cache. |
| B3 | B2 then bo resolves **mine**. settle. | server + ana = bo's pixels. rev = ana's rev + 1. |
| B4 | B2 then bo resolves **keep both**. settle. | `night` = ana's, `night-2` = bo's, both on both browsers. |
| B5 | B2 then bo resolves **theirs**. | bo = ana's. No write sent. (Blob cache GC not built; not asserted.) |
| B6 | bo renames to `a`, ana renames to `b`, concurrently. | conflict on `name`. Nothing auto-picked. |
| B7 | bo edits (dirty). ana deletes. settle. | bo gets delete-vs-edit conflict. Resolve restore → record back with bo's edit. |
| B8 | bo edits `tags`, ana edits `tags` differently. | set-merge: union of adds, both removes applied. No conflict. |
| B9 | bo edits `recipe.edits`, ana edits `recipe.mask`. | per-key recipe merge. No conflict. |

### C. Stale writer / ordering (past: "B overwrote A's blob and manifest")

| # | Steps | Expect |
|---|---|---|
| C1 | bo's base is rev 3, server at 5 (bo offline through 2 of ana's edits). bo edits, online, pushes before pulling. | bo's PUT 412 → merge → second PUT with If-Match 5. Server never goes back to rev-3 content. (Pushing first on purpose: a normal reconnect pulls first and merges without a 412.) |
| C2 | any record push | request log: `blobs/has` and blob PUTs precede the record PUT that names them. |
| C3 | server lost a blob (test deletes it). bo pushes record naming it. | 409 `blob-missing` → bo uploads → retry succeeds. |
| C3b | blob gone from server and from every cache. | record parked as `blob-lost`, settle ends (no retry loop). |
| C4 | blob upload fails mid-way (transport throws once). | record not sent. Retry later sends blob then record. |

### D. No ping-pong (past: two browsers pushing art at each other forever)

| # | Steps | Expect |
|---|---|---|
| D1 | ana makes 20 mixed edits. settle. | settle finishes. bo issued zero PUT/DELETE. |
| D2 | both edit disjoint records simultaneously. settle twice. | second settle issues zero requests. |
| D3 | bo receives the same socket message 3×. | one `/changes` read per message at most, zero writes. |

### E. Reload / persistence (past: "reload = server wins, edit lost")

| # | Steps | Expect |
|---|---|---|
| E1 | bo edits, reloads before debounce fires. settle. | edit reaches server. |
| E2 | bo offline, edits 3 records, reloads, online, settle. | all 3 on server. |
| E3 | clean bo reloads. settle. | zero writes. Cursor resumed: `/changes?since=` = saved cursor, not 0. |
| E4 | bo mid-conflict reloads. | conflict still shown, base/local/current intact. |

### F. Collections and sharing

| # | Steps | Expect |
|---|---|---|
| F1 | ana creates `tavern-set`, uploads 2. settle. | bo lists `tavern-set` and both assets. Blobs not fetched until requested. |
| F2 | bo binds `tavern-set` to story S. resolve `night` in S. | found. Blob fetched once. |
| F3 | ana and bo both create collection `props` offline. | second gets `collection-name-taken`; client renames `props-2`, reports it. |
| F4 | ana and bo both add `stool` to `tavern-set` offline. | second becomes `stool-2`, reported. Both present. |
| F5 | same bytes uploaded by ana and bo as different assets. | server stores one blob. Two asset records. |
| F6 | exact dupe detect: bo uploads bytes already in library. | engine reports existing asset(s) with same sha before creating. |
| F7 | pixel dupe: same image re-encoded. | `pixelHash` match reported (decoder injected in tests). |
| F8 | move asset `stool` from `Mine` to `tavern-set`. | collection field changes, name clash checked in target. |
| F9 | copy asset. | new id, same sha, `sourceAsset` set, zero blob uploads. |
| F10 | delete collection still bound by a story, bo knows the binding. | refused locally, nothing sent, nothing deleted. |
| F10b | same, empty collection, binding not pulled yet by bo. | 409 `collection-not-empty`, bo reverts its local delete, reports it. |

F10 split: deleting a non-empty collection means tombstoning its children first (the
server refuses the collection otherwise), so "409, nothing deleted" only holds when the
client refuses before sending, or the collection is already empty.

### G. Resolution, fork, update-all

| # | Steps | Expect |
|---|---|---|
| G1 | S binds [own, tavern-set, fantasy]. `night` in both tavern-set and fantasy. | resolves tavern-set. Lint reports ambiguous. |
| G2 | `fantasy/night` | fantasy's. |
| G3 | ana forks `night` into story S1's own collection, repaints. settle. | S1 → fork's pixels. S2 (bo, binds tavern-set) → original. YAML untouched. |
| G4 | unfork in S1. | S1 → original again. |
| G5 | usage: S1 and S2 bindings carry refs to `night`. | `usage(night)` = [S1, S2] on both browsers. |
| G6 | update-all repaint. settle. | S1, S2 both new pixels. |
| G7 | collection `locked`. | engine refuses update-all path without explicit override flag; fork allowed. |

### H. Characters

| # | Steps | Expect |
|---|---|---|
| H1 | ana creates character `ana-char` with 2 poses in tavern-set. settle. | bo has character, poses point at asset ids that exist on bo. |
| H2 | ana repaints a pose image. settle. | bo's pose image = new sha. |
| H3 | character `charId` clashes with an asset name in same collection. | `name-taken`. |

### I. Convergence (property)

Seeded random, 200 ops over 3 browsers: create/edit/rename/delete/repaint/move, random
offline windows, random reloads. After final `settle()` and resolving every conflict with
"theirs":
- every browser's records == server records (id, rev, body).
- every blob named by any record exists on server.
- no record whose last local edit was never acknowledged unless it went through a conflict.
- total settle passes bounded.

Seeds that failed once are pinned as fixed cases (42 and 1337 caught tombstone PUTs
naming un-uploaded blobs). `LIB_FUZZ=N` runs N more seeds.

## Also

- Go: `server/lib/*_test.go` — contract per endpoint, restart keeps seq, concurrent PUT
  same rev → exactly one 200, blob hash mismatch 422, namespace rules, GC keeps rev blobs.
- Contract: `packages/asset-library/src/__tests__/contract.test.ts` — transport-level,
  same file runs against `FakeLibServer` and Go (`LIB_SERVER_URL`). Keeps the fake honest.
