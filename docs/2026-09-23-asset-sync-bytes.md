# Asset sync: replaced bytes and `effect` never reach a device that holds the asset

Status: plan. No code yet.
Found: demo sync test, story "DEMO point and click", 2026-09-23.

## Symptoms

| # | On A | On B (already holds asset) |
|---|---|---|
| 1 | Asset editor → Overwrite Original, new pixels | Keeps old pixels. Reload does not help. Later B push writes old pixels + old manifest back over A. |
| 2 | Change asset `effect` | Never arrives. |

Meta-only edits (walk, origin, mask, edits, tuning, cutout) DO arrive — 3e8ceb3e, 781540b5.

## Current flow

A side:
- Pixels: `store.replace(id, …)` — same id, same name, new `hash` (`packages/asset-store/src/store.ts:455`).
- Effect: `store.update(id, {effect})` (`asset-editor.tsx` meta-only branch).
- Push: `syncStoryAssets` → `diffAssets` says `stale` for id → blob PUT overwrites server blob under same id → manifest PUT (`asset-sync.ts`).

B side pull (`pull-assets.ts`, `checkout-story.ts`):

1. `needsPull` (`pull-assets.ts:130`): twin = local asset with same `dedupeKey` = `hash + ownerCharacter` (`checkout-story.ts:94`). Identity is CONTENT, not id, not name.
2. Compare twin vs manifest row by `provenanceOf` (`checkout-story.ts:172`): `edits mask origin sidecars tuning walk`. Nothing else.
3. `checkoutAssets` (`:476`) downloads rows with no twin, hands all to `planBundle`.
4. `planBundle` (`src/util/sliders-bundle/apply-bundle.ts:153-176`): no hash twin + loose name taken locally by other bytes → `kept-existing`. Local wins. Nothing written.
5. `landProvenance` (`:326`) matches by `dedupeKey` again → no twin for new hash → skip.
6. `changed = stored || provenanceApplied || castMoved` → false. No refresh.

### Bug 1 — replaced bytes

- New hash ⇒ no `dedupeKey` twin ⇒ looks like a NEW asset, not a new version.
- Same name ⇒ `kept-existing` ⇒ B's old pixels win. Rule written for bundle import (spec 08), where "local wins" is right. Wrong for sync, where the same asset moved forward.
- Warning pushed to `warnings`; `use-server-sync.ts` never shows pull warnings (grep: no reader). Silent.
- `needsPull` wants that row again on every manifest rev → re-downloads the blob every time, drops it every time.
- Reload does not help: nothing in the model says "this is a newer version of mine". Only fresh checkout (empty library) takes it.

### Data loss path (live today)

- `pushAssets` (`use-server-sync.ts:615`) never passes `ifMatch`. Manifest PUT is unconditional (`server/store/assets.go:272` only checks when sent).
- Server keys blobs by asset id and overwrites (`server/store/assets.go:429`).
- Any B asset push after the pull (library change, fingerprint cache empty after reload): B's row `id X, hash H1`; server has `X, H2` → `stale` → B uploads H1 over A's H2 → B's manifest overwrites A's.
- A's edit is gone from the server. A's next pull then sees B's old bytes under the same name → `kept-existing` on A. Each side keeps its own. Server = last pusher.

### Bug 2 — effect

- Twin found fine (same bytes).
- `effect` not in `AssetProvenance`, `provenanceOf`, `landingFor` (`:426`), nor `applySyncedProvenance` (`store.ts:506`). Compare says equal; landing would not write it anyway.
- `importAsset` keeps `effect` (not in strip list, `store.ts:268`) → only a FRESH checkout gets it.

## Same root cause?

**Partly. Same family, two different holes.**

- Shared root: pull has no idea of "same asset, newer version". It diffs local content against manifest content through a hand-kept field whitelist, keyed by content hash. No per-asset identity across libraries, no base to tell "they changed" from "I changed".
- Bug 1 hole: the IDENTITY key (`hash`) is the thing that changed. Twin lost → bundle clash rule → local wins.
- Bug 2 hole: the FIELD LIST. Twin found; `effect` just not listed.
- Fixing the whitelist fixes 2, not 1. Fixing identity fixes 1, not 2. The model change below fixes both and removes the whitelist-drift class.

## Proposed model: stable uid + 3-way merge against a synced base

### Wire

- `AssetMeta.uid`: random, global, minted once by `putAsset`. Survives `replace`, `update`, sync. Never re-minted by sync landing. Library-local `id` stays as is.
- Nothing else new on the wire.

### Local, per device, per story (sync record, not on wire)

- `base[uid] = sig` — signature of the asset as last AGREED with the server (after a landed pull or an accepted push).
- `sig(meta) = stable({hash, ownerCharacter, effect, edits, mask, origin, tuning, walk, sidecars: syncableSidecarHashes})`.
- One function owns the list. `provenanceOf` / `sameProvenance` / `landingFor` / `applySyncedProvenance` all derive from it. New field = one line, compare and land cannot drift apart again.
- Excluded, same reasons as today (`checkout-story.ts:104-138`): `id`, `sourceAsset`, `name`, `kind`, `tags`, measurements, non-sync sidecars, hashless sidecars.

