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

### The link list under the stage

The `links:` map is drawn a second time, as ordinary Chapbook links under the stage (over
the bottom of it in full screen). **Only when the beats offer the reader nothing to
click.**

| The beats hold | Bottom list |
|---|---|
| nothing clickable | drawn |
| a `[[…]]` in a `say:`/`box:` line | not drawn |
| a `link:` on an entity, set by a beat | not drawn |
| only a dead link — a `[[name]]` no `links:` entry claims, or a `link:` whose entry lost its `if:` | drawn |
| a `link:` declared in `cast:`/`props:` but never in a beat | drawn |

Why: the list would show the same two choices twice, and show them from beat 1 — the
answer visible before the line that asks the question. A scene with no clickable beats
still needs it, or there is no way out at all.

The rule is `beatsOfferLinks` in `@sliders/scene-schema`, asked after `if:` filtering.

Variables, so a passage or a story can opt out:

```
sliders.sceneOnly: false     # draw the text around the scene too
sliders.fullScreen: false    # stage stays a 16:9 box inside the page
sliders.showLinks: true      # always draw the list, clickable beats or not
sliders.showLinks: false     # never draw it
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
| `bg` | asset id or map | backdrop. Not a layer. Defaults to `id`, `~` for none. Map form adds motion. |
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

#### A backdrop that moves

```yaml
bg: {id: cellar, fx: parallax_left, speed: 20}
```

| Key | Meaning |
|---|---|
| `id` | the art, same as the scalar form. `~` = no backdrop. |
| `fx` | motion token. `parallax_left/right/up/down`, `scroll_infinite_left/right/up/down`, `earthquake`, `circling` — or any token your story stylesheet paints. |
| `speed` | seconds one cycle takes. Optional: each preset carries its own pace, since a drift is 24s and a shudder half of one. |

- The motion is spelled `fx:`, NOT `sfx:` — `sfx:` is a sound everywhere else in a scene.
  Writing it here is an error with a hint, not a typo fix.
- Motion is read off `bg`, never off its own absence: a scene naming a backdrop states its
  motion in full, so `bg: cellar` under an inherited parallax STOPS it. A backdrop that came
  from `id:` alone asked for nothing, so it leaves an inherited motion alone.
- Unknown tokens are legal. The renderer writes `data-bg-fx` on the backdrop and the stage
  root and stops there, the way `bubble: {as: …}` already works.

**parallax vs scroll_infinite.** A parallax DRIFTS inside the frame: the picture is
oversized by 8% and slides back and forth, so nothing ever leaves. A `scroll_infinite`
LOOPS the picture: it travels a whole frame and starts over, which is the endless-walk
backdrop. The renderer draws a second copy one frame ahead for those four, because an
`<img>` cannot tile — so the restart is invisible, but only if the ART ITSELF tiles. A
backdrop whose left and right edges do not match will show that mismatch once per lap; that
is the picture, not the motion.

#### A beat can cut the backdrop

```yaml
beats:
  - mira: "Down here."
  - bg: {id: cellar, fx: earthquake}   # a beat of its own
  - mira: {say: "Not any more.", bg: street}   # or riding on a line
  - bg: ~                              # take it away
```

`bg:` sits on the beat BASE, next to `dur:` and `sfx:`, so it rides on a line, on a stage
move or on a beat of its own. It is stage STATE, not an event like `sfx:` — every later
beat keeps the new backdrop, and the scrubber stepping back shows the old one. Not accepted
inside `cast:`/`props:`/`entities:`: a backdrop belongs to the stage, not to whoever is
standing on it. The three scalar commands (`wait`, `fx`, `mark`) have no body map, so they
cannot carry one.

### Entity keys

| Key | Meaning |
|---|---|
| `at` | position. See Coordinates. |
| `of` | another entity's id. Makes `at` relative to it. See Relative placement. |
| `scale` | uniform size multiplier. 1 = natural size. Scales about the origin, so a character keeps its feet on the floor. Must be > 0. |
| `rot` | tilt, degrees CLOCKWISE, about the same origin `scale` grows about. Negative leans the other way. Absent = 0. |
| `frame` | which named frame of the character/prop (D5) |
| `flip` | mirror horizontally |
| `layer` | `back` / `mid` / `front`. Optional. |
| `z` | numeric escape hatch within a layer |

### Rotation — `rot:`

```yaml
props:
  sign: {at: -0.4, rot: -8}          # leaning left
beats:
  - sign: {rot: 40, dur: 1}          # tips over the course of a second
