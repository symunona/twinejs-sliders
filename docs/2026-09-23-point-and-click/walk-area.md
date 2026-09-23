# Walk area — polygon, depth, walk-here preview

Status: planned. 2026-09-23. One spec. Depends on [character-poses.md](character-poses.md)
for the `walk` pose name.

## Goal

Author draws on a bg asset:

- where a character may walk (polygon, with holes)
- how big a character is at each height (depth gizmo)

Then checks it:

- ghost character, dragged around, scaled live by depth
- walk-here: click → path drawn → character walks it, using its `walk` pose

The player's click-to-walk and hotspots are NOT in this spec. The path code goes in
`scene-core`, so the player reuses it later.

## Where the data lives

`AssetMeta.walk`. Meta, not a sidecar.

| | sidecar | meta (chosen) |
|---|---|---|
| reaches player | no. Bundles ship no sidecars. | yes, via `resolver.meta()` like `effect` |
| syncs | only with an opt-in to `SIDECAR_SYNC` | yes |
| survives `importAsset` | no, stripped | yes, if kept off the strip list |
| size | — | < 2 KB JSON |

Belongs to the **bg asset**, not the scene. Same room, many scenes, one floor. A per-scene
override (`walk:` in scene YAML) comes later if asked for.

## Model

```ts
// packages/scene-types, beside AssetMask
export type WalkOp = 'walk' | 'block';

export interface WalkShape {
	id: string;
	op: WalkOp;          // walk = floor, block = hole (table, pillar)
	points: Frac2[];     // fractions of the BAKED image, 3 decimals, ring closes itself
}

export interface WalkDepth {
	/** Image-fraction y (0 top, 1 bottom) → character scale. Linear between, clamped outside. */
	far: {y: number; scale: number};
	near: {y: number; scale: number};
}

export interface WalkArea {
	shapes: WalkShape[];
	depth?: WalkDepth;   // absent = scale 1 everywhere
}

// AssetMeta.walk?: WalkArea
```

Walkable = union(`walk`) − union(`block`).

Why fractions of the **baked** image, not the source like `mask`: the player draws the
baked bytes. Mask points feed a bake. Walk points are read at runtime.

## Coordinates

bg is the stage, `object-fit: cover`, 16:9 (`dom-renderer.ts:1602`). Image fraction →
stage coords goes through the cover rect. One pure function in `scene-core`:

```ts
imageToStage(p: Frac2, img: {w, h}, aspect: number): Vec2   // and stageToImage
```

A 16:9 bg maps 1:1. Any other aspect is cropped. Points in the cropped band are still
stored but lie off stage.

## Depth

```
scale(y) = lerp(far.scale, near.scale, (y - far.y) / (near.y - far.y)), clamped
```

- Multiplies the entity's own `scale`. It does not replace it. An author's `scale: 1.2`
  hero stays 20% bigger than a stock character.
- Walk speed is scaled by depth too. Far away looks slower on screen, as it should.
- z already derives from y (`StageEntity.z` doc). Depth sorting comes free.

## Editor: asset editor, new tool `walk`

Toolbar gets `'walk'` (`editor-toolbar.tsx`). Only shown for `kind: 'bg'`.

### Polygon

Reuse the mask tool wholesale:

| reuse | from |
|---|---|
| overlay aligned to letterboxed art | `AnchorOverlay`, `mask-overlay.tsx` |
| polygon / freehand / edit gestures | `mask-overlay.tsx` |
| ring area, hit test, simplify, round | `mask-shapes.ts` |
| shape list | `mask-tool.tsx`, with `op` = walk / block, no feather |

Factor `mask-overlay` into a shape overlay parameterised by op set and colors. Do not
copy it.

Colours: walk = translucent green fill. block = red hatch. Outside = dimmed.

### Depth gizmo

Two horizontal handles across the image:

```
─ ─ far  y 0.52  ×0.45 ─ ─ ─ ─ ─ ─   ← drag line up/down = y
                                       drag the ×scale chip = scale
═ ═ near y 0.96  ×1.00 ═ ═ ═ ═ ═ ═
```

- Each line has a small ghost silhouette at its left end, drawn at its scale.
- Dragging a line or chip updates the ghost character live (below).
- Default when first opened: far at the top of the walk area's bbox, ×0.5. Near at the
  bottom, ×1.0.
- "No depth" toggle clears `depth`.

### Ghost character

Picker in the tool pane: any character, default the last one used.

- Drawn at the cursor, feet at the character's `origin`, pose `idle`.
- Scale = the character's stage height × `scale(y)`. The same numbers the renderer uses.
  Import the helper, never recompute it.
- Outside the walk area: drawn red and translucent. Snaps to the nearest edge on release.
- Drag it = check depth by eye against a door, a chair, a person in the art.

### Walk-here mode

