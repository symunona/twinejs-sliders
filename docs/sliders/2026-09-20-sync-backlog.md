# Sync backlog — 2026-09-20

What is left after the sync work of 2026-09-20. Written at the point where four threads
were running in parallel; everything below was proposed, scoped and NOT done.

Companion docs: [rev-lag](bugs/rev-lag.md) (fixed), [test-audit](test-audit.md),
[11-server-storage](11-server-storage.md).

## Shipped 2026-09-20, for context

| commit | what |
|---|---|
| `1c12ef6f` | server: gzip responses, PATCH story upload, revision chain across PUT+PATCH |
| `d3df1850` | toolbar says "Getting artwork… n of m" |
| `7e389cc8` | stubbable seams, sync log ring buffer, `fake-server.ts`, dirty hash allowlist |
| `55e0af82` | verify a conflict before parking one (rev-lag fix) |
| `3cf9c930` | a pull must land before it is recorded (`applyPull` fix) |
| `712eea8d` | zoom and snapToGrid stop travelling |
| `cd2f3b7a` | vars split test faces the fix, not the data loss |
| `adfc6ee2` | rev lag test faces the fix, not the bug |

## In flight at time of writing

- push + deploy (~11 commits unshipped)
- socket message handler extraction out of `use-server-sync.ts`
- diff work: `diffPassages`/`applyPassageDiff`, PATCH client, per-passage merge

---

## 1. Live defects

### Defect 1 — `split(re, 2)` drops text. SHIPPED TO READERS.

`splitVarsSection` does `text.split(re, 2)`. JS runs a FULL split then truncates, so
piece 3+ is discarded. **A passage whose prose holds a bare `--` line silently loses
everything after it.** `format/src/runtime/template/parse.ts:58` makes the same call, so
this is live in the player, not only the editor.

- Fix: ~5 lines. `exec` the separator, `slice` either side, in BOTH `vars-section.ts` and
  `parse.ts:58`. Same commit — one rule, two touch points, and this codebase's most common
  defect source is a rule taught twice.
- `it.failing` already sits in `packages/scene-schema/src/__tests__/vars-lines.test.ts`.
  It turns RED when fixed. Flip to `it`, never soften.

### Defect 2 — the "Unused" badge tells authors a falsehood

`asset-sync.ts:111-118` pushes the whole library. `use-synced-refs.ts` still computes
`resolveBundleRefs(store, collectAssetRefs(story))` and its doc comment still claims it
"calls the same two functions the push does" — untrue since 2026-09-17. So on a synced
story the badge says art "stays on this machine and is not backed up" when it was
uploaded with everything else, and sends the author to do busywork.

- `en-US.json:487-488`, shown with no gate on whether the story is even synced.
- Product call: widen `resolveSyncedRefs` to the whole library (badge then means "unused",
  drop the backup claim), or delete the badge. Locale strings move either way.
- Then write the agreement test — it fails today, which is the point.

### `manifest.missing` is never surfaced

The server tracks manifest entries whose bytes it does not have. Nothing tells the author.
A 4 MB background that failed to upload is invisible. Open since 2026-09-07.

### No conflict UI in the editor

`ResolveConflictButton` is story-list only. The editor toolbar says "Sync: conflict"
(`722bae62`) but offers no way to resolve it without leaving the story.

---

## 2. Bandwidth work not started

`GET ?since=rev` — the download half of the diff. Server already keeps gzipped full
snapshots per rev (`revs/%06d.json.gz`, `REV_KEEP=20`), so the diff is a gunzip and a
compare; fall back to a full body when the base rev is pruned or the base hash disagrees.

Deliberately LAST of the diff work: it is the only piece needing the snapshot chain and
the only one with a prune fallback to get wrong. Upload (PATCH) is the bigger win anyway —
mobile uplink is the slow half.

Measured, for whoever picks this up:

| body | plain | gzip | |
|---|---|---|---|
| Sliders Feature Lab | 14,217 | 4,866 | 2.92x |
| Trip to my Desert | 8,388 | 1,873 | 4.48x |

---

## 3. Known hazards — documented, not fixed