```

| Rule | |
|---|---|
| Unit | degrees, clockwise. |
| Pivot | the entity's **own origin** — a character's feet, a prop's anchor. Pin that anchor in the asset editor or character editor; there is no per-scene pivot key. |
| Absent vs `rot: 0` | the same rotation. A beat gaining `rot: 0` produces no transition. |
| With `flip` | the mirror is applied FIRST, so a positive `rot` leans the same way on screen whichever way the sprite faces. |
| Past 360 | accepted with a warning — it draws as `rot % 360`. A spin is a frame cycle, not a pose. |
| `of:` children | do not inherit it. |
| Frame steps | a step of a `frame:` cycle may carry its own `rot`, like `at`/`scale`/`flip`. |

There is deliberately **no** `transform:` string key. Composition order is the renderer's, so
that `at`, `scale`, `rot` and `flip` each stay one number the differ can time, the beat
writer can patch and the editor can drag.

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
| What does NOT | `scale`, `rot`, `flip`, `frame`, `layer`, `z` — a child keeps its own. |
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

### Timing — `dur:`

A beat with no `dur:` waits for the reader if it says something, and plays straight on if
it only stages something. `dur:` times it instead, and because **a beat is the animation**,
the same number is how long its stage changes take.

```yaml
beats:
  - mira: {at: 0.3, dur: 0.8}       # slides over 0.8s, then straight on
  - mira: {say: "Over here!"}       # waits for a click
  - mira: {say: "…", dur: 2}        # bubble up, 2s, next beat
  - box: {text: "Silence.", dur: 2} # long form only
  - wait: 1.5                       # still the explicit hold
```

| Rule | |
|---|---|
| Where | inside a beat body, beside `say:`. An `unknown-key` in `cast:`/`props:` — timing belongs to a moment, not to a sprite. |
| Beats the reader | `dur:` overrides `sliders.autoAdvance`. The author timed the line; a preference must not stretch it. |
| `dur: 0` | snap and move straight on. A warning on a line of dialogue — nobody can read it. |
| Last beat | still waits for the reader whatever its `dur:` — otherwise the links under the stage appear mid-sentence. |
| No `dur:` on | `wait` (it *is* a duration), `fx`, `mark` — all scalars with no body map, and none of them are read. |

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
| `as` | style token — a DRAWN shape, a CSS preset, or your own |
| `place` | `auto` (hang off the speaker) · `top` · `bottom` · `left` · `right` · the four corners · `centre` |
| `anchor` | `speaker` (default) · `scene` — detach from the speaker: no tail, `at:` alone places it |
| `sizing` | `auto` (default, snap to the words) · `absolute` (box is `w` x `h` of the slide, TEXT is fitted to it) · `manual` (same box, text stays normal size) |
| `at` | `[x, y]`, the bubble's centre as fractions of the stage box. Beats `place`. |
| `tail` | `[x, y]`, where the tail points, as fractions of the stage box — instead of at the speaker. `anchor: scene` ignores it. |
| `w` | width, fraction of the stage width. Wrap cap under `auto`, exact width under `absolute` / `manual`. |
| `h` | height, fraction of the stage height. `absolute` / `manual` only. |
| `bg` `accent` `color` `font` `size` | one-off overrides. `bg`/`accent` are the pair a drawn shape paints with. |

### Four layers, widest first

A line's look is merged key by key down this chain, so each layer states only what it cares
about:

| Layer | Written as |
|---|---|
| story | `sliders.bubble.as`, `.font`, `.sizing`, … in a vars section (the editor's Story ▸ Details writes them into the start passage) |
| scene | `bubble: {…}` at the top of the scene |
| character | the character's own `bubble:` in the library |
| beat | `as:` / `bubble:` on the line |

### Drawn shapes

`comic`, `shard`, `impact`, `thought` are DRAWN, not styled: the renderer builds an SVG from
the bubble's size, its tail direction and the two colours, and the CSS box behind it is
turned off. They are pure functions of those numbers
(`packages/render-dom/src/bubble-shapes.ts`), so the same bubble always draws the same
outline, and the drawing may reach outside the box — a tail, an ink line, an offset slab —
without moving the text inside it.

| Name | Looks like |
|---|---|
| `comic` | fat squircle balloon, thick ink outline, straight spike |
| `shard` | hard panel on an offset colour plate, lightning-bolt tail |
| `impact` | `shard` plus an accent mark at the corner opposite the tail |
| `thought` | scalloped cloud, a trail of shrinking puffs instead of a tail |

A shape and a CSS preset cannot be combined — one token, and a shape replaces the box.

### Fixed size

```yaml
bubble: {sizing: absolute, w: 0.42, h: 0.22, as: shard}
```

Every line in that scene is the same rectangle, 42% x 22% of the slide, and the type is
scaled until the words fit it. That is the opposite trade from `auto`, where the type is
fixed and the box grows. Use it when the panel is part of the composition; use `auto` when
the words are.

`sizing: manual` is the third corner: the SAME fixed rectangle, and the type stays the size
it is everywhere else in the scene. Words that do not fit are clipped — you stated the box,
so the box is what you get. It is what the scene editor writes when you drag a bubble's top
or bottom edge, carrying the width the bubble already had across:

```yaml
- mira: {say: "Fixed box, normal type.", bubble: {sizing: manual, w: 0.5, h: 0.45}}
```

| Sizing | Box | Type |
|---|---|---|
| `auto` | follows the words | normal |
| `absolute` | `w` x `h` | fitted to the box |
| `manual` | `w` x `h` | normal, clipped |

### Aimed tail

```yaml
- mira: {say: "It came from in there.", bubble: {tail: [0.85, 0.6]}}
```

`tail:` points the tail at a stage point instead of at the speaker's own `bubble` anchor: a
door, a window, somebody off the side of the frame. Stage fractions, not an offset from the
speaker, because a sprite that walks away would drag an offset with it. It stands in for the
speaker's anchor everywhere, so an unpinned bubble also hangs off the named point. A
detached bubble (`anchor: scene`) grows no tail at all and ignores it.

Dragging the amber cross in the scene editor writes it.

### Detached

```yaml
- mira: {say: "She walks. The caption does not.", bubble: {anchor: scene, at: [0.3, 0.22]}}
```

`anchor: scene` takes the bubble off its speaker: it grows no tail, it does not follow them,
and `at:` is the whole story. A caption, a voice-over, an off-screen shout.

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

**Targets match case-insensitively.** `to: start` finds the passage `Start`; an exact match
always wins, and case is the only looseness — nothing else about a name is folded. The
player does this in `passageNamed()` (`matchPassageName` in `@sliders/scene-types`), and
the story map, the ghost cards, the editor's link check and `twine-cli lint` all read the
same rule, so an arrow that is drawn is an arrow the reader can follow. Chapbook's `go()`
THROWS on a name it cannot find, and the throw lands on the reader as "An unexpected error
has occurred", so a link that resolves everywhere except the player ends the session.

A target that only matches by case still works, and both the editor and `twine-cli lint`
warn about it with a one-click fix: one room spelled two ways is one rename from a dead
link.

Because bubbles are DOM (D2), a link in bubble text is an `<a>` in a `<div>`. Hover, focus,
keyboard nav, screen readers — free.

### Clickable objects: `link:`

An entity key. The reader clicks the door, the door takes them somewhere.

```yaml
[scene]
bg: cellar
links:
  escape: {to: Alley, if: has_key}
