# 19 — Particles

Fire, smoke, sparks, snow. GPU particle emitters, placed in a scene like a prop.
Model: RPG Maker particle plugins (Sang Hendrix style) — sprite + a few numbers, presets.

## What it is

| | |
|---|---|
| Emitter | an ASSET, kind `fx` = a PRESET. `particles` metadata = the emitter. Its bytes = thumbnail only. |
| Sprite | `sprite:` = ANY still image asset, by name. Absent / unknown = built-in soft dot. |
| Placed | as an entity, by name: `props: {fire: {at: 0}}`. Position, scale, z, opacity, beats, drag: free. |
| Tuned per scene | entity key `emit:`, per key over the asset's numbers. |
| Made | Particles dialog (toolbar, `alt+x`). |
| Drawn | `render-dom` — WebGL point sprites, one draw call per emitter. 2D canvas fallback. |

Why an asset, not a new record type: sync, bundles, library collections, name resolution,
lint, published player — all already carry `AssetMeta`. `particles` is a recipe key like
`effect`/`walk`: survives `replace`, travels in bundles. Zero server change.

## Parameters

Source of truth: `packages/scene-types/src/particles.ts` (`EMIT_RANGES`, `EMIT_DEFAULTS`,
`EMIT_PRESETS`). Not restated in UI.

| Key | Means |
|---|---|
| `rate` | particles / s. `0` stops new ones, the rest finish. |
| `life` | seconds each lives (±25% jitter) |
| `speed` | launch speed, box widths / s (±20%) |
| `angle` | direction, degrees. 0 = up, 90 = right (same sense as `rot:`) |
| `spread` | cone width, degrees. 360 = all ways |
| `gravity` | box widths / s², + down, − floats |
| `size` | birth size, fraction of box width |
| `grow` | death size × `size` |
| `fade` | opacity lost by death. 1 = gone |
| `spin` | deg / s, random share each way. 0 = upright (flames point up) |
| `area` | spawn disc radius, fraction of box width |
| `color` / `colorEnd` | tint birth → death, `#rrggbb`. Multiplies the sprite: white art takes it exactly |
| `blend` | `add` glows (fire, magic). `normal` paints (smoke, snow) |
| `sprite` | the particle picture: any still image asset name (pack `p-*`, a prop, a backdrop…). Resolved like every scene name: own collection, then attached. |

Asset only: `box: {w, h}` px at scale 1 — the entity's size, what the editor selects and
drags. Emission point = the asset's `origin` (default bottom centre). Particles leave the
box freely: see Drawing surface.

`sprite`: ANY static image asset, by name. Absent = built-in soft dot. The emitter
asset's own bytes are never drawn.

## Drawing surface

| | |
|---|---|
| Canvas | one per emitter, the size of the WHOLE entity layer (`inset 0`, 100%). Never clipped by the box. |
| z | canvas sits right after its entity box in the layer, `z-index` copied every frame → sorts with the cast like the sprite would. |
| Position | read off the entity box every frame: computed `transform` matrix + `offsetWidth`. A glide, drag or camera move carries the particles. |
| Unit | box width as drawn → `scale:` and `stretch:` x grow the effect. |
| Turn / mirror | `rot:` turns the whole field about the origin, `flip:` mirrors it. Single particle sprites are not turned by `rot:`. |
| Fade | box's computed opacity multiplies every particle: enter/exit fades, `opacity:`. |
| Space | particles live in EMITTER space: move the emitter, the cloud moves with it (no trails). |
| Not applied | `grade:` (lives on the art wrapper; the canvas is outside it). |

No pixels in the numbers: distances are box fractions, so `scale:` is the only size knob.

## Scene

```yaml
props:
  campfire: {ref: fire, at: [0.2, -0.7], scale: 0.6}
beats:
  - box: "The fire dies down."
    campfire: {emit: {rate: 5, size: 0.08}}
  - campfire: {emit: {rate: 0}}      # out. Embers finish.
  - campfire: {emit: ~}              # back to the asset's own
```

