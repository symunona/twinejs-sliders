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
```

- Chapbook's vars section (`--`) stays as-is. Flat JS `key: value`. Don't put scene data there.
- `[scene]` is our modifier. `processRaw` hands us the block verbatim, before Markdown.
- `[note]` is Chapbook's existing comment modifier = the director's-notes slot, free.

## How the player draws it (D16)

**A passage with a `[scene]` in it IS the scene.** Both halves are the default:

| | |
|---|---|
| Full screen | The stage fills the viewport, the way the editor's preview does in full screen (D12). `#page`'s column, margin, header and footer step aside; the scene's `links:` overlay the bottom. |
| Scene only | Everything outside the YAML is dropped before render: prose, `[note]`, `[continued]`, any other modifier. The vars section still runs — it sets state, it doesn't draw. |

Consequence worth stating out loud: **every way out of a scene passage must be in
its `links:`.** A `[[link]]` written under the block is not drawn.

Both are variables, so a passage or a story can opt out:

```
sliders.sceneOnly: false     # draw the text around the scene too
sliders.fullScreen: false    # stage stays a 16:9 box inside the page
```

A passage with no `[scene]` in it is untouched — still an ordinary Chapbook passage.

Where it lives in the fork: `src/runtime/sliders/cinema.ts` (the block filter and the
`sliders-cinema` body class) and `cinema.css`. The filter runs in `renderParsed`, after
vars are dispatched, so a passage can turn it off in its own vars section.

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
bg: tavern/night              # asset id, never a path. Omit it and `id` stands in.
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
| `id` | string | globally unique. Dupe = error. Doubles as the default `bg`. |
| `from` | ref | inherit a state. Flips merge semantics — see Reuse. |
| `bg` | asset id | backdrop. Not a layer. Defaults to `id`, `~` for none. |
| `camera` | map | optional. `{at, zoom}`. |
| `cast` | map of id → entity | characters |
| `props` | map of id → entity | objects |
| `fx` | seq | `name@amount` or `{id, …}` |
| `beats` | seq | the timeline |
| `links` | map of name → props | link targets + props |

#### `id` is the default backdrop

A scene called `tavern-night` almost always wants the `tavern-night` backdrop, so writing
the name twice was pure ceremony — the same shorthand `props:` already has, where the entry
key doubles as the asset name.

- `bg:` wins whenever it is written.
- `bg: ~` says the scene genuinely has no backdrop.
- The implied backdrop is a **soft** reference: art by that name draws, no art by that name
  draws nothing. No lint error, no bundle "unresolved", no `? bg` placeholder — the author
  never asked for it. An explicit `bg:` that misses is still an error, because they did.
- A patch (`from:`) is left alone. Its `id` names the variant, not the art, so it inherits
  the backdrop it came from rather than demanding a file per variant.

### Entity keys

| Key | Meaning |
|---|---|
| `at` | position. See Coordinates. |
| `of` | another entity's id. Makes `at` relative to it. See Relative placement. |
| `scale` | uniform size multiplier. 1 = natural size. Scales about the origin, so a character keeps its feet on the floor. Must be > 0. |
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

## Relative placement — `of:` (D17)

`of:` names another entity. `at:` is then an **offset from it** instead of a stage position.
Move the parent and everything hanging off it comes along.

```yaml
props:
  table:  {at: -0.3}
  candle: {of: table, at: [0.1, 0.2], layer: front}   # 0.1 right of the table, 0.2 above
  plate:  {of: table, at: 0.15}
```

| Rule | |
|---|---|
| Bare `at: 0.4` on a child | x offset only, **y level with the parent**. Not the layer baseline — see below. |
| What inherits | **position only.** |
| What does NOT | `scale`, `flip`, `frame`, `layer`, `z` — a child keeps its own. |
| Chains | allowed, any depth. `of:` edges must form a DAG. |
| Id space | `cast:` and `props:` share one, so a prop may hang off a character. |
| Unknown parent | error in a snapshot scene; ignored in a patch scene, where it may be inherited. |
| Cycle | error. At runtime the loop is broken and the entity falls back to world space. |
| `of: ~` | detach. The one key a patch scene can CLEAR — see below. |

