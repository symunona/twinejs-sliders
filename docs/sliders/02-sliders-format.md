# 02 — Sliders (the Chapbook fork)

Fork of **Chapbook 2.3.1**. MIT. Public GitHub. **No upstream PR** (D13).
Adds one modifier: `[scene]`. Everything else is Chapbook.

## Passage shape

```
mood: tense
seen_mira: true
--
[scene]
id: tavern-night
bg: tavern/night
cast:
  mira: {at: -0.4, frame: arms-crossed}
beats:
  - mira: "You shouldn't have come back."

[note]
Director: she should feel cornered. Not rendered.

[continued]
Normal Chapbook Markdown still works down here.
```

- Chapbook's vars section (`--`) stays as-is. Flat JS `key: value`. Don't put scene data there.
- `[scene]` is our modifier. `processRaw` hands us the block verbatim, before Markdown.
- `[note]` is Chapbook's existing comment modifier = the director's-notes slot, free.

## The one design rule

**Declarative snapshot, not commands.**

- ❌ `show mira; move mira left; hide joren` — behaves differently depending on what ran
  before. Not copy-pasteable.
- ✅ The block states the **complete stage**. Engine **diffs** against the previous stage and
  derives transitions.

Paste a block anywhere → identical stage. React-vs-jQuery, applied to a stage.

## Scene YAML

```yaml
[scene]
id: tavern-night              # globally unique. Required if anything refers to it.
from: ~                       # optional. See "Reuse" below.
bg: tavern/night              # asset id, never a path
camera: {at: [0, 0], zoom: 1} # optional. The 3D hook lives here.

cast:
  mira:  {at: -0.4, frame: arms-crossed}
  joren: {at: 0.35, frame: idle, flip: true, layer: back}

props:
  candle: {at: [0.1, -0.2], layer: front}
  table:  {at: 0}

fx: [rain@0.6]

beats:
  - mira: "You shouldn't have come back."
  - joren: "And yet."
  - mira: {frame: angry, at: -0.25, say: "Get out."}
  - wait: 0.5
  - mark: tense
  - box: "The candle gutters."
  - mira: "Will you [[stay]] or [[go]]?"

links:
  stay: {to: Tavern Fight, if: has_weapon, icon: sword}
  go:   {to: Street, transition: fade}
```

### Top-level keys

| Key | Type | Notes |
|---|---|---|
| `id` | string | globally unique. Dupe = error. |
| `from` | ref | inherit a state. Flips merge semantics — see Reuse. |
| `bg` | asset id | backdrop. Not a layer. |
| `camera` | map | optional. `{at, zoom}`. |
| `cast` | map of id → entity | characters |
| `props` | map of id → entity | objects |
| `fx` | seq | `name@amount` or `{id, …}` |
| `beats` | seq | the timeline |
| `links` | map of name → props | link targets + props |

### Entity keys

| Key | Meaning |
|---|---|
| `at` | position. See Coordinates. |
| `frame` | which named frame of the character/prop (D5) |
| `flip` | mirror horizontally |
| `layer` | `back` / `mid` / `front`. Optional. |
| `z` | numeric escape hatch within a layer |

## Coordinates

| Rule | |
|---|---|
| `at: -0.4` | bare number = x only. y snaps to the layer baseline. |
| `at: [x, y]` | explicit. |
| Origin | **screen centre.** |
| x | −1 = left edge, +1 = right edge. |
| y | **UP is positive.** |
| Units | normalized, never pixels. Resolution-independent, maps to a 3D camera plane. |
| Character origin | its **feet**. `at: 0` = standing centre, not floating centre. |

## Layers (D11)

Exactly three, fixed order. Not author-definable.

```
back  →  mid  →  front        (+ ui: DOM bubbles, above all, not addressable)
bg is the backdrop, outside the layer stack.
```

- Default for `cast` and `props`: `mid`.
- Within a layer, z derives from y. Lower on screen = nearer = drawn later.
- Override with numeric `z:`.

## Beats

| Form | Means |
|---|---|
| `- mira: "text"` | mira speaks. Bubble at her `bubble` anchor. |
| `- mira: {frame: angry, at: -0.25, say: "…"}` | mutate stage **and** speak, one beat |
| `- box: "text"` | narration box, no speaker |
| `- wait: 0.5` | pause, seconds |
| `- fx: thunder` | fire an effect |
| `- mark: tense` | name this state so `from:` can target it. Renders nothing. |

## Links (D3)

Wiki-style. **Always write the target inline**, because Twine's own editor parses `[[…]]`
out of the passage *source* to draw the story map and auto-create passages. A bare
`[[stay]]` makes Twine invent a passage called `stay`.

| Form | Use |
|---|---|
| `[[stay->Tavern Fight]]` | the normal case |
| `[[stay->Tavern Fight]]` + `stay: {icon: sword}` under `links:` | when the link needs props |