- `emit:` merges per key, like `grade:`. State: later beats inherit.
- `emit: {sprite: lamp-glow}` swaps the picture for this scene; the preset stays.
- On a non-emitter: parsed, ignored.
- Changes snap. In-flight particles keep going; field never restarts on an apply.

## Editors

| Where | What |
|---|---|
| Particles dialog | list of emitters · live preview (same `ParticleHost` as the stage) · knobs · box · origin · sprite strip · presets · Add to Current Scene |
| Scene editor, Particles tab (stars) | own sidebar tab, only while ONE emitter is selected, orange like Transform → particle system dropdown (`ref:`) + Edit · Reset all to defaults (`emit: ~`) · same knobs, write `emit:`. Highlighted = overridden. Slider bursts = one undo step (`+sliders-emit`). |

Defaults vs overrides:

| | |
|---|---|
| Dialog | edits the ASSET = the system's defaults. Every scene placing it follows live (stage + Particles tab base). |
| Shared emitter (pack) | dialog writes it in place (`scope: 'all'`): every story attaching the pack follows. Note under the preview says so. Locked collection → `fork`: this story's own copy, shadows by name. `save-emitter.ts`. |
| Scene `emit:` | per-key overrides, survive any default edit and a system swap. |
| Add to Current Scene | prop `<name>: {at: 0}` (numbered when taken) into the scene editor open last, the paste path: one edit, one undo, selected. Disabled with a hint when no editable scene editor is open. `particle-scene-target.ts`. |

New Emitter = preset numbers + `sprite:` = the preset's pack sprite. Bytes = that sprite
(or a dot) as thumbnail. Sprite pick = `particles.sprite = name`, bytes untouched.
Picker: any still visual asset, pack (`particle-sprite` tag) first, filter box past 24.
Not offered: animated files, emitters, character pose images.

Scene Particles tab: own sprite picker (first tile = the emitter's own), pencil = open
this emitter in the Particles dialog (`particle-focus.ts` bus, like `character-focus.ts`).

## The pack

`scripts/particle-pack.mjs` → shared collection `particles` on the library server.
Attach it to a story in the asset manager.

| Name | |
|---|---|
| `p-dot` `p-glow` `p-flame` `p-puff` `p-spark` `p-star` `p-flake` `p-ring` `p-pixel` `p-drop` `p-leaf` | 64², white on transparent, tag `particle-sprite` |
| `fire` `smoke` `sparks` `snow` `magic` | ready emitters = presets (kind `fx`, tag `particles`), `sprite:` → a `p-*` |

Shapes are CODE (`SPRITES` in the script). Iterate: edit, `--out /root/tmp/pp --dry-run`
to look, re-run without `--dry-run` to push. Idempotent: only changed bytes / numbers move.

## Files

| File | Job |
|---|---|
| `packages/scene-types/src/particles.ts` | params, ranges, presets, merge |
| `packages/render-dom/src/particles.ts` | PURE sim, seeded. Tested. |
| `packages/render-dom/src/particle-host.ts` | WebGL / 2D draw, one shared rAF loop |
| `dom-renderer.ts` `applyParticles` / `particleAnchor` | canvas after the entity box, `<img>` hidden, anchor per frame |
| `src/dialogs/sliders-particles/` | dialog, `EmitControls` (shared with scene editor) |

## Limits (v1)

- One WebGL context per emitter, each a full-layer canvas. Browsers cap ~16; a lost context falls back to 2D (no tint). Many emitters = many full-size canvases (fill cost).
- One sprite per emitter. No sprite sheets, no colour/size curves beyond start→end.
- Editor stage "still" mode does not freeze particles (rAF, not CSS).
- `twine-cli` lint knows `emit:` (shared parser), not whether the ref is an emitter.
- Refs: `emit.sprite` + emitter `particles.sprite` count as art (bundle, usage refs, story-map
  rows). Ctrl-click on a sprite name in the passage editor: not wired.
