# Character poses — one vocabulary, image-set import

Status: planned. 2026-09-23.

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
