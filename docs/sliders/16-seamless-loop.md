# 16 — Seamless loop

Makes art tile horizontally. Feeds `scroll_infinite_left` / `scroll_infinite_right`.

Tool in the asset editor: **Seamless**. One slider, **Overlap**.

## Why

`scroll_infinite_*` travels a whole frame, restarts. Renderer already draws a second copy
one frame ahead, so the restart is invisible — see 02, "parallax vs scroll_infinite".

What it cannot hide: left edge ≠ right edge. Jumps once per lap. That is the ART, not the
motion. This tool fixes the art.

## What it does

Folds right edge back over left edge. Crossfade, then cut.

```
source, width N, overlap s          output, width N - s
+--------------------------+        +--------------------+
| A B C .............. Y Z |   ->   |A'B' C ........... X|
+--------------------------+        +--------------------+
  ^^^                ^^^             A' = mix(Y, A)
  left strip     right strip         B' = mix(Z, B)
```

- Column `x < s`: `mix(src[x + out], src[x])`, weight `(x + 0.5) / s`.
- Column `x >= s`: untouched.
- Wrap check: output ends on `src[out - 1]`, starts on ~`src[out]`. Neighbours in the
  original. Join is continuous.

Premultiplied alpha. A cutout crossfading against its own transparent edge keeps its color.

## Costs width

Overlap is two strips becoming one. Not a fade. Output is `width - s` px.

Only edit whose saved size ≠ what Sizing says. So:

- `outputSize(edits)` is the truth. `edits.width` is the ask.
- Save note + Seamless header both read `outputSize`.

## Data

`ImageEdits.tile` — fraction of width, 0..0.5. Absent when off.

Fraction, not pixels. Same reason as mask feather: survives resize, and the live preview is
drawn at a scale.

Rides `AssetMeta.edits` into sync like every other edit. Re-opening restores the slider.

## Pipeline order

Last. `drawEdited`: crop → resize → LUT → **seam**.

Folding first then adjusting would brighten the two halves of the join differently.

## Preview

Not the stage canvas. Stage shows the whole SOURCE with the crop as an overlay — the two
edges being married sit at opposite ends of it, and the join does not exist there at all.

Pane preview instead: output drawn twice, offset by half a width. Join dead centre, red
ticks at top and bottom pointing at it. Ticks never cross the seam — a marker drawn on the
flaw hides it.

Preview at `tile: 0` is the "before". Drag until the middle goes quiet.

## Files

| Path | Holds |
|---|---|
| `src/dialogs/asset-editor/tile-edits.ts` | `seamWidth`, `tiledWidth`, `blendSeam`. No DOM. |
| `src/dialogs/asset-editor/tile-tool.tsx` | Pane, slider, loop preview. |
| `src/dialogs/asset-editor/image-edits.ts` | `outputSize`, seam step in `drawEdited`. |
| `packages/scene-types/src/index.ts` | `ImageEdits.tile`. |

## Not done

- Vertical. `scroll_infinite_up/down` wants the same fold on rows. Maths transposes; the UI
  needs an axis switch.
- Nothing warns that art is untileable before you try. Eyeball the preview.
