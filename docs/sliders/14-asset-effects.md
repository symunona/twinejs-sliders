# 14 — Asset effects

Live look on an asset. Set in the asset editor. Drawn wherever the asset appears.

v1 ships ONE effect: **glitch**.

## What it is, and what it is not

| | |
|---|---|
| Is | Animated CSS, generated from parameters, over the art. |
| Is not | An edit. Bytes never change. No Apply, no undo, nothing to bake. |
| Lives on | `AssetMeta.effect`. Metadata. |
| Travels | Sync, bundles, the published player. Like `origin`, `name`, `tags`. |

**Not a sidecar.** Sidecars (`source`, `cutout`) are local to the device and stripped from
bundles and sync — they describe pixels a reader never needs. An effect is an instruction to
whoever DRAWS the asset, so it must reach every reader.

### The rule that costs data

`replace()` overwrites `edits`, `mask`, `tuning` — they describe a render of bytes that just
changed. It **must not** touch `effect`. An effect describes how to draw whatever the bytes
are, so it survives a re-crop the way the name does. Pinned by
`packages/asset-store/src/__tests__/effects.test.ts`.

Same reason `importAsset` strips `edits`/`mask`/`tuning`/`sidecars` and **keeps** `effect`.

## Parameters

All 0..100 and unitless, except `bands`, `speed`, `period`, `rotate`. No pixels anywhere: the
same asset draws at a dozen sizes, so every distance is a fraction of the art's own width. An
angle already survives that, so `rotate` is plain degrees.

| Key | Range | Means |
|---|---|---|
| `amount` | 0..100 | Tear distance. 100 = a quarter of the width. |
| `rotate` | 0..30 | Band twist during a tear, DEGREES. Default 0. |
| `bands` | 1..12 | Horizontal slices the art is torn into. |
| `speed` | 1..50 | Steps per second of the tear clock. |
| `split` | 0..100 | Colour channel separation. 100 = 2% of width each way. |
| `period` | 0.4..8 | Loop length, seconds. |
| `burst` | 0..100 | Share of the loop that is corrupted. Rest is the clean picture. |
| `scanlines` | 0..100 | CRT line overlay. |
| `noise` | 0..100 | Snow. |

Source of truth: `GLITCH_RANGES` + `GLITCH_DEFAULTS` in
`packages/render-dom/src/effects.ts`. Ranges are NOT restated in the UI.

`burst` is most of the effect. Permanently torn reads as a broken file; the clean stretch is
what makes it read as interference.

Bands draw when `burst > 0` AND (`amount > 0` OR `rotate > 0`). Either knob alone is a tear:
sliding is the analogue look, twisting is the digital one.

`rotate` defaults to 0, and has to. It is left OUT of the class hash while it is zero
(`LATE_KEYS`), because the class is also the SEED — a hash that moved would re-roll the tear
on every effect an author already tuned. Same for any parameter added later.

Presets in `src/dialogs/asset-editor/effect-tool.tsx`: Weak Signal, Broken Sign, VHS, Corrupt.

## How it is built

Two halves, split so the interesting one is testable. Nothing that composites pixels is
provable under jest (`.claude/TRAPS.md`), but a stylesheet is a string.

| File | Job |
|---|---|
| `packages/render-dom/src/effects.ts` | PURE. Params → class name + stylesheet text. |
| `packages/render-dom/src/effect-host.ts` | DOM. Layers, injection, `syncEffect`. |

### Markup contract

```html
<div class="sliders-fx sliders-fx-<hash>" data-fx="glitch">
  <img class="sliders-fx-layer" data-fx="split-a">   <!-- red channel -->
  <img class="sliders-fx-layer" data-fx="split-b">   <!-- cyan channel -->
  <img class="sliders-fx-layer" data-fx="band" data-band="0">
  …one per band…
  <div class="sliders-fx-layer" data-fx="scanlines">
  <div class="sliders-fx-layer" data-fx="noise">
</div>
```

Host is an **overlay over** the art, never a wrapper around it. Wrapping would reparent the
renderer's `<img>`, which restarts animated WebP and flashes.

### Why generated CSS, not a static sheet

Tear = per-band track of pseudo-random offsets, one per frame. Band count, frame count and
magnitude are all parameters. A static rule with custom properties carries ONE offset, not a
track of forty.

Seeded (mulberry32, seed = the class name), so the same parameters give byte-identical CSS.
An author who saves a look and reopens it sees the tear they approved.