Toggle in the tool pane (hotkey `W`).

- Click → path from the ghost to the click (snapped into the area) → polyline shown.
- Ghost walks it: `walk` pose cycling, flipped by direction, scale changing with y. Ends
  in `idle`.
- No `walk` pose: glides in `idle`, with a note "character has no walk pose".
- Unreachable click (other island): path to the nearest reachable point. Dashed line to
  the click.

### Scene preview too

`scene-preview-dialog.tsx` gets the same walk-here toggle.

- Walker = the cast member picked in a dropdown. Default: first cast.
- Uses the bg of the current beat.
- Preview only. It never writes YAML.

## Path — `scene-core/src/walk-path.ts`

Pure. No DOM. Shared by editor, preview and the later player.

| step | how |
|---|---|
| inside test | even-odd over walk minus block |
| snap | nearest point on any walkable edge, nudged 0.002 inward |
| graph | visibility graph over the concave vertices of walk rings plus all block vertices, plus start and goal |
| search | A*, Euclidean |
| smooth | none needed. Visibility paths are already taut. |

~200 lines. No dependency. Recompute per click. Rooms have < 100 vertices.

## Playing a walk: compile to steps, renderer untouched

A path compiles into the step list the renderer already plays (`FrameStep` → `PoseStep`
after the rename). Each step carries `at`, `scale`, `flip`, `dur`, `ease: linear`:

```
for each 1/fps tick along the path:
  step = {name: walkPose[i % n], at: point, scale: base × depth(y), flip: dx < 0 ≠ faces, dur: 1/fps}
last:  {name: idle, at: goal}
loop: once
```

Why: steps already glide `at`/`scale`/`flip` (`scene-types` `FrameStep` doc: "a walk is a
pose cycle AND a translation"). No new render path, no new clock.

Speed: `Character.walkSpeed?` in stage units/s at scale 1. Default 0.6.

## Files

| file | change |
|---|---|
| `packages/scene-types/src/index.ts` | `WalkOp`, `WalkShape`, `WalkDepth`, `WalkArea`, `AssetMeta.walk`, `Character.walkSpeed` |
| `packages/scene-core/src/walk-path.ts` | new. Inside, snap, visibility graph, A*, `depthScale`, `imageToStage`, `compileWalk` |
| `packages/asset-store/src/store.ts` | keep `walk` OFF the `importAsset` strip list, like `effect` |
| `src/dialogs/asset-editor/shape-overlay.tsx` | factored out of `mask-overlay.tsx` |
| `src/dialogs/asset-editor/walk-tool.tsx` | new. Shape list, depth fields, ghost picker, walk-here toggle |
| `src/dialogs/asset-editor/depth-gizmo.tsx` | new. Two draggable lines + chips |
| `src/dialogs/asset-editor/walk-ghost.tsx` | new. Ghost sprite, walk playback |
| `src/dialogs/asset-editor/editor-toolbar.tsx` | `'walk'` tool id, bg only |
| `src/dialogs/asset-editor/asset-editor.tsx` | dirty compare, save `walk` onto meta |
| `src/dialogs/scene-preview/scene-preview-dialog.tsx` | walk-here toggle + walker picker |
| `public/locales/en-us.json` | keys |

## Traps

- **Crop after drawing.** Points are baked-image fractions. Crop moves them. On crop
  change, remap: `p' = (p·old - crop.xy) / crop.wh`. Points that fall outside are
  clipped to the ring. Test it.
- **Resize** does not move fractions. Fine.
- **`dirty`** must compare `walk`, like `mask`.
- **Pointer sharing.** Mask, crop, anchor and walk overlays share one pointer. Gate on
  `tool === 'walk'`.
- **bg with `effect` scroll/parallax.** The floor moves, the polygon does not. Walk-here
  is disabled on those, with a note. Revisit with the player spec.
- **`bg:` changed by a beat.** Walk area follows the current beat's bg, never the first
  one.
- **Two islands.** Legal (a bridge comes later). Path goes to the nearest reachable point.

## Tests

- inside / snap: point in a hole, on an edge, outside.
- path: straight when visible. Goes around a block. Island → nearest reachable.
- `depthScale`: endpoints, midpoint, clamped past both.
- `imageToStage` ↔ `stageToImage` round trip, 16:9 and 4:3 bg.
- crop remap keeps points on the same pixels.
- `compileWalk`: step count ≈ length / speed × fps. Flip flips at a direction change.
  Last step `idle`.
- meta round trip. `importAsset` keeps `walk`.

## Out of scope

- Player click-to-walk, hotspots, `stand:`, cursors. Next spec.
- Walk-behinds. `z` + a front plane already covers most of it.
- 8-direction walk poses (`walk_up`, `walk_down`). The pose naming leaves room.
- Scene-level `walk:` override.