| hazard | note |
|---|---|
| Sync records never cleared when `backendUrl` changes | a record can carry a rev from a DIFFERENT server's counter. `checkoutStory` has an explicit `remove()` escape; nothing else does |
| Residual keepalive gap | tab hidden -> push lands -> tab returns WITHOUT a reload -> author edits before any poll. Local is then genuinely ahead, so the content compare correctly confirms a conflict. Needs three-way merge, not a hash compare |
| Orphan `state: 'error'` records | story deleted locally while its pull is in flight leaves a record nothing cleans up. Pre-existing — a locally deleted synced story already leaked its record |
| `tagColors` in a PATCH | a map, replaced wholesale, not merged per key. Fine today; needs its own rule if per-key tag colour merging is ever wanted |
| Go gzip redundant behind Caddy | production runs `encode zstd gzip`, which skips responses already declaring `Content-Encoding`, so they do not stack. The middleware earns its place on the dev store, the Playwright fixture, curl and any proxy-less deploy. One line in `NewHandler` to drop if Caddy is forever |

---

## 4. Test debt

| gap | size | why it matters |
|---|---|---|
| `format/src/runtime` unreachable by jest | 908 LOC, **0 tests** | where the `states` off-by-one shipped silently for weeks, and where `sceneOnlyBlocks` drops content with no error. Four pure functions, cheap. NEEDS `jest.config.js`, which is a peer's and dirty — **coordinate** |
| 6 e2e specs fail on a clean checkout | — | character editor and asset-editor background removal have NO working coverage in any form. Repairing these buys more than new unit tests |
| `scene-preview.tsx` | 1750 LOC, 0 tests | all 26 siblings are tested |
| `sliders-characters/` | 1722 LOC | one pure-helper test, its e2e among the failing six => effectively zero live coverage |
| `use-server-sync.test.tsx:320` | — | asserts only that a GET went out. Redundant since `pull-lands.test.tsx`; candidate for deletion. Its `routes` map matches by `includes`, so its pull is served the story INDEX as a body |

### The convention worth keeping

Never assert buggy behaviour as expected. `it.failing` (jest 29+) passes only while its
assertion fails: it documents the defect and turns RED the moment someone fixes it. Three
bugs in this codebase were found hiding behind tests that asserted them
(`roundtrip.test.ts`, `vars-lines.test.ts`, and the weak pull test above).

**Tell:** if a test's name would read as a complaint in an issue tracker, it must not be
green by asserting that complaint.

Prove a guard both directions — break the code and confirm red, including the direction
that would trade a bug for a WORSE one. A verification step that wrongly "resolves" real
conflicts is silent data loss, and is caught by 10 tests only because someone checked.

### And the build-time tripwires

Where a test is weaker than a compile error, this fork uses the compiler: `scene-help.tsx`'s
`KeyHelp<typeof KEYS>` makes an undocumented key a BUILD FAILURE, and `write.test.ts:506`
asserts `ENTITY_KEY_ORDER ⊇ ENTITY_KEYS`. Replicate; do not "simplify".

---

## 5. Decided against, with reasons

Recorded so nobody re-proposes them.

| idea | verdict |
|---|---|
| Per-story websocket channel | **No.** The hub already broadcasts `{t,id,rev,by}` (~60 B) to everyone but the writer, and `conn` already tracks `story` from `focus`, so it would be ~30 lines — but it saves ~200 bytes and adds a resubscribe-means-resync correctness edge. The only real argument is PRIVACY (every client currently sees every story's id, name-bearing `by` and rev), and that was explicitly declined |
| Per-asset socket messages | **No.** Assets are content-addressed (`dedupeKey = hash + ownerCharacter`), so "new" and "changed" are the same thing and `absentLocally()` already answers it. The manifest GET is the cheap guard AND self-healing — a full statement of truth, where a stream of deltas can be missed |
| Text-diffing passage bodies | **No.** Sending one 8 KB passage instead of a 100 KB story is already the win, and a text diff means client and server agreeing on an algorithm forever |
| "One writer" rev refactor | **No.** Shape 1 of the rev-lag fix. Real refactor, fixes nothing — the writers never disagreed, a receipt got dropped |
| Decompressing request bodies | **No.** `MaxBytesReader` is the upload cap, and a cap a client can dodge by gzipping its body is not a cap. PATCH is the upload answer |
| Sync log UI panel | **No** — asked for as a test oracle and a console hook, not a view. `window.__slidersSyncLog.enable()` |

---

## 6. If picking up cold, in order

1. **Defect 1.** ~5 lines, live data loss, test already waiting. Highest value per line in
   the repo right now.
2. **Defect 2.** Actively misleading authors. Needs a product decision first.
3. **`format/src/runtime` into jest roots.** Biggest coverage hole, 908 LOC at zero. Needs
   the `jest.config.js` coordination.
4. **Repair the 6 e2e specs.** Two whole features have no live coverage.
5. **`GET ?since=rev`**, once the diff pair from the in-flight work exists.
