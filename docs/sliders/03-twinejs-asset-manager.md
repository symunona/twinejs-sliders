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
- Also store a content hash → warn "you already uploaded this" instead of silently duping.
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
  ownerCharacter?: string;   // set when kind==='frame'
}
```

## UI (D7/D8)

```
┌─ Assets ───────────────────────────────────────────────┐
│ [Backgrounds] [Objects] [Characters] [FX]   🔍 tag ▾   │
├────────────────────────────────────────────────────────┤
│  ▢ tavern/night   ▢ street/dusk   ▢ candle   ▢ table   │
│  ◈ Mira (7 frames)   ◈ Joren (4 frames)                │
└────────────────────────────────────────────────────────┘
        click ◈ Mira → Character Editor (04)
```

| Rule | |
|---|---|
| Character frames | **hidden** from the flat list. `ownerCharacter` set → filtered out. |
| Characters | shown as **collections**, one tile each. |
| Click a character | opens the [character editor](04-twinejs-character-editor.md), tab per character. |
| Tags | free-form. Filter and group by them. |
| Drop files | onto a tab → uploads into that kind. |

### Copy-paste is the daily feature

Copying a tile yields the **YAML fragment**, not the id:

| Tile | Clipboard |
|---|---|
| background | `bg: tavern/night` |
| object | `candle: {at: 0}` |
| character | `mira: {at: 0, frame: idle}` |

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
