# Character poses — one vocabulary, image-set import

Status: phase A (rename) shipped on `char-poses`, phase B (step strip, Import set) on `pose-import`. See Shipped. 2026-09-23.

## Problem

"frame" means three things today:

| where | "frame" means |
|---|---|
| `Character.frames` | a named look. May be a still OR an animated file (`⟳`). |
| scene `frame: idle` | pick a named look |
| scene `frame: [{name, dur}, …]` + `frameLoop` | an animation made in the scene |
| `AssetKind 'frame'` | an image owned by a character |

So an idle animation is "a frame". A walk cycle is "frames of frames". Nobody can say what
they mean.

## Vocabulary

| term | means | replaces |
|---|---|---|
| **pose** | a named thing a character can show: a still, an animated file, or a list of steps | frame (the named look) |
| **step** | one timed image inside a pose | frame (animation frame), `FrameStep` |
| **image** | the asset bytes a pose or step points at | — |

Retired: frame, anim, clip, cycle. Docs, UI, types, YAML.

Idle animation = pose `idle` with steps. Walk = pose `walk` with steps. Arms crossed =
pose `arms-crossed`, one image. The scene doesn't care which: `pose: idle`.

## Model

```ts
export interface PoseStep {
	asset: AssetId;
	dur?: number;        // seconds, default DEFAULT_STEP_SECONDS (0.1)
	fit?: FrameFit;      // → PoseFit. Per step: sheet cells drift.
}

export interface CharacterPose {
	asset?: AssetId;     // still or animated file
	steps?: PoseStep[];  // image sequence. Exactly one of asset / steps.
	loop?: boolean;      // default true
	fit?: PoseFit;       // whole pose. A step's own fit wins.
	anchors?: Record<string, Frac2>;  // per pose, as today per frame
}

export interface Character {
	…
	poses: Record<string, CharacterPose>;   // was frames
	faces?: 'left' | 'right';               // which way the art looks. Default right.
	walkSpeed?: number;                     // see walk-area.md
}
```

Anchors stay **per pose**, not per step. A bubble that jitters every 0.1 s is worse than
one that is slightly off.

## Scene YAML

| new | old (still parsed) |
|---|---|
| `pose: angry` | `frame: angry` |
| `pose: [{name: walk_1, dur: 0.1}, …]` | `frame: [ … ]` |
| `poseLoop: once` | `frameLoop: once` |

- Old keys parse to the same thing. Lint says "`frame:` is now `pose:`", level info.
- A step in an inline list names a pose. If that pose is animated itself, it plays on its
  own clock during the hold. Lint warns. It is rarely meant.
- `StageEntity.frame` → `pose`. `StageEntity.frames` → `steps`. `frameLoop` →
  `poseLoop`. ~76 references (`grep -rn "\.frames\b\|'frames'"`).

## Migration

| thing | how |
|---|---|
| `SlidersCast` manifest `frames:` | read both keys, write `poses:`. Same pattern as `migrate-sidecars.ts`. |
| story passages | `twine-cli` rewrite command, opt-in. Old YAML keeps working forever. |
| `AssetKind 'frame'` | stored value stays `'frame'`. Wire and server compatible. UI label "pose image". **Open:** rename with a read-migration? |
| format (`format/`) | player reads both. Read `format/README.md` first. `npm run build:format`, then `npx jest format/src/twine-extensions`. |

## Import from an image set

Entry points: drop onto the character editor (as today), plus an **Import set…** button.
Accepts:

