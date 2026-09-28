# 03 — Asset manager (twinejs fork)

Lives in the fork. **Cannot** ship in a story format — see [01](01-twine-language-review.md).

## Why it exists

Chapbook's own docs, on referencing assets by relative URL:

> Assets won't display correctly during testing within the editor.

That hole is the whole reason for this feature.

## Storage (D14 — Electron **and** web)

One interface, two backends.

```ts
interface AssetStore {
  put(file: File): Promise<AssetId>;
  get(id: AssetId): Promise<Blob>;
  url(id: AssetId): Promise<string>;   // blob: or file: — for previews
  list(filter?: Filter): Promise<AssetMeta[]>;
  remove(id: AssetId): Promise<void>;
}
```

| Backend | Where bytes go | Notes |
|---|---|---|
| Web | **OPFS**, falling back to IndexedDB | OPFS handles tens of MB far better |
| Electron | project folder `<story>/assets/` | plain files, git-friendly |

**Rule: the asset library is a separate store from story text.** Story text goes through
undo, archive, and import/export. You do not want 40 MB of sprites riding along.

**Shared library, not one per story** (plans `plans/asset-library-1..2`). Records sync one
by one, blobs by sha256. Each story = own collection (`kind: story`) + attached
collections, in order. Reuse = attach, not copy. Old Import… tab is gone. Bundle import
unchanged.

| Piece | Where |
|---|---|
| engine (records, outbox, merge, blobs) | `packages/asset-library` |
| per-story facade (`AssetStore` view) | `src/store/asset-library/story-asset-store.ts` |
| Library dialog | `src/dialogs/sliders-assets/sliders-assets.tsx` + `library/` |

## Upload → WebP (D14)

Convert on upload. High quality.

```
File → sniff header → still?    → decode → OffscreenCanvas → WebP (q≈0.9)
                    → animated? → STORE AS-IS
```

### ⚠️ The trap

**Canvas cannot re-encode an animated image.** It gives you one frame. Since D5 makes
animation *"an animated file"*, naive conversion would silently flatten every animation to
a still.

Sniff before converting:

| Format | Animated if |
|---|---|
| GIF | more than one image descriptor block |
| PNG | `acTL` chunk present (APNG) |
| WebP | `ANIM` chunk present |

Animated input → store unchanged, mark `animated: true`. Transcoding animations needs a
real wasm encoder; not v1.

## Asset ids

- Identity: short random id, `a_8f21`. Stable when a file is re-uploaded after an edit.
- Content hash (sha256) + pixel hash + dHash → dupe dialog instead of silently duping.
- **Passage text only ever contains ids.** Never paths. Keeps scenes portable and diffable,
  and means a story still opens in stock Twine (renders placeholders).

## Metadata

```ts
interface AssetMeta {
  id: AssetId;
  name: string;              // "tavern/night"
  kind: 'bg' | 'object' | 'frame' | 'fx';
  tags: string[];
  animated: boolean;
  w: number; h: number;
  bytes: number;
  hash: string;
  ownerCharacter?: string;   // set when kind==='frame' (a pose image)
}
```

## UI — the Library (D7/D8)

Story toolbar **Assets** → Library dialog, opens maximized.

```
┌ Library ─────────────────────────────────────────────────────────┐
│ Mine: Night Market │ tavern-set  shared · 42 items  ☁ synced      │
│ ATTACHED  ↕ drag   │ Rename  ☐ Locked  Activity  Delete           │
│ ☑ tavern-set 🔒    │ Add Files  Search  Tags  ⚠ Dupes 2           │
│ TEAM               │ Backgrounds Objects Characters FX Sounds Gen… │
│ ☐ ui-icons         │ ▢ night ●4 ⑂ ↑   ▢ day ●1 ⚠   ▢ bar ◌        │
│ ☐ Story: Old Mill  │                                              │
│ + New Collection   │                                              │
│ ⌕ All Assets       │                                              │
└──────────────────────────────────────────────────────────────────┘
```

