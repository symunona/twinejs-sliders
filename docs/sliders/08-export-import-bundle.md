# 08 — Export / import with assets

Built. `src/util/sliders-bundle/`, plus `AssetStore.importAsset` in `packages/asset-store`.
Deviations from the original plan are recorded under "As built" at the end.

## Why

The asset library is **global and origin-bound**. Assets live in OPFS (or IndexedDB) under
one browser origin; story text lives in the stories store and travels as HTML. So today a
story that exports cleanly arrives on another machine with every `bg:` and every character
unresolved. There is no way to move a Sliders story anywhere, and no way to back one up.

This is the round-trip: story text **plus the assets it references**, in one file, that
imports back into a different browser or a different machine.

Deliberately **not** the publish pipeline (spec 03, "Publish pipeline"). A published story
still renders stub art — the format ships `stub-resolver` and nothing else. Fixing that
needs a real resolver in `sliders-format`, not just here. Separate job.

## The file

`<story-name>.sliders.zip`:

```
story.json          the Story object, verbatim — what import reads
story.html          publishStory() output — so the zip drags into vanilla Twine
sliders.json        bundle manifest: assets, characters, report
assets/a_8f21.webp  raw stored bytes, one file per asset id
assets/a_3c07.gif
```

### Why zip and not one HTML file

Spec 03 already says *"Web: download a zip"*. Base64 in HTML costs 33% and makes the
browser parse a 50 MB DOM to import. Assets are already compressed (WebP/GIF/PNG), so zip
entries store at level 0; only the two text files deflate.

### Why both story.json and story.html

`publishStory` is lossy in ways that matter for a round-trip: it drops every passage id
(import mints fresh UUIDs), `lastUpdate`, `snapToGrid` and `ifid`. `story.json` is the
`Story` object serialized as-is, so all of those survive. `story.html` costs one existing
function call and keeps the zip useful to anything that speaks Twine. Import prefers
`story.json` and falls back to `importStories(story.html)` if it is missing or unreadable.

The **story id specifically does not survive either way** — `importStories` does
`delete props.id` unconditionally. A re-import lands on the original story because
`storyFileName` matches by name and routes to `updateStory`, not because the id was kept.
Passage ids surviving is what stops the passage map from being rebuilt from scratch, and is
the real reason `story.json` earns its place.

### sliders.json

```jsonc
{
  "format": "sliders-bundle",
  "version": 1,
  "creator": {"name": "Twine", "version": "2.10.0"},
  "story": {"id": "…", "ifid": "…", "name": "Tavern"},
  "assets": [{ /* AssetMeta verbatim */ "file": "assets/a_8f21.webp"}],
  "characters": [ /* Character verbatim */ ],
  "unresolved": ["tavern-nite", "mira"]
}
```

`AssetMeta` goes in whole — name, kind, tags, `ownerCharacter`, `w`/`h`, `animated`,
`hash`, `mime`. Import restores identity instead of re-deriving it, and re-hashes the bytes
to check the zip was not mangled.

## Which assets ride along

Only what the story references. A 40 MB library must not follow a two-passage story.

### The scanner — `src/util/sliders-bundle/collect-asset-refs.ts`

New, and it lives **in the fork, not in `packages/`**. `scene-index` would be the natural
home, but the format bundles the scene packages, so anything added there means rebuilding
`format.js` for code the runtime never calls.

Per passage: `extractSceneBlock()` → `parseScene()` → walk the `Scene`:

| Where | Yields |
|---|---|
| `scene.bg` | asset name or id |
| `scene.entities[*]` with `kind: 'prop'` | `ref` → asset name or id |
| `scene.entities[*]` with `kind: 'cast'` | `ref` → character id |
| `scene.entities[*].frame` | frame name, resolved through its character |
| `scene.fx[*].id` | fx asset |
| `beat.patch.frame` (say / box / set) | more frame names |
| `beat.kind === 'fx'` | `beat.fx.id` |

No `from:` DAG walk needed. Inheritance never invents a name that is not written literally
in some passage, so scanning each passage's own block catches everything the index would.

### Resolving