props:
  door:  {at: 0.3, link: Cellar}              # a passage name
  gate:  {at: 0.7, link: escape}              # a links: entry — inherits its if:
  chest: {at: -0.4, link: Vault, highlight: gold}
cast:
  mira: {at: -0.2}
beats:
  - mira: {say: "Through there.", link: Cellar}   # the SPEAKER becomes clickable
  - door: {link: Hall}                            # same door, new destination
  - door: {link: ~}                               # no longer a way out
```

| Form | Means |
|---|---|
| `link: Cellar` | go to the passage `Cellar` |
| `link: escape` | that entry under `links:`, with its `if:` |
| `link: {to: Cellar, if: has_key}` | a condition of its own |
| `link: ~` | stop being clickable |

**A link is stage STATE.** Every later beat inherits it, exactly like `frame:` — which is
what makes "click the door at beat 3 for A, at beat 7 for B" an ordinary patch and not a
construct of its own. There is no beat-level `link:` key, and none is needed.

`highlight:` tunes the glow. `gold`, `danger`, `cold` and `warm` are built in, any CSS
colour works, and any other token reaches the DOM as `data-highlight` for the story's own
stylesheet — the same extension point `bubble: {as:}` and `bg: {fx:}` have.

Hovering a clickable entity glows along the sprite's own **alpha edge**, not around its
box: the renderer uses stacked `drop-shadow()` filters, which follow transparency. The
entity is also a tab stop (`role="link"`, Enter or Space follows it).

⚠️ **The hit area is still the box.** A transparent corner of the art is clickable even
though the glow traces the silhouette — the same limit the visual editor's own hit testing
has. Crop art tightly where it matters.

Clicking a linked entity navigates; clicking anywhere else on the stage still advances the
beat. In the **editor** a plain click selects the sprite as usual — following the link
would throw away the beat being staged — and the selection row grows a button that opens
the target passage.

A clickable entity is a real exit: the story map draws an arrow for it, a passage rename
follows it, a missing target gets a ghost card, and `twine-cli lint` counts it when
deciding what is reachable.

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