One `<style>` per distinct parameter set, id = the hash. Ten sprites with the same effect
share one. Rewriting a live `<style>` restarts every animation using it — so never rewrite,
add. A drag leaves one sheet per value passed through; `pruneEffectCss` sweeps them 800ms
after the last change.

### Properties it is allowed to touch

`translate`, `rotate`, `clip-path`, `opacity`, `filter`, `background-position`. Nothing else.

`applyFrameFit` and `layout` own `transform`, `transform-origin`, `object-fit`,
`object-position`. `translate` and `rotate` are their own longhands and COMPOSE with
`transform`, so an effect layers onto a mirrored, tilted, origin-pinned sprite with no fight.

A band is clipped BEFORE it is transformed, so `rotate` turns the torn strip rather than a
wedge of the whole picture. The host's `overflow: hidden` keeps a tilted band in frame.

### Why `lighten` and not `screen`

A layer holding only the red channel is darker than the base in green and blue, equal in red.
Per-channel max against the base is therefore the IDENTITY while the layer is not displaced.
Displace it and only the difference shows — red fringe one side, cyan the other.

`screen` brightens even at rest: washed-out photo, not a signal coming apart.

Channel isolation needs `filter: url(#…)` — CSS alone cannot touch one channel. The two
`feColorMatrix` filters are injected as an inline `<svg><defs>`, because a fragment reference
resolves against the DOCUMENT and the published player is one HTML file.

## Staying current

An asset's bytes change UNDER a stable id — the editor writes an edit back over the original
and the store revokes the object URL. No scene text changed, so no parse reaches the stage.

| Link | Does |
|---|---|
| `refreshAssetLibrary()` | Fired by every asset dialog that writes. The only signal. |
| `usePreviewResolver` | Drops its name index on it. Focus too, for bundle import / sync. |
| `SceneStage assetRevision` | `renderer.invalidate()` + re-apply, snapped. Not on mount. |
| `DomRenderer.invalidate()` | Clears url/meta/char caches AND forgets `bgId`. |

`syncBg` early-returns on an unchanged id — right for a keystroke, wrong after an invalidate,
hence `forgetBg()`. `setContent` still bails per entity when the URL comes back the same, so
one edited asset does not restart every animated WebP on stage.

## Where it is drawn

| Consumer | How |
|---|---|
| Asset editor preview | `EffectPreview` copies the preview canvas to a data URL, `syncEffect`. |
| Renderer, entity | `DomRenderer.applyEffect`, overlay inside the sprite box. |
| Renderer, backdrop | `DomRenderer.syncBgEffect`, own element in the bg layer. |

Same `syncEffect`, same generated CSS, same layers. What the author approves IS what the
reader sees — the rule from `.claude/ARCHITECTURE.md`.

Renderer notes:

- Overlay goes INSIDE the sprite box, so it inherits position, rotation, mirror and opacity
  for free. An effect has no geometry of its own.
- Re-appended on every `applyEffect`. `setContent` calls `replaceChildren()` on every asset
  change, so an overlay left alone vanishes at the first pose change.
- `pointer-events: none`, invisible to `measure()`, `rectOf` and the visual editor's hit
  tests. A tear that moved an anchor would drag every speech bubble with it.
- A placeholder gets no overlay — no pixels to tear.

Backdrop is a SEPARATE path. `bg:` is not an entity: it is the stage, `object-fit: cover`,
with a twin sliding behind it for the scrolling motions, and an `<img>` is a replaced element
so nothing can be parented to it. So the overlay is its own element, last in the bg layer,
always `cover`. `resolveAll` primes the bg's meta alongside its url, because `setBackdrop` is
synchronous and an awaited effect would land a frame after its picture.

Not cross-faded with the backdrop swap. A tear fading in over a picture that is itself fading
in is one muddy dissolve; the effect is cheap to simply cut.

## Accessibility

`@media (prefers-reduced-motion: reduce)` hides `.sliders-fx` entirely. The base `<img>` is
not ours, so the asset still draws — plain.

## Verification

jest covers: clamping, determinism, class hashing, band clip paths tiling with no seam, stop
collapsing, layer build/reuse, stylesheet pruning, renderer DOM, store persistence.

Pixels were checked in Chrome via `/root/tmp/fx/` (harness + `freezeAt(seconds)` to pause the
animations at a chosen phase). Tearing, channel fringing, scanlines and snow all confirmed;
two phases sampled to prove bands move independently.

## Not done

- Scene YAML cannot set or override an effect. Asset-wide only.
- One effect per asset.
- No second effect family. `EffectKind` is a discriminant so adding one does not reshape
  `AssetEffect`.
- A detached edit (generator history) has no asset, so the tool is hidden there.
