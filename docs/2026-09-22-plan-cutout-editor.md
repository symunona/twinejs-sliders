# Cutout editor — hand-drawn masks

Status: planned. 2026-09-22.

## Goal

Author cuts holes by hand. Prop has a screen, screen must be transparent. No model run
needed.

## Decision: vector, hand rolled

Shapes on `AssetMeta`, not pixels in a sidecar.

| | raster paint sidecar | vector shapes |
|---|---|---|
| storage | new `#paint` PNG, size-match rule | JSON on meta |
| syncs | no, sidecars never sync | yes, meta does |
| re-edit a corner later | no | yes |
| asset recropped / resized | mask invalid | fractions, still valid |
| airbrush | yes | no. Not wanted. |

No library. `AnchorOverlay` (`src/components/anchor`) already aligns an overlay to the
letterboxed canvas — reuse that, add one `<svg viewBox="0 0 w h">`. Annotorious, svgedit,
SVG.js plugins all cost more integration than the ~120 lines they replace. No magic wand.

## Model

```ts
// packages/scene-types, beside CutoutTuning
export interface MaskShape {
	id: string;
	op: 'cut' | 'keep';    // force transparent / force opaque
	feather: number;       // fraction of short edge. 0 = hard
	points: Frac2[];       // fractions of SOURCE image, 3 decimals, like roundAnchor
}
export interface AssetMask {shapes: MaskShape[]}
// AssetMeta.mask?: AssetMask
```

One shape kind: closed polygon. Polygon tool and freehand both make it.

## Composite

```
effective = clamp(tuned + keepShapes − cutShapes, 0, 1)
tuned     = applyEdgeContrast(alpha, ...)   // all-1 when no cutout exists
source    = composite(original, effective)
```

Model alpha and hand shapes stay independent. Tuning sliders never reshape a hand edge.
Rasterize per shape: `Path2D` fill into scratch canvas, `ctx.filter = 'blur(Npx)'` for
feather, accumulate, read red channel.

## Tools

| tool | gesture |
|---|---|
| polygon | click = add point. Click first vertex / Enter / dblclick = close. Esc = cancel. |
| freehand | drag, record points min 3px apart, close on release. Same polygon out. |
| edit | drag vertex. Del = delete shape. |

Per shape: `op` toggle, feather slider. Shape list in the tool pane.

## Three previews

| mode | draws |
|---|---|
| `rendered` | today's preview. `drawEdited` + crop overlay. |
| `paint` | composite on checkerboard + shape outlines + vertex handles |
| `alpha` | `effective` as grayscale, white = opaque, + outlines |

Switch in the toolbar. Hotkey cycles. Enabled when a cutout or a shape exists — `alpha`
is also how you judge the model's mask in the background tool.

## Files

| file | change |
|---|---|
| `packages/scene-types/src/index.ts` | `MaskShape`, `AssetMask`, `AssetMeta.mask` |
| `src/dialogs/asset-editor/mask-shapes.ts` | new — rasterize, merge, hit test, simplify |
| `src/dialogs/asset-editor/mask-overlay.tsx` | new — the `<svg>`, gestures |
| `src/dialogs/asset-editor/mask-tool.tsx` | new — shape list, op, feather |
| `src/dialogs/asset-editor/editor-toolbar.tsx` | `'mask'` tool id, mode switch |
| `src/dialogs/asset-editor/asset-editor.tsx` | recompose, pointer branch, dirty, save |
| `src/dialogs/asset-editor/asset-editor.css` | overlay styles |
| `public/locales/en-us.json` | keys |

## Traps

- `backgroundRemoved = source !== original` (`asset-editor.tsx:447`) drives the restore
  button, the save options and dirty. A mask also makes `source !== original`. Split into
  `hasCutout` / `hasMask` FIRST, or a mask-only asset writes a tuning for a cutout that
  does not exist.
- `dirty` must compare shapes too, against what the asset opened with.
- Mask overlay and `AnchorOverlay` share one pointer. Anchor picking is one-shot and only
  the size tool arms it — keep mask gestures behind `tool === 'mask'`, same as crop.
- Points are fractions. Crop and output size never touch them.

## Out of scope

- Bezier handles, boolean ops, raster brush.
- Magic wand / flood select. Later, if asked twice.
- Player and renderer untouched — bytes stay baked, mask is editor metadata like `edits`.
- Bundle and export unchanged.

## Tests

- `rasterize`: hole inside is 0, outside 1, feather monotonic, empty list = identity.
- merge: cutout only / mask only / both / neither.
- shapes round trip through meta, 3-decimal rounding stable.
- freehand simplify keeps the closed ring closed.

---

## Shipped 2026-09-22, commit e7435bde

Built as specced. Deviations and findings:

| | |
|---|---|
| locale file | `public/locales/en-US.json`, capital US. Plan said lowercase. |
| mode switch | Toolbar, not the mask pane. `alpha` is how you judge the model's mask, and that question gets asked from the *background* tool, where the mask pane is not on screen. |
| `paint` checkerboard | Already exists as a CSS background on the stage canvas. Baking a second one in would fight it at a different cell size, so `paint` draws the composite raw. |
| mask vs crop | Mask is fractions of the SOURCE and rides the `source` sidecar, so no crop conversion is needed. Unlike the anchor, which is stored against the cropped output and needs `anchorAfterCrop`. |

Three bugs found that the plan did not predict:

1. `handleRemoveBackground` ran the model on `source`, so a drawn mask fed hand-cut
   holes into the segmenter and baked a hand edge into the model's alpha — the exact
   independence the plan asks for, broken. Runs on `original` now.
2. **Deadlock.** Modes unlocked only on `hasCutout || hasMask`, and the drawing tools
   are disabled under `rendered`. So the first shape could never be drawn, and the
   locked-out case was an asset with no model run — the feature's headline use case.
   Modes now also unlock on `tool === 'mask'`, and picking the tool opens `paint`.
3. Pre-existing, NOT fixed: closing the Assets dialog while the asset editor is open
   remounts the editor and silently discards unsaved mask work. No prompt, no error.

## Not verified

- Canvas compositing has no jest coverage and cannot have any — see `.claude/TRAPS.md`
  § Tests. Proven instead in a browser: hole reads `[0,0,0,0]` inside and the original
  opaque pixel outside, feather ramps monotonically, cut/keep compose in one pass,
  save/reopen/reload round-trips from the `source` sidecar with no double-application.
- `AssetEditorDialog` still has no test file at all. The mask state, dirty and save
  wiring are compiled and lint-clean, covered by nothing.
- Freehand and vertex-drag were driven only in the browser, never in jest.
- Residual cost: a vertex drag rasterises every shape and does a full
  `getImageData`/`putImageData` per committed render. Fine at a few hundred px,
  unmeasured at 2048. Next move if it bites: debounce the drag, or rasterise at
  preview scale.