Translation only is deliberate. It keeps resolution a vector add with no sprite metrics in
it, which is what lets it live in `scene-core` where the **differ** can see it: a child
glides when its parent moves, rather than teleporting while the parent animates. Attaching a
prop to a character's *hand* is a different feature (an anchor socket), not this one.

### ⚠️ A bare `at:` on a child is measured from ZERO, not from the floor

Everywhere else, `at: 0.4` means "x = 0.4, y at the layer baseline" — the floor. For an
`of:` child that would read *"0.4 across and 0.85 **below** my parent"*, which drops a
candle a stage-height under its table and off the screen entirely.

So on an entity that declares `of:`, a bare number is **x offset only, y level with the
parent**:

```yaml
props:
  table:  {at: -0.3}                  # y = -0.85, the floor
  candle: {of: table, at: 0.4}        # y = 0, i.e. level with the table
  candle: {of: table, at: [0.4, 0.2]} # explicit, 0.2 above it
```

One gap: if `of:` is **inherited** through `from:` and the patch writes a bare `at:`, the
parser cannot see the parent and falls back to the floor. Write an explicit pair in that
case. The editor always does.

### `of: ~`

Under `from:` an absent key means *inherited*, so omitting `of:` keeps the parent. Detaching
needs to be said out loud:

```yaml
from: tavern-night
props:
  candle: {of: ~}      # back to world space, at whatever `at:` it inherited
```

### Where it resolves

A `Stage` holds what the author wrote — `at` local, `of` intact. Absolute coordinates are
derived at the point of drawing (`resolveStage()`), never before. That is what keeps a beat
patch and a `from:` merge operating on the author's own numbers.

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

## Speech styles

Two keys on a say beat, and the same two inside a `box:` map:

| Form | Means |
|---|---|
| `- mira: {say: "…", as: yell}` | style token, shorthand for `bubble: {as: yell}` |
| `- mira: {say: "…", bubble: {…}}` | the long form: style, placement and geometry |
| `- box: {text: "…", as: narrator}` | narration takes the same tokens |

`bubble:` keys:

| Key | Means |
|---|---|
| `as` | style token |
| `place` | `auto` (hang off the speaker) · `top` · `bottom` · `left` · `right` · the four corners · `centre` |
| `at` | `[x, y]`, the bubble's centre as fractions of the stage box. Beats `place`. |
| `w` | width, fraction of the stage width |
| `bg` `color` `font` `size` | one-off overrides, written as CSS custom properties |

Presets with CSS in the renderer: `normal`, `bold`, `italic`, `bold-italic`, `yell` (spiky
burst), `whisper`, `narrator`. **Any other token is legal**: it reaches the DOM as
`data-style="token"` on `.sliders-bubble` / `.sliders-box`, and the story's own stylesheet
paints it. That is the extension point — no format change needed for a new look.

```css
/* In the story stylesheet. */
.sliders-bubble[data-style='curse'] {
  background: #200;
  color: #f66;
  font-family: Georgia, serif;
}
```

A character carries defaults in its manifest (`bubble: {as, place}`, set in the character
editor), and a beat's own keys merge over them key by key. A narrator is a character with
`place: top` and no frames: nothing on stage to point at, so the bubble draws no tail.

In the editor, dragging a bubble writes `at:` and the side handles write `w:` — both onto
the beat, since the same character can speak twice and want the bubble somewhere else each
time.

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

The editor writes this for you: **Scene ▸ Overlay on '…'** inserts a patch pointing at the
last scene you named, pre-filled with the cast it inherits. **Scene ▸ Insert Last Scene**
inserts a copy of it instead, minus the `id:` — ids are global, so a verbatim copy would
collide.

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
