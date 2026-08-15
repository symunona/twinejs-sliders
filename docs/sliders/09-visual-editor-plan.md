# 09 — Visual editor: build plan

Implementation plan for [07](07-twinejs-visual-editor.md). Spec 07 says *what*. This says
*in what order, against which files, and what breaks first*.

Drag and resize assets and characters on the [preview](06-twinejs-preview.md), get YAML
written back (D15).

## The one rule, restated

> **The text is the source of truth. Always.**
>
> Visual edits are text edits. All writes go through the CodeMirror document, never around
> it, so Twine's undo works for free and drags share one history stack with typing.

## What already exists

| Piece | Where | State |
|---|---|---|
| YAML round-trip | `parseScene` uses `yaml.parseDocument()` | Node `range`s are already read — for errors. Thrown away after. |
| Coordinate math | `packages/render-dom/src/coords.ts` | Pure and invertible. `boxToScene`, `applyCamera`, `spriteRect`. |
| Renderer hooks | `DomRenderer` | `measure()`, `stageBox()`, `subscribe()`, `invalidate()` public. Reconciles, never rebuilds. |
| Preview surface | `ScenePreview` | Beat scrubber, full screen, error list, hotkey scope. |
| Command registry | `src/hotkeys/` | `command-catalog.ts` + `default-keymap.ts`. |

## ⚠️ What blocks it

Five things, all small, all load-bearing. Find them now, not in phase 3.

**1. Entities are not clickable.** `.sliders-entity { pointer-events: none }`
(`packages/render-dom/src/styles.ts:66`). Hit testing by DOM event is out. Hit test by
**rect** instead — which is what we want anyway, because it survives the camera transform
and needs no CSS change in the renderer.

**2. The preview reads stale text.** `PassageEditContents` hands `ScenePreview` the store's
`passage.text`, which `PassageText` commits on a 1 s debounce. Dragging needs the live
document.

**3. `extractSceneBlock` returns lines, not offsets.** It gives `lineOffset`. Splicing needs
a **character** offset to map block-relative edits back onto the passage.

**4. There is no size key.** Character size comes from the manifest (`size` → 0.9 of stage
height), prop size from asset pixels against a 1080-tall design stage. Nothing is per-entity.
Resize needs a new format key — see phase 3.

**5. Key conflicts in the `scene-preview` scope.**

| Key | Bound to now | Spec 07 wants |
|---|---|---|
| `f` | `scene.fullScreen` | flip |
| `left` / `right` | `scene.previousBeat` / `nextBeat` | nudge |

Resolve: nudge and flip register with `enabled: selection.length > 0`, so beat nav still
works with nothing selected. Move full screen to `shift+f`.

---

## Phase 0 — write-back core. No UI.

New package `packages/scene-edit/`. Editor-only — **not** bundled into the story format, so
this one does not trigger a format rebuild.

```ts
interface TextEdit {from: number; to: number; insert: string}

/** Where a drag should write. `beat` selects a beat patch instead of the cast:/props: entry. */
interface EntityTarget {kind: EntityKind; id: EntityId; beat?: number}

setEntityKey(text: string, target: EntityTarget, key: string, value: unknown): TextEdit | undefined
addEntity(text: string, kind: EntityKind, id: EntityId, patch: EntityPatch): TextEdit
removeEntity(text: string, kind: EntityKind, id: EntityId, isPatchScene: boolean): TextEdit
entityAtLine(text: string, line: number): EntityTarget | undefined
```

### Two tiers, per spec 07

| Change | How |
|---|---|
| Key already exists (`at:`, `scale:`, `flip:`, `z:`) | Walk `parseDocument()` to the node, take its `range`, **splice the text**. Minimal diff. Nothing else in the file moves. |
| Key missing, or add/remove a whole block | Mutate the `Document` and `toString()` — but replace only **that map's range**, not the whole block. Costs some reformatting, confined to one entity. |

Naive `parse → mutate → stringify` of the whole document destroys comments, key order, quote
style and flow-vs-block formatting. Authors notice immediately and stop using the tool.

### Write formatting

- **3 decimals.** `at: -0.4`, never `at: -0.40000000000000002`.
- `at` is a **bare number** when `y === LAYER_BASELINE`, otherwise `[x, y]`. Do not promote a
  bare number to a pair on a horizontal-only drag.
- A new key going into an existing flow map stays inline: `{at: -0.4, scale: 1.15}`.
- Delete `scale:` entirely when it returns to 1. Same for `flip: false`.