### Pull rule per uid

| local vs base | server vs base | action |
|---|---|---|
| same | same | nothing |
| same | differs | **fast-forward**: new bytes via `replace`-like store call on local id (keep id, name), land all sig fields, `base = server` |
| differs | same | local ahead → leave, push |
| differs | differs, local == server | converge, `base = server` |
| differs | differs, local != server | **conflict**: server wins on the asset, local version kept as new asset `<name>-mine`, loud warning, `base = server` |
| no base | — | first contact: equal → set base; differ → server wins (same as checkout: "server copy wholesale"), warn |
| no local uid match | — | today's path: `dedupeKey` twin → adopt uid; else import |

- Fast-forward writes over the local asset IN PLACE — scenes resolve by name, name unchanged, nothing repoints.
- `kept-existing` stays for bundle import and for uid-less name clashes only.

### Push rule

- `pushAssets` passes `ifMatch = assetPullRevs[story]`.
- 412 → one pull (merges per table) → one push if pull says local ahead. No further retry; next library event or poll tries again. Rule 2 analog.
- `base` updated from the manifest actually written, after 200.

### Optional phase 3: content-addressed blobs

- Blob key `<uid>@<hash>` (or hash) instead of `id`. A stale upload can then never overwrite newer bytes on the server — worst case an orphan the janitor sweeps.
- Server + client + CLI change. Only if If-Match proves not enough.

## Phases

| Phase | Change | Fixes |
|---|---|---|
| 1a | Add `effect` to `AssetProvenance`, `provenanceOf`, `landingFor`, `SyncedProvenance`/`applySyncedProvenance`. Symmetric field (import keeps it) → no ping-pong. | Bug 2 |
| 1b | `pushAssets` sends `ifMatch`; 412 → pull once. | Stops B clobbering A |
| 1c | Surface pull `warnings` (at least `kept-existing`) in the sync UI. | Silence |
| 2 | `uid` + `base` + pull table + single `sig` list. Migration: adopt uid by `dedupeKey` on first sync. | Bug 1, unpushed-local-edit overwrite |
| 3 | Content-addressed blob keys. | Belt and braces |

1a alone is small and safe; 1b is small but touches the push loop — both need the two-client tests below.

## Ping-pong / data-loss risks

- **Asymmetric field in `sig`** → endless diff → push/pull loop. Every sig field must be holdable by both sides. `effect`, `walk`, `origin` yes. `src` sidecar no.
- **`base` recorded from intent, not store** → false "local ahead" → push → wake peer. Record from a store re-read, same as `landProvenance:382`.
- **`changed` on fast-forward** must come from what the store holds; a failed replace must not report.
- **412 loop**: pull-then-push must be bounded (one each). Otherwise two tabs trade 412s.
- **Lost `base`** (cleared storage, new browser): no-base row → server wins. Local unpushed edits on that device lost. Acceptable only with warning; same as checkout today.
- **Conflict keep-both** creates `<name>-mine` assets; must not itself re-conflict (new uid, new asset → just pushes once).
- **Server blob keyed by id**: until phase 3, any push without a prior merged pull can still overwrite bytes. 1b narrows the window, does not close it (blob PUT happens before manifest If-Match check). Order fix inside 1b: check manifest rev (HEAD or diff response) before uploading blobs.
- **Fast-forward vs undo**: asset writes are not in story undo; replaced local pixels are gone unless `src` sidecar exists. Conflict path is the only one that keeps both.
- **Character poses**: pose images are matched through `ownerCharacter` in `dedupeKey`; uid must carry through `putCharacter` stamping or poses re-import.

## Tests to add

`src/store/persistence/server/__tests__/pull-assets.test.ts` and a two-client fake-server test:

1. A `replace`s bytes, B untouched → B pull fast-forwards bytes + meta, same local id and name, `changed` true; second pull `changed` false.
2. A changes `effect` only → lands on B; second pull no-op. (1a)
3. B has unpushed walk edit, server unchanged since base → pull leaves it; push sends it.
4. Both replace bytes → conflict: server wins, `<name>-mine` kept, warning; fixed point after 2 rounds.
5. Push with stale rev → 412 → one pull → at most one push; no loop over N ticks. (1b)
6. B stale + A replaced: B's push must NOT overwrite A's blob. (regression for the live data loss)
7. Two clients, same library, 20 poll rounds with no edits → manifest rev stops moving (ping-pong guard, extends existing).
8. Migration: manifest without `uid`, library without `uid` → uid adopted by `dedupeKey`, no downloads, no `changed`.
9. `sig` is the ONLY field list: unit test that `provenanceOf`, landing and store write the same keys.

Jest one at a time: `pgrep -af 'node.*bin/jest'`, then `flock /mnt/data_ssd/tmp/jest.lock npx jest <file>`.

## Open

- Should `name` sync? Today a rename on A never reaches B either. Same model handles it once in `sig`, but a rename is a scene-breaking change — out of scope here.
- CLI already sends `If-Match` on manifest PUT (`packages/twine-cli/src/write.ts:51`). Only the browser is blind. CLI still needs `uid` minting in phase 2.