Names, not ids, are what authors write (`bg: tavern-night`). Reuse the rule
`createNamedResolver` already uses: try `store.meta(key)` first, fall back to a name index
from `store.list({includeFrames: true})`.

Two known-lossy spots, both reported rather than silently dropped:

- **fx ids are mangled.** `assetFragment` emits `fx: [{id: rain}]` for an asset named
  `fx/rain` — `entityKey()` slugifies the last path segment. So an fx lookup must also try
  matching `entityKey(meta.name)`, and can still hit two assets that mangle the same.
- **A name that resolves to nothing** goes into `unresolved` in the manifest and into the
  pre-download report. It never fails the export — a half-written story must still back up.

### Characters pull all their frames

A referenced character contributes **every** `frames[*].asset`, not just the frames the
scenes name. Frames are small, and a character arriving with three of its nine frames makes
the character editor useless on the other side.

## Export — `src/util/sliders-bundle/export-bundle.ts`

```ts
exportStoryBundle(story, store, appInfo): Promise<{blob: Blob; report: BundleReport}>
```

1. `collectAssetRefs(story)`
2. resolve → asset metas, characters, `unresolved[]`
3. `store.get(id)` per asset
4. zip: `fflate.zip()` (async, so a 40 MB library does not freeze the tab), level 0 for
   `assets/*`, level 6 for the two text files
5. `saveAs(blob, storyFileName(story, '.sliders.zip'))`

New dep: **fflate** (~8 KB, no deps). Nothing in the tree zips today.

Everything is built in memory. Fine for v1; a library big enough to matter is a later
streaming problem.

## Import — `src/util/sliders-bundle/import-bundle.ts`

```ts
readStoryBundle(file): Promise<BundleContents>       // pure parse, no writes
applyBundle(store, contents): Promise<BundleReport>  // writes
```

Split so the dialog can show what is about to happen before it happens.

`readStoryBundle`: `fflate.unzip()` → validate `format` + `version` → `story.json` (or fall
back to `story.html`) → per-asset re-hash, mismatch is a warning, not a rejection.

### The store needs one new method

`putAsset()` re-runs `prepareUpload()`, which re-encodes to WebP and changes the bytes —
that breaks the stored hash and re-flattens nothing but wastes time on already-WebP data.
Add to `AssetStore` / `BackedAssetStore`:

```ts
importAsset(meta: AssetMeta, blob: Blob): Promise<AssetMeta>;
```

Writes blob and manifest entry verbatim. Keeps the bundle's id when free, mints a fresh one
when taken and returns the meta so the caller can remap.

### Clash rules

The hard constraint: **scene YAML resolves by name**, so anything that renames an incoming
asset silently repoints the incoming story's own scenes. That rules out the obvious
`unusedName()` suffix.

| Situation | Do |
|---|---|
| Same content hash already in library | Reuse it. Remap the bundle's id to the existing one. Silent — this is the common case on re-import. |
| Name free, id free | Import as-is, id preserved. |
| Name free, id taken | Import, mint a new id, remap `frames[*].asset` and `sourceAsset`. |
| **Name taken, different bytes** | **Keep the existing asset.** Drop the incoming bytes, remap to the existing id, warn loudly and name it in the report. |
| Character id taken | **Merge frames** into the existing character — add missing, keep existing on conflict. Warn. |

**A character frame never contests a name**, so the "name taken" row applies only when the
incoming and the local asset are both loose. A frame is addressed through its character
(`mira: {frame: happy}`), never by name, so a frame and a background that merely share a
name are not competing for anything — and treating them as if they were is destructive
rather than merely wrong. `putCharacter` stamps `ownerCharacter` and `kind: 'frame'` onto
whatever a frame points at, so letting an incoming frame "keep" a local background swallows
that background into the imported character: it vanishes from the asset grid, and
`removeCharacter` later deletes it outright. Which incoming frame wins is settled by the
character merge, not by the name table.

The last two are the honest-but-lossy choices, and they need to be visible. Renaming would
be worse: it breaks the story that was just imported. Keeping the existing asset means the
imported story renders with the local art under the same name — wrong pixels, working
refs — which the author can fix in the asset editor. Merging characters instead of renaming
them is forced for the same reason: a character id is written literally in every scene that
casts it. This mirrors the existing precedent — the asset editor already warns on name
clash rather than resolving it silently (904386e8).