Also in this phase: `extractSceneBlock` gains `offset` (character index of the block start),
with tests.

> **Gate.** Round-trip proof on a comment-heavy fixture — comments, blank lines, mixed flow
> and block style, quoted keys. Green before any drag handle is written. Spec 07 says so and
> it is right: this is the part that quietly ruins people's files.

## Phase 1 — live text and selection. Read-only.

- `PassageEditContents` holds `liveText`, fed from `PassageText`'s local change callback, and
  passes it to `ScenePreview`. The store commit stays debounced — story-map re-render cost is
  unchanged.
- `ScenePreview` takes `editor: CodeMirror.Editor` (already available in
  `PassageEditContents` as `cmEditor`).
- `DomRenderer.rectOf(id): Rect | null` — the sprite rect in MOUNT px, camera applied. Built
  from the same pure functions `measure()` uses, so the two can never disagree.
- New `stage-editor-overlay.tsx`, absolutely positioned over the stage host. Hit tests by
  rect, topmost z first. Draws the selection box, the origin cross, and the bubble anchor.

Origin and anchor markers are **read-only**. A character's anchors are global; editing them
here would silently change every other scene. That stays the
[character editor's](04-twinejs-character-editor.md) job.

### Selection is bidirectional

- Click an entity → select it, move the caret to its line, `markText`-highlight its beat lines.
- Move the caret inside `mira:` → mira highlights on stage.

Selecting an entity highlighting its beat lines *is* the connection to beats. `beats`,
`links`, `from`, `mark` and `id` are never editable visually — typing them is faster than any
widget.

## Phase 2 — drag → `at:`

**Nothing is written to the text during the drag.** A live `{id → at}` overlay is applied to
the stage handed to `SceneStage`; the renderer moves at 60 fps with no reparse. On pointerup,
**one** `cmEditor.replaceRange(..., '+sliders-drag')` — one undo entry. A drag that produces
60 undo steps is unusable.

### Where the write lands

| Scrubber state | Writes |
|---|---|
| Current beat already patches this entity | that beat's `at:` |
| Otherwise | the `cast:` / `props:` entry |
| Patch scene (`from:`) with no local entry | `addEntity` — a structural write |

Matches what the eye sees at that beat, which is the only rule that does not surprise people.

### Gestures

| Input | Does |
|---|---|
| Drag | move, snapped |
| Shift-drag | constrain to one axis |
| Hold Alt | disable snapping |
| Arrow keys | nudge 0.01 (Shift ×10), only when something is selected |

Snap targets: centre line (x = 0), the layer baseline, thirds, and other entities' x.
Tolerance in pixels, applied in scene units.

> **Gate.** Spec 07: *stop after 3 if it feels wrong.* Drag-to-position is 80% of the value.
> Everything after it is convenience.

## Phase 3 — resize → `scale:`

New entity key. **Uniform**, a single number, scaling about the entity origin — which for a
character is its feet, so scaling one does not lift it off the floor.

```yaml
cast:
  mira:   {at: -0.4, scale: 1.15}
props:
  candle: {at: [0.1, -0.2], scale: 0.6, layer: front}
```

| File | Change |
|---|---|
| `scene-types` | `StageEntity.scale`, `EntityPatch.scale`, `TransitionKind \| 'scale'` |
| `scene-schema` | `ENTITY_KEYS += 'scale'`; must be a finite positive number |
| `scene-core` | `ENTITY_DEFAULTS.scale = 1`, `mergePatch`, `materialize`, `diffStages` |
| `render-dom` | `characterMetrics` / `propMetrics` multiply w and h |
| `docs/sliders/02` | entity key table |
| `docs/sliders/07` | gesture table |

`transform-origin` is already the entity's own origin fraction, so scaling about the feet
needs no new CSS — the same property that makes `scaleX(-1)` mirror correctly.

UI: four corner handles on the selection box. The factor is the ratio of pointer-to-origin
distance, before and after. Alt scales about the centre instead. Same one-undo write path as
the drag.

> ⚠️ **The format bundles `packages/scene-*`.** Adding `scale` means rebuilding
> `sliders-format` and copying `format.js` back, or scenes render unscaled in play mode while
> looking right in the editor. That silent divergence is the worst failure mode here.
>
> The format repo's `vite.sliders-alias.js` looks for the scene packages at
> `../twinejs-sliders/packages` and **throws** when they are absent — there is no stub
> fallback. That path is stale, so `SLIDERS_PACKAGES` is not optional:
>
> ```sh
> cd /mnt/data_ssd/dev/sliders-format
> export SLIDERS_PACKAGES=/mnt/data_ssd/dev/twinery/twine-sliders-2/packages
> npm run build:format && npm run verify
> cp dist/use/0.1.0/format.js \
>    /mnt/data_ssd/dev/twinery/twine-sliders-2/public/story-formats/sliders-0.1.0/format.js
> ```
>
> Verified 2026-08-15: the committed `format.js` is byte-identical to a fresh build, so any
> diff after a rebuild is genuinely yours.

## Phase 4 — the rest. Cheap once 2 and 3 land.

| Gesture | Writes |
|---|---|
| Drag from the asset panel onto the stage | new entry under `cast:` / `props:` |
| Drop a background | `bg:` |
| Delete | remove the entry — or `~` if the scene has `from:` |
| Flip | `flip:` |
| Send to back / front | `layer:` |
| Bracket keys | `z:` nudge within a layer |
| Frame dropdown on selection | `frame:` |
| Pan / scroll-zoom the stage | `camera:` |

All registered in `command-catalog.ts` and `default-keymap.ts`, in the `scene-preview` scope.

## Shipped — the bindings as built

All in the `scene-preview` hotkey scope. Selection-scoped commands are
`enabled: selection.length > 0`; the beat-scrubber arrows are `enabled: selection.length === 0`,
so exactly one of the two owns the arrow keys and Escape hands them back.

| Key | Does |
|---|---|
| `p` | show/hide preview |
| `k` | play / pause beats |
| `shift+f` | full screen — **moved off `f`**, which flip now owns |
| `←` `→` | previous / next beat, when nothing is selected |
| arrows | nudge 0.01, when something is selected. Shift ×10 |
| `escape` | deselect (a second Escape leaves full screen) |
| `f` | flip |
| `backspace` / `delete` | remove the entity, or `~` in a `from:` scene |
| `[` `]` | nudge `z:` within the layer |
| `mod+[` `mod+]` | step the layer back / front |

`shift+[` and `shift+]` are **not usable** as bindings: the browser reports `event.key` as
`{` and `}`, so a shift-bracket binding can never match. That is why the layer step is on
`mod`, not shift.

| Pointer | Does |
|---|---|
| drag a sprite | move it |
| drag a corner handle | uniform `scale:` about the origin |
| drag empty stage, or middle-drag | pan the camera |
| `ctrl`/`cmd` + wheel | zoom the camera about the pointer, 0.2–8 |
| drag an asset tile onto the stage | new `cast:` / `props:` entry, or `bg:` for a backdrop |
| double-click | full screen |

A bare wheel is deliberately left alone — the preview sits mid-column in a scrolling dialog
and the pointer crosses it on the way elsewhere; a stage that swallowed plain scroll would
read as broken. `ctrl`+wheel is also what a trackpad pinch reports, so pinch-to-zoom is free.

### Two rules that look inconsistent and are not

- **`flip: false` and `scale: 1` are deleted; `layer: mid` is written out.** In a `from:`
  scene an absent key means *inherited*, so dropping `layer:` would hand the entity back the
  base scene's layer instead of the mid layer the author just asked for. `flip` and `scale`
  have no such ambiguity.
- **`camera:` collapses to flow style on the first pan.** It is rewritten as a whole value,
  which the two-tier rule permits for structural writes. `bg:` is always a scalar splice and
  never reformats.

### Known gaps

- A dropped entity is not auto-selected — resolving its caret line needs the parse to catch
  up first, and faking it would mean a parallel model.
- `fx` assets are not draggable: `fx:` is a stage-wide list with no position to drop onto.
- Transparent PNG areas hit the whole sprite rect.

## Tests

| Level | Covers |
|---|---|
| Unit | scene-edit round-trip and splice correctness; `dragToAt` and `handleToScale` as pure functions |
| Jest | overlay selection, both directions |
| E2E | `e2e/sliders-visual-editor.spec.ts` — drag a character, assert the YAML text changed **and** the sprite moved; one undo restores both |

## Risks

| Risk | Call |
|---|---|
| Transparent PNG areas hit the whole rect | Accepted for v1. Note it in the UI, not in the code. |
| Author types mid-drag | Seal the drag on any CM change with a foreign origin. |
| `scale` diverges between editor and play mode | Rebuild the format in the same commit. See phase 3. |
| Rounding drift from repeated drags | Always round on write, never accumulate — read the value back out of the text each drag. |