| Part | Does |
|---|---|
| Mine | story's own collection. Not detachable. Uploads default here. |
| Attached | checkbox = detach (warns: names only found there). Drag = resolution order (`engine.bind`). |
| Team | every other collection, other stories' own ones too. Tick = attach. |
| + New Collection | shared, name unique team-wide, auto-attached. |
| All Assets | every asset, attached or not. |
| Header | rename, description, lock (edits ask to fork), sync chip, Activity (last 50: who/what/when, view, revert), delete (refused while attached). |
| Filter row | kind (Backgrounds…Sounds) as filter, not tabs. Generate… link. |
| Tile badges | `●N` stories using it (click → list), `⑂` fork / shadowed, `↑` pending, `⚠` conflict, spinner = downloading, Unused = no scene names it. |
| Tile menu | Edit, Rename, Move to Collection…, Copy to Mine (fork), Unfork, Show Usages, Versions… (restore = new rev on old blob), Delete. |
| Shared art | rename / delete / repaint → Update All / Fork / Cancel. Delete: no fork. Locked: no Update All. |
| Drag | files → shown collection. Tile → rail collection = move (Alt = copy). Tile → stage = scene snippet. |
| Dupe dialog | exact: use existing (attach) / new name same blob (default) / separate. Pixel or dHash: "Looks like…", default separate. |
| ⚠ Dupes | groups by tier (same file / same picture / looks alike). Merge: survivor, preview, rewrite scenes in stories on this device, tombstone rest. Other devices' stories listed, not rewritten. |
| Conflicts | chip → panel: base / mine / theirs thumbs, row per conflicting path, auto-merged rows, keep both → `name-2`. |

| Sync chip | Meaning |
|---|---|
| `☁ synced` | nothing pending |
| `↑N` | N records waiting |
| `↓` | blobs downloading |
| `⚠ N conflicts` | click → panel |
| `⦸ offline` | edits queue locally |

- Story list top bar: same chip, whole library. Conflicts → Library Conflicts dialog.
- Toasts only: name taken on create (saved `-2`), remote delete of art open in editor, conflict.
- Scene autocomplete: `coll/name` for names two collections hold (grey); unattached team names last (italic), pick = attach.
- Story rename → own collection renamed (numbered if taken), unless renamed by hand.
- Story delete (never synced, or removed from server) → binding tombstoned. Own collection kept.

| Rule | |
|---|---|
| Pose images | **hidden** from the flat list. `ownerCharacter` set → filtered out. |
| Characters | one tile each. Click → [character editor](04-twinejs-character-editor.md). New characters land in Mine. |
| Tags | free-form. Filter by them. |

### Copy-paste is the daily feature

Copying a tile yields the **YAML fragment**, not the id:

| Tile | Clipboard |
|---|---|
| background | `bg: tavern/night` |
| object | `candle: {at: 0}` |
| character | `mira: {at: 0, pose: idle}` |

This closes the loop with the scene format. It is the thing that will get used every day.

## Publish pipeline

| Step | Output |
|---|---|
| 1 | Write `SlidersAssets` hidden passage: id → relative URL |
| 2 | Write `SlidersCast` hidden passage: character manifests |
| 3 | Emit `story.html` |
| 4 | Emit `assets/` folder |
| Option | inline assets under N KB as `data:` URIs |

Web: download a zip. Electron: write the folder directly.

Chapbook deliberately abandoned Twine 1's base64-everything approach — 33% size overhead,
and nothing plays until every byte downloads. Don't reintroduce it as the default.

**Later, not now:** sync the whole package to a standalone viewer; web-app URLs; Capacitor
native wrap.

## Out of scope here

Image editing. Cropping. Sprite sheets. Atlas packing. Audio (Chapbook already has
`[ambient sound]` / `[sound effect]`).
