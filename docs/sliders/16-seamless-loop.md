# 16 — Seamless loop

Makes art tile. Feeds `scroll_infinite_left/right/up/down`.

Tool in the asset editor: **Seamless**. Direction toggle + one slider, **Overlap**.

## Why

`scroll_infinite_*` travels a whole frame, restarts. Renderer already draws a second copy
one frame ahead, so the restart is invisible — see 02, "parallax vs scroll_infinite".

What it cannot hide: facing edges that do not match. Jumps once per lap. That is the ART,
not the motion. This tool fixes the art.

## Direction

| Toggle | Folds | Shrinks | For |
|---|---|---|---|
| Sideways (`x`, default) | right edge over left | width | `scroll_infinite_left`, `_right` |
| Up and down (`y`) | bottom edge over top | height | `scroll_infinite_up`, `_down` |

One axis at a time. Art that loops both ways is not a thing the renderer asks for.

## What it does

Folds far edge back over near edge. Crossfade, then cut. Sideways:

```
source, width N, overlap s          output, width N - s
+--------------------------+        +--------------------+
| A B C .............. Y Z |   ->   |A'B' C ........... X|
+--------------------------+        +--------------------+
  ^^^                ^^^             A' = mix(Y, A)
  near strip     far strip           B' = mix(Z, B)
```

- Line `depth < s`: `mix(src[depth + out], src[depth])`, weight `(depth + 0.5) / s`.
- Line `depth >= s`: untouched.
- `depth` is the column sideways, the row downwards. One loop, one code path.
- Wrap check: output ends on `src[out - 1]`, starts on ~`src[out]`. Neighbours in the
  original. Join is continuous.

Premultiplied alpha. A cutout crossfading against its own transparent edge keeps its color.

## Costs size

Overlap is two strips becoming one. Not a fade. Output loses `s` px off the folded axis.

Only edit whose saved size ≠ what Sizing says. So:

- `outputSize(edits)` is the truth. `edits.width`/`edits.height` are the ask.
- Save note + Seamless header both read `outputSize`.

## Data

| Field | Means |
|---|---|
| `ImageEdits.tile` | overlap, fraction of the folded edge, 0..0.5. Absent when off. |
| `ImageEdits.tileAxis` | `'x'` \| `'y'`. Absent = `'x'`. |

Fraction, not pixels. Same reason as mask feather: survives resize, and the live preview is
drawn at a scale.

Both absent-when-default, so a picture that never looped carries nothing into the manifest,
and assets saved before the axis existed still read as sideways.

Rides `AssetMeta.edits` into sync like every other edit. Re-opening restores both.

`sameEdits` ignores the axis when `tile` is 0 — a direction pointing at no overlap is not a
difference.

## Pipeline order

Last. `drawEdited`: crop → resize → LUT → **seam**.

Folding first then adjusting would brighten the two halves of the join differently.

## Preview

Not the stage canvas. Stage shows the whole SOURCE with the crop as an overlay — the two
edges being married sit at opposite ends of it, and the join does not exist there at all.

Pane preview instead: output drawn twice, offset by half a picture along the folded axis.
Join dead centre, red ticks on the two edges it runs between. Ticks never cross the seam — a
marker drawn on the flaw hides it.

Preview at `tile: 0` is the "before". Drag until the middle goes quiet.

## Files

| Path | Holds |
|---|---|
| `src/dialogs/asset-editor/tile-edits.ts` | `axisSize`, `seamWidth`, `tiledSize`, `blendSeam`. No DOM. |
| `src/dialogs/asset-editor/tile-tool.tsx` | Pane, toggle, slider, loop preview. |
| `src/dialogs/asset-editor/image-edits.ts` | `outputSize`, seam step in `drawEdited`. |
| `packages/scene-types/src/index.ts` | `TileAxis`, `ImageEdits.tile`, `.tileAxis`. |

## Traps

- `blendSeam` strides by the SOURCE width, not the output width. Sideways they differ;
  downwards they do not. A picture wider than one pixel folded downwards is what catches a
  stride taken off the wrong one — pinned by a test.
- Narrowing a canvas clears it. `drawEdited` sets `target.width`/`.height` after the blend,
  then puts the pixels. Setting them before would wipe the draw.

## Not done

- Nothing warns that art is untileable before you try. Eyeball the preview.