Both cases are the reason `applyBundle` is split from `readStoryBundle`: the dialog lists
every clash and lets the author cancel before a single byte is written.

## UI

**Export** — one `IconButton` in `src/route-actions/build-actions.tsx`, beside "Export as
Twee". Label: *Export with assets*. Errors use the existing `CardButton` pattern the four
buttons around it already use; the pre-download report (n assets, n characters, n
unresolved) goes in the same card.

**Import** — `src/dialogs/story-import/`. `FileChooser` gains a `.zip` branch. It cannot use
`FileInput` (text-only `readAsText`); reuse the `UploadButton` pattern from
`src/dialogs/sliders-assets/upload-button.tsx`, which exists for exactly this reason. Flow
becomes: choose file → existing `StoryChooser` conflict step → **new asset report step**
(what will be added, reused, kept-yours) → apply → `refreshAssetLibrary()`.

New i18n keys under `dialogs.storyImport.*` and `routeActions.build.*` in
`public/locales/en-US.json`. Other locales inherit English until translated.

## Tests

- `collect-asset-refs` unit: bg, prop, cast + frames, fx incl. the `entityKey` mangle, beat
  patches, `from:` inheritance, passage with no `[scene]` block, unresolved names.
- Round-trip: export a story → import into a fresh memory-backed store → manifest and
  passage ids identical.
- Clash unit tests, one per row of the table above.
- Bundle tampering: bad hash warns, bad `version` rejects, missing `story.json` falls back
  to `story.html`.
- E2E (`e2e/sliders-bundle.spec.ts`): export from a seeded story, re-import in a fresh
  browser context, assert the preview renders real art rather than stubs.

The E2E asserts on `naturalWidth` of the rendered `img.sliders-bg`, not on what the dialog
said. A placeholder, a dead blob URL and a truncated zip entry all decode to 0, and the
clash test asserts the *local* image's dimensions come back — so the two tests reading
1280 and 640 respectively is what makes either of them non-vacuous.

Note that port 5173 may be held by a different twinejs checkout on this machine, and
`playwright.config.ts` sets `reuseExistingServer: true`. Run the bundle spec against an
explicit port:

```sh
npx vite --port 5174 --host 127.0.0.1 &
SLIDERS_E2E_URL=http://127.0.0.1:5174 npx playwright test e2e/sliders-bundle.spec.ts
```

## Order of work

1. `collect-asset-refs` + tests — no UI, no deps, standalone.
2. fflate dep, `export-bundle`, export button. Ships useful on its own: backup works.
3. `AssetStore.importAsset` + store tests.
4. `read/applyBundle` + clash rules + tests.
5. Import dialog step, i18n, E2E.

## As built

What the implementation decided that the plan above did not.

**A fifth thing an fx ref can be: ambiguous.** `entityKey()` maps both `fx/rain` and
`storm/rain` to `rain`, so a ref can match more than one asset. That is not `unresolved` —
something *was* found and does ride along, it just might be the wrong one. It travels as
`ExportReport.ambiguousFx` and the export card names it, because only the author knows
which they meant. Tie-break: fx-kind assets win over other kinds, then first by name sort.

**`kept-existing` does double duty.** It means both "a local asset owns that name" and "a
merged character already had that frame, so your image won". The second case exists because
writing a frame's bytes for a frame the merge rejected would leave an asset owned by a
character that references it nowhere — invisible in the library (frames are filtered out)
and unreachable from the character editor. `AssetPlanItem.reason` tells the two apart.

**Character merge keeps everything local, not just frames** — name, size, origin, anchors,
tags. The local character's own scenes depend on those numbers.

**Dangling references are dropped, never preserved.** A frame whose asset did not travel,
and a `sourceAsset` pointing outside the bundle, are both removed rather than left pointing
at a bundle id. Asset ids are four hex digits minted per library, so a stale id stands a
fair chance of hitting an unrelated local asset and showing a stranger's art under this
character's name. A missing frame is visible and fixable; a wrong one is not.