⚠️ **No spaces around `->`.** Twine does not trim link targets, so `[[stay -> Tavern Fight]]`
creates a passage named `" Tavern Fight"` with a leading space — which then silently fails
to match the real one.

Link props: `to`, `if`, `icon`, `transition`. `to:` is optional when the target is inline;
the parser fills it in.

Because bubbles are DOM (D2), a link in bubble text is an `<a>` in a `<div>`. Hover, focus,
keyboard nav, screen readers — free.

## Reuse: id, from, marks

Every scene compiles to a state sequence:

```
S₀ (enter) ─beat1→ S₁ ─beat2→ … ─beatN→ Sₙ (exit)
```

`enter` and `exit` are **derived**, never authored. They cannot drift.

### References

| Ref | Means |
|---|---|
| `tavern-night` | that scene's **exit** state (default — what continuation wants) |
| `tavern-night@enter` | state at beat 0 |
| `tavern-night@tense` | state at the beat marked `tense` |

### Continuing / branching

```yaml
[scene]
id: tavern-fight
from: tavern-night@tense
cast:
  mira: {frame: angry}     # delta only
beats:
  - mira: "Then draw."
```

### ⚠️ `from:` flips the merge semantics — the one rule to memorise

| | no `from:` (snapshot) | with `from:` (patch) |
|---|---|---|
| key absent | **removed** from stage | **inherited** unchanged |
| `mira: {frame: angry}` | full definition | shallow-merged onto inherited |
| `mira: ~` | n/a | **explicitly removed** |
| `cast: !only {…}` | n/a | replace whole cast (escape hatch) |

### The safety property

> **`from:` resolves by name, never by "the passage the player came from."**

A passage renders identically regardless of path taken. A patch scene isn't self-contained,
but it names its own base — that is not the same as depending on runtime history.
Determinism holds. The differ always has one well-defined previous stage.

### Branching needs no special rule

Links go to passages. Branch → passages exist. Idiom:

```
Tavern - Arrival    id: tavern-night                              … [[stay]] [[go]]
Tavern - Fight      id: tavern-fight   from: tavern-night@tense
Street              id: street         from: tavern-night
```

`from:` edges must form a **DAG**. Cycle = error.

## Character manifest

Read by the runtime. Authored in the [character editor](04-twinejs-character-editor.md).

```yaml
id: mira
name: Mira
size: {w: 512, h: 1024}       # uniform for now, per-frame later
origin: {x: 0.5, y: 1.0}      # feet, as a fraction of the frame
anchors:                       # fractions -> resolution independent
  bubble: {x: 0.62, y: 0.18}   # in 3D these become named sockets/bones
  mouth:  {x: 0.50, y: 0.22}
frames:
  idle:         {asset: a_8f21}          # animated .webp
  arms-crossed: {asset: a_3c09}
  wave:         {asset: a_5d14, loop: false}
tags: [tavern, main-cast]
```

- **Animation = an animated file** (gif / animated webp / apng). No sprite sheets, no
  timeline, no frame scheduler in v1. Deletes an entire subsystem. (D5)
- Anchors/origins as **frame fractions** is the extensibility hinge: uniform sizes today,
  per-frame sizes tomorrow, 3D sockets after — scene YAML never changes.
- No `face:` / compositing in v1. Add `slots:` later without touching scene YAML.

Manifests travel as **hidden passages** (`SlidersCast`, `SlidersAssets`) so they survive
into stock Twine and through import/export.

## Renderer contract

```ts
interface Renderer {
  mount(el: HTMLElement, assets: AssetResolver): Promise<void>;
  apply(stage: Stage, transitions: Transition[]): Promise<void>;
  /** Screen-space position of a named anchor. THE critical method. */
  measure(entityId: string, anchor: string): {x: number; y: number} | null;
  destroy(): void;
}
```

`measure()` is the whole 3D story. Bubbles stay DOM (D2) and ask the renderer where the
anchor landed. 2D: a transform. three.js: a camera projection of a socket.
**If `scene-core` computed bubble positions itself, the 3D renderer could never be correct.**
Lock this before `render-dom` ships.

## State and save (D10)

- Store the resolved **`Stage` snapshot** in Chapbook's variable store. Rides along with
  save/load free — Chapbook 2.0 forces all state to be JSON-serializable.
- Never store renderer objects.
- **Save granularity = passage.** No beat index in state. Reload replays the passage's beats
  from the top. Accepted cost: a player who quits mid-conversation re-reads a few lines.

## Runtime validation (tier 3)

The engine sees all passages at boot. Build the scene index there and report:
duplicate `id`, unknown `from:` target, unknown `@mark`, `from:` cycles.

Surface in Chapbook's existing `<warning-list>` / Backstage. **This is the net that still
fires in stock Twine**, which is what keeps the fork-independence rule real.
