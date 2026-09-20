# Next steps — 2026-09-20

Short list. Full backlog: [2026-09-20-sync-backlog.md](2026-09-20-sync-backlog.md).

## Do first

| # | what | size | why |
|---|---|---|---|
| 1 | **`split(re, 2)` data loss** | ~5 lines | SHIPPED TO READERS. Passage prose with a bare `--` line loses everything after it. Fix `vars-section.ts` AND `format/src/runtime/template/parse.ts:58` in ONE commit. `it.failing` in `vars-lines.test.ts` turns red when done — flip to `it` |
| 2 | **Merge in a real browser** | half a day | Merging went live today with unit tests only. Two browsers, one story, different passages. Nothing UI-facing changed, so no browser check was done |
| 3 | **`.then(f)` has no reject arm** | 1 line | `use-server-sync.ts`, reconcile. A throwing reconcile leaves the badge stale 300s and escapes unhandled. `.then(f, f)` |

## Then

| # | what | note |
|---|---|---|
| 4 | **"Unused" badge lies** | On a synced story the art WAS uploaded. Product call: widen `resolveSyncedRefs` to the whole library, or delete the badge. `en-US.json:487-488` moves either way |
| 5 | **Surface `manifest.missing`** | Server knows which asset bytes it lacks. Nothing tells the author. A 4MB background that failed to upload is invisible |
| 6 | **`GET ?since=rev`** | Download half. `diffPassages` is ready. Server keeps gzipped snapshots per rev, `REV_KEEP=20`. Fall back to full body when the base rev is pruned |
| 7 | **`format/src/runtime` into jest roots** | 908 LOC, 0 tests, unreachable. Needs `jest.config.js` — peer's, dirty. COORDINATE |
| 8 | **Repair 6 failing e2e specs** | Character editor + asset-editor background removal have no live coverage in any form |

## State as of this commit

- **Live** on https://twine-ig.tmpx.space up to `712eea8d`. Everything after is pushed, NOT deployed.
- 418 tests green in `src/store/persistence`. Go green. `tsc` clean.
- All four sync seams stubbable: save (`SyncRecordStore`), server (`fake-server.ts`), messages (`server-message.ts`), conflict (`reconcile.ts`).

### Shipped today

rev-lag fix · `applyPull` landing check · gzip + PATCH server · PATCH client · per-passage merge · dirty-hash allowlist · view-state strip · socket handler extracted · sync log · `fake-server` harness · artwork progress in toolbar.

## Known hazards — documented, not fixed

- Sync records never cleared when `backendUrl` changes — a rev can come from a different server's counter.
- Residual keepalive gap: tab hidden → push lands → tab returns WITHOUT reload → author edits before any poll. Genuinely ahead, correctly conflicts. Needs three-way merge on TEXT, not passages.
- Orphan `state: 'error'` records when a story is deleted locally mid-pull.
- No in-flight guard on a story pull (`pullAssets` has one). Two quick peer saves = two GETs, two undo clears.
- Socket index patches go stale where a poll would not (`deleted` leaves `assetCount`). Cosmetic; no UI reads it.

## Test convention — keep

Never assert buggy behaviour as expected. `it.failing` passes only while its assertion
fails: documents the defect, turns RED when fixed. **Three bugs here were found hiding
behind tests that asserted them.**

**Tell:** a test whose name reads as a complaint in an issue tracker must not be green by
asserting that complaint.

Prove guards BOTH directions — break the code, confirm red, including the direction that
trades a bug for a worse one (a merge that drops a passage is data loss).

Build-time tripwires beat tests where available: `KeyHelp<typeof KEYS>` makes an
undocumented key a build failure. Replicate, do not simplify.