| input | becomes |
|---|---|
| several files / a folder (`webkitdirectory`) | grouped by name (below) |
| one sprite sheet | sliced by grid (below) |
| one animated gif/webp/apng | one pose, `asset:` (today's behaviour) |
| zip | later |

### Grouping by filename

```
idle.png                     → pose idle, still
walk_01.png … walk_08.png    → pose walk, 8 steps, numeric sort
walk-1.png, walk-10.png      → numeric, not lexical (1, 2 … 10)
Kate Walk 003.png            → pose kate-walk… minus the character id prefix → walk
```

Rule: slugify the stem. Strip a trailing `[_-\s]?\d+`. Same stem = same pose. Strip a
leading `<character id>-`.

### Sprite sheet

One image in. Grid dialog:

- cols × rows, or cell w × h. Margin. Spacing.
- Grid drawn over the sheet. Empty cells (all alpha 0) are greyed and skipped.
- **Each row = one pose.** Name it in a column on the left. A row can be split into two
  poses by a drag.
- Slices are uploaded as separate assets (`kind: 'frame'`, `ownerCharacter`). The sheet
  itself is not kept.

### Import review table

Before anything is uploaded:

```
pose     steps  fps   loop  preview   
idle       6    10    ✓     ▶ ▒▒▒
walk       8    12    ✓     ▶ ▒▒▒
wave       5    10    ✗     ▶ ▒▒▒
[faces: right ▾]   [✓ align feet]   [Import]
```

- Rename, merge, drop a pose. Set fps (→ `dur`), loop.
- `faces:` set once for the character. Walk-here flips from it.
- **Align feet**: per step, find the lowest opaque row and the horizontal centre of mass.
  Write a `fit.offset` so all steps share the origin. This is what makes a walk not
  wobble. Off = keep the art as drawn.
- Name clash with an existing pose: `walk-2`, as `uniqueFrameName` does now.

### Where the images come from

Any tool that exports a PNG sequence or a sheet:

| tool | licence | note |
|---|---|---|
| Blender (Grease Pencil / armature) | GPL | best quality. Render to PNG sequence. |
| Synfig | GPL | skeleton layers, 2D cut-out |
| OpenToonz | BSD | cut-out rigging |
| DragonBones | editor free, runtime MIT | editor abandoned. Export sequence only. |
| Spine | paid | export PNG sequence. No runtime licence needed then. |
| asset generator | — | generate a sequence (later) |

No skeletal runtime. Baked steps keep the player dumb and licence-free.

## Character editor UI

| today | after |
|---|---|
| "FRAMES" list | "POSES" list |
| `⟳` = animated file | `⟳` = animated file OR steps |
| — | pose row expands to a step strip: reorder, dur, delete, per-step fit |
| ghost frame | ghost pose (onion skin shows the previous step when a step is selected) |

## Files

| file | change |
|---|---|
| `packages/scene-types/src/index.ts` | `CharacterPose`, `PoseStep`, `PoseFit`, `Character.poses/faces`, entity `pose/steps/poseLoop` |
| `packages/scene-schema/src/parse-scene.ts` | `pose`, `poseLoop` + old aliases, lint info |
| `packages/asset-store/src/` | manifest read migration `frames` → `poses` |
| `packages/render-dom/src/dom-renderer.ts` | play `steps` poses on the existing step clock |
| `format/src/` | same, per `format/README.md` |
| `src/dialogs/sliders-characters/*` | rename, step strip, Import set… |
| `src/dialogs/sliders-assets/character-frames.ts` | → `character-poses.ts`. Grouping, sheet slice, align feet. |
| `src/dialogs/sliders-characters/import-set.tsx` | new. Grid dialog + review table |
| `packages/twine-cli` | `rewrite-poses` command |
| `docs/sliders/02`, `04` | vocabulary |

## Order

1. Types + parser aliases + manifest migration. No UI change. Everything still green.
2. Renderer + format play `steps` poses.
3. Character editor rename + step strip.
4. Import set: files/folder grouping, then sprite sheet, then align feet.
5. `twine-cli rewrite-poses`, then docs 02/04.

## Tests

- parser: `frame:` = `pose:`, `frameLoop` = `poseLoop`, both spellings give the same
  `Stage`.
- manifest: old `frames` loads, saves as `poses`, round trip is stable.
- grouping: numeric sort, prefix strip, singleton = still, mixed extensions.
- sheet slice: margin/spacing math, empty-cell skip.
- align feet: offsets make the lowest opaque row equal across steps.
- renderer: `steps` pose loops, `loop: false` holds the last step.

## Open

- `AssetKind 'frame'` rename, or keep the stored value.
- Per-step anchors, if a real character needs them. Not before.

## Shipped — phase A (rename), 2026-09-23

Branch `char-poses`. Order steps 1, 2, 3 (rename only), 5. Step strip, Import set, sheet
slicing, align feet: NOT done, next agent.

### Final names

| thing | name |
|---|---|
| character pose | `CharacterPose {asset?, steps?, loop?, fit?, anchors?}` |
| image in a pose | `PoseStep {asset, dur?, fit?}` |
| scene list step | `SceneStep {name, dur?, at?, scale?, rot?, flip?, opacity?, ease?}` (was `FrameStep`) |
| fit | `PoseFit`. `FrameFit` kept as `@deprecated` alias. |
| loops | `POSE_LOOPS`, `PoseLoop` (`all`/`once`) |
| default hold | `DEFAULT_STEP_SECONDS` = 0.1, scene steps and pose steps |
| anchors seed | `DEFAULT_POSE_ANCHORS`, `newPoseAnchors()` |
| Character | `poses`, `faces?: 'left'\|'right'`, `walkSpeed?` (type only) |
| StageEntity | `pose`, `steps`, `poseLoop` |
| TransitionKind | `'pose'` (was `'frame'`). `ease: {frame: …}` still parses. |
| error code | `unknown-pose` (declared, unused, as `unknown-frame` was), `retired-key` new |
| severity | `SceneSeverity = 'error' \| 'warning' \| 'info'` |
| helpers (scene-types) | `poseAssets`, `poseCover`, `poseHasSteps`, `mapPoseAssets`, `upgradeCharacter` |
| parser exports | `RETIRED_ENTITY_KEYS`, `RETIRED_EASE_KINDS`, `SCENE_STEP_KEYS` |
| scene-edit | `findEntityKeyPair` — writers find `frame:` when asked for `pose` and rename it in the same splice |
| editor | `PoseList` (`pose-list.tsx`), `posesFromFiles` / `uniquePoseName` (`sliders-assets/character-poses.ts`), `poseWrite` |
| store filter | `includePoseImages` (was `includeFrames`) |
| CLI | `twine-cli rewrite-poses <story> [--dry-run]`; `assets --all-poses` (`--all-frames` still accepted) |

### Decided

- **`AssetKind 'frame'` stays** as the stored value. Wire, manifests, server rows. UI says
  "pose image". No read-migration. Closes the Open item above.
- **Old keys never written.** `frame:`/`frameLoop:` parse forever to the same Scene. Lint is
  a new `info` severity with a one-click fix. `info` never counts as an error or warning;
  the scene panel header says "Show Notes (n)" when only notes are left.
- Old keys are NOT in `ENTITY_KEYS` (completion and Scene Help teach only the new word).
  CM mode still highlights them as keys; completion still works inside `frame:`.
- **Manifest migration is a read reshape, not a one-off.** `upgradeCharacter` runs in every
  reader: asset-store `readManifest` + `migrateCharacter`, player `SlidersCast`, bundle
  import (`import-bundle` and `planBundle`), server pull compare (`castShape`), CLI catalog.
  Store persists `poses:` on its next write. `poses` wins if both keys exist.
- Go server stores characters as raw JSON — no server change.
- **Step pose in a scene list step** shows that pose's first image for the hold. No nested
  clocks. The plan's "plays on its own clock during the hold" + lint warn: NOT done.
- Pose with steps: own animation on the renderer clock, `loop` default true, `false` holds
  the last. Restarts only when pose name or its steps change (`animKey`). Steps swap images
  only, never move the sprite.
- A step removed from the library shortens its pose; the last one removes the pose.
- Bundle merge clash on a step pose: bundle images map image-for-image onto the local
  pose's, extras onto its last image.
- `loop` toggle and ⟳ badge now also show for step poses. Edit-image disabled for them.
- Hotkey command id `slidersCharacters.addFrames` → `addPoses`. MRU completion bucket
  `frame:<id>` → `pose:<id>` (old recents lost, harmless).
- `.sprite-preview-frame` CSS class, `PLACEHOLDER_*`, bubble/stage "frame" (the box around a
  thing), animation frames of gif/webp, websocket frames: unrelated meanings, left alone.
  `PLACEHOLDER_FRAME` renamed `PLACEHOLDER_SIZE` anyway.

### Deviations / left undone

- No lint for "scene step names a stepped pose" (needs characters in the parser's reach).
- `addEntity` writes `pose:` from `patch.pose` only — an entity with a scene step list
  duplicated through the editor loses the list. Was the same with `frames`.
- Old clients (a browser tab on the previous build) cannot read a `poses:` manifest pushed
  by a new one. Deploy moves every tab; no dual-write.
- Locale keys renamed in `en-US.json` only (the only locale with Sliders strings).
  Dead key `assetEditor.hideFrame` left as found.

## Shipped — phase B (step strip, Import set), 2026-09-23

Branch `pose-import` (on `char-poses`). Order steps 3 (step strip) and 4 (Import set).

### Files

| file | what |
|---|---|
| `sliders-characters/import-set-logic.ts` | pure: `poseKey`, `groupFiles`, `gridLayout`, `cellIsEmpty`, `alphaProfile`/`contentRuns`/`guessGrid`, `looksLikeSheet`, `findFeet`, `imagePointInBox`, `feetFit`, `alignFits`, `durForFps`/`fpsForDur` |
| `sliders-characters/import-set-images.ts` | browser: decode, read pixels, cut slice to PNG |
| `sliders-characters/import-set.tsx` | pick → sheet grid → review → upload |
| `sliders-characters/pose-steps.ts` | pure step edits: move, remove, append, dur, fps, per-step fit |
| `sliders-characters/step-strip.tsx` | strip under the stage |
| `sliders-assets/character-poses.ts` | `importPoseSet`, `plannedPoseNames`, `stepImagesFromFiles` |

### Decided

- **Import set takes the editor's place** in the characters dialog, not a modal on top.
  z-index trap avoided. Switching character cancels it.
- **Entry points.** "Import Set…" button under Add Poses. Drop / Add Poses with MANY files →
  Import set, pre-filled. ONE file: animated or box-shaped → added at once (old fast path);
  still and sheet-shaped → Import set, sheet mode.
- **Sheet vs still:** toggle "This is a sprite sheet". Suggested when image aspect ÷ box
  aspect ≥ 1.75 or ≤ 1/1.75 (`looksLikeSheet`).
- **Grid guess:** count transparent gutters across the whole sheet (`guessGrid`). Kenney
  demo sheet → 9×5, right first time. Fallback: one row of box-shaped cells.
- **Row split:** Shift+click a cell = new pose starts there (plan said drag). Click = skip
  cell. Extra checkbox "Every cell is its own pose" for atlas-style sheets (Kenney). Split
  parts named `<row>-2`, `-3`.
- **Default row names:** row 1 `idle` if the character has none, else `row-N`.
- **Grouping extras:** trailing number may have no separator (`climb0`, `walk07`). A stem
  that is only a number (`0001.png`) takes its folder name from `webkitRelativePath`, else
  `pose`. Groups sorted `idle` first, then by name.
- **Names:** `plannedPoseNames` is the one rule; the review shows `→ walk-2` when the name
  will change. Empty character: its `idle`, else the set's first pose, becomes `idle`.
- **Asset names:** still `<id>-<pose>`, step `<id>-<pose>-<n>`. Store numbers clashes.
  Steps added from the strip: `<id>-<pose>`, store numbers them.
- **Align feet = 3 modes, default per step** (the plan's rule). `pose` = one shared feet
  point (mean x, lowest y) for all images of a pose: keeps already-registered art (Blender
  renders) steady, moves it as a whole. `off`. Stills get aligned too. Animated files never.
  Feet = lowest row with alpha ≥ 128 (shadow / antialias ignored), x = alpha-weighted
  centre of mass. Offset puts feet ON the character origin. Scale stays 1.
- **fps → dur**: `1/fps`, 3 decimals; 10 fps = default hold, stored absent.
- **Step strip** shows for every pose except an animated file. A still is a strip of one:
  dropping images on it turns it into steps. Down to one step → collapses back to
  `asset` (its fit moves to the pose if the pose has none). Last image cannot be deleted
  from the strip; delete the pose.
- **Strip gestures:** click thumb = select step (preview stops on it), click again / Play =
  play. ←/→ buttons + native drag reorder. Hold (s) per step, fps for all. Files dropped on
  the strip stop there, the editor's big drop zone never sees them.
- **Fit while playing** is off (pan would write the pose fit, which steps with own fits
  ignore). Pick a step to fit it. Fit tab edits the picked step; "Apply This Step's Fit To
  All Steps" added. Ghost poses use their first step's fit.
- **Onion skin:** picked step shows previous one (first → last when looping) as a ghost.
- **faces:** select in the review. `right` stored as absent.
- **Preview fix:** `SpritePreview` now sets `object-position` at the origin, as
  `applyPoseFit` does. Before, the editor centred non-box-shaped art while the renderer stood
  it on the floor, so fits made by eye were off in scenes. `containRect` takes the position
  too.

### Tests

- `import-set-logic.test.ts` 28, `pose-steps.test.ts` 5, `character-poses.test.ts` +4,
  `sprite-geometry.test.ts` +1. Dirs green: 95 tests.
- Browser (headless chromium, local vite): loose files (idle + walk 8) → 2 poses, walk plays
  at feet on origin; step select, onion, move, hold, delete, per-step pan-fit, persisted after
  reload. Kenney sheet 1728×1280 → guessed 9×5, skip + split, 6 poses, walk 12 fps.
  Synthetic sheet with margin 6 / spacing 4 → 64×128 slices, 2 empty cells greyed and
  skipped. Animated gif → one ⟳ pose. Multi-file drop on editor → review. Drop on strip →
  still becomes 3 steps. Drag reorder works. Screenshots `/mnt/data_ssd/tmp/shots/pose-import/`.

### Left undone

- No zip input.
- Row split by drag (Shift+click instead).
- Slicing is slow on big sheets in headless (~10 s for 45 cells): one canvas per cell for
  pixels + one for the PNG. Fine in a real browser; worker/OffscreenCanvas if it bites.
- No per-pose align override in the review (one mode for the set).
- Character box size is not adapted to the imported art's aspect.
- Scene-list lint for "step names a stepped pose" still open (phase A).
- No component tests for the strip / Import set UI (logic tested; UI verified in browser).