**Names are reserved within a bundle, hashes are not — deliberately asymmetric.** Two
incoming assets with identical bytes collapse into one, mirroring `putAsset`. Two incoming
assets *sharing a name* both import: they came out of a library that tolerated the clash,
and dropping one would break whatever references it. Only a local asset earns the right to
keep a contested name.

**fflate's async `unzip` cannot run in jsdom.** It builds its Worker from
`URL.createObjectURL`, which jsdom and some locked-down WebViews lack, and it throws
synchronously. `unzipAsync` catches that and falls back to `unzipSync` on the main thread,
so async stays the default and the tab-freeze argument still holds in a real browser.

**The import UI is a second uploader, not an extension of `FileInput`.** `FileInput` reads
files as text, which is both useless and wasteful for a 40 MB zip — and the bundle reader
wants the `File` itself, not its contents. It reuses the `UploadButton` pattern that already
existed for image uploads.

**`applyBundlePlan` rolls back its own asset writes on failure.** Not for tidiness: an
asset carrying `ownerCharacter` whose character never got written is invisible in the
library (frames are filtered out of the grid) and unreachable from the character editor, so
the author could neither see it nor delete it — bytes stuck in storage forever. The
rollback is best-effort and never masks the original error.

It covers asset writes, not `putCharacter` calls. With two or more characters, a throw on
the second leaves the first stored, and the asset rollback then strips its frames — a
frameless ghost character. That does not break the invariant the rollback exists for (no
asset owned by an absent character), and unlike an orphaned frame a frameless character is
visible and deletable in the character editor, so it is left alone.

**`store.list()` returns the live manifest objects, and `putCharacter` mutates them in
place.** It is the only method that does — `update`, `replace` and `importAsset` all build
fresh objects. Snapshot the list before an apply and you compare the same objects to
themselves, which silently hides the one mutation worth catching. Copy before comparing.

**One name tie-break, copied from the renderer.** The store does not enforce unique asset
names (the asset editor only warns, 904386e8), so a name can address two assets. Whichever
one the passage preview draws is the one that must end up in the bundle, or the author
exports art they never saw. `resolve-refs.ts` therefore reproduces `createNamedResolver`'s
index exactly — sorted by name alone, last write wins — rather than inventing its own
deterministic rule. If that resolver ever changes, this has to change with it.

**Characters resolve by id only.** `store.character` and `createNamedResolver.character`
are both id-keyed, so a character found by name is one no scene in the bundle can address.
Reporting it as resolved would tell the author their story is fine while it renders
nothing, so a name-only match is `unresolved`.

**A frame picked up on its own drags its character along.** A `bg:` naming a frame by its
full name would otherwise ship an asset owned by a character that is not in the bundle —
the orphan state described two paragraphs up, reached with no error at all.

## Known gaps, not bugs in this feature

**`props/candle` cannot be addressed as `candle` anywhere.** `assetFragment` emits
`candle: {at: 0}` for an asset named `props/candle` — the same `entityKey` mangle fx has —
but nothing resolves prop refs through that mangle: not the exporter, and not
`dom-renderer`, which resolves a prop entity by `resolver.url(entity.ref)` against the name
index. So the copy-fragment button hands the author a line that does not render. The
exporter reporting `candle` as unresolved is therefore *correct and useful*: it says the
same thing the preview says. The real seam is `fragment.ts` vs `createNamedResolver`, and
fixing it in the exporter alone would ship an asset the runtime still cannot draw.

**`links[*].icon` is not scanned.** `stay: {to: X, icon: sword}` looks like an asset
reference, but nothing in `render-dom` or `scene-core` consumes it yet. If link icons ever
become real assets they belong in `assetRefs`, and it is a one-line change.

## Out of scope

- Publish with real assets (spec 03's pipeline) — needs the format's resolver.
- Electron writing a plain `assets/` folder instead of a zip.
- Library-wide export (every story, every asset). The archive button is story-text-only and
  stays that way.
- Merging two libraries interactively, take-theirs/keep-mine per asset. v1 warns; it does
  not negotiate.
