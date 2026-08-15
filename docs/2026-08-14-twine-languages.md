# Twine story formats, caveman style — and the Sliders scene format

> **📦 ARCHIVE — superseded by [`docs/sliders/`](sliders/README.md).**
> Kept for the research trail and the round-1/round-2 Q&A. The live spec is split across
> `docs/sliders/01`…`07`. Don't edit this file; edit those.

**Date:** 2026-08-14 · **Rev 2** (folds in decisions + answers from round 1)
**Question:** Twine has several scripting/markup languages. Which is the best base for a
YAML-driven, copy-pasteable *scene* format (backgrounds, layers, characters, animations,
speech bubbles) that can later swap in a three.js renderer?

**Short answer:** fork **Chapbook 2.x** for the *runtime*, and fork **twinejs** for the
*authoring UI*. These are two different projects and conflating them is the main trap —
see §3 and §11.

---

## 1. The formats, caveman

Facts below were read out of `public/story-formats/*/format.js` in this repo, not from memory.

| | **Harlowe 3.3.9** | **SugarCube 2.37.3** | **Chapbook 2.3.1** | **Snowman 2.1.3** |
|---|---|---|---|---|
| Author | Leon Arnott | T. M. Edwards | Chris Klimas (made Twine) | Dan Cox |
| Size | 1.0 MB (biggest) | 623 KB | **158 KB (smallest real one)** | 176 KB |
| License | Zlib | BSD-2-Clause | **MIT** | MIT |
| Look | `(set: $x to 1)` | `<<set $x to 1>>` | `x: 1` on own line | `<% x = 1 %>` |
| Text markup | own markup | own markup + HTML | **Markdown** | **Markdown** |
| Who it's for | non-coders | game devs | writers | JS devs |
| Raw JS? | discouraged, sandboxed | **yes, everywhere** | yes, in vars + `[JavaScript]` | **yes, it IS JS** |
| Custom code API | in-language `(macro:)` only | **`Macro.add()`** | **`engine.extend()`** | just write JS |
| Save / history | good | **best in ecosystem** | good, JSON-only by design | ~none, roll your own |
| Batteries | many | very many | some | almost none |
| Learning curve | medium | steep | **shallow** | needs JS |
| Twine **editor** extensions | yes (mode, toolbar, cmds) | **none** | **yes (mode, toolbar, cmds, refs)** | **none** |

### The one-line differentiator

- **Harlowe** — pretty and safe, a walled garden. Extend it in *its* language, not JS.
- **SugarCube** — the heavy engine. Best state/save. Ugly for authors, no editor hooks.
- **Chapbook** — writer-first, front matter + Markdown, small and clean, extension-shaped.
- **Snowman** — a blank page with `window.story`, `_`, `$`. You build everything.

---

## 2. What actually matters for *our* project

Rendering a visual novel means **throwing away the text renderer**. So "which markup is
nicest" is nearly irrelevant. What we're really shopping for:

| Need | Harlowe | SugarCube | **Chapbook** | Snowman |
|---|---|---|---|---|
| Passage graph + navigation | ✅ | ✅ | ✅ | ✅ |
| State that serializes to JSON (for save + scene state) | ⚠️ custom | ⚠️ custom | **✅ enforced by design** | ❌ DIY |
| Passage = *front matter + body* already | ❌ | ❌ | **✅ native** | ❌ |
| Hook to grab **raw** passage text before markdown | ❌ | ⚠️ | **✅ `processRaw()`** | ✅ (own it) |
| Register new block syntax | ❌ | ✅ macros | **✅ modifiers** | n/a |
| Register new inline syntax | ❌ | ✅ macros | **✅ inserts** | n/a |
| Editor: syntax highlighting for our YAML | ✅ | ❌ | **✅** | ❌ |
| Editor: toolbar buttons | ✅ | ❌ | **✅** | ❌ |
| Editor: dotted lines for scene jumps | ❌ | ❌ | **✅ `parsePassageText`** | ❌ |
| Small enough to actually read the source | ❌ | ❌ | **✅** | ✅ |
| Fork-friendly license | ✅ | ✅ | ✅ | ✅ |

Chapbook wins on every row that isn't table stakes.

---

## 3. ⚠️ Answering: "is the lang enough for TwineJS interface extensions?"

**No. Not for what you described.** This is the single most important finding in rev 2.

`editorExtensions` gives a format exactly four things, and nothing else:

| Capability | What it really is |
|---|---|
| `codeMirror.mode()` | a CodeMirror **5** syntax mode |
| `codeMirror.toolbar()` | a strip of **buttons / dropdown menus / separators**. That's the whole vocabulary. |
| `codeMirror.commands` | functions installed into `CodeMirror.commands[…]`, called with **`editor` only** |
| `references.parsePassageText(text)` | one passage's text → array of passage names |

Verified in `src/store/use-format-codemirror-toolbar.ts:72` — commands are stored as raw
functions and invoked by CodeMirror with just the editor instance.

So a story format **can**:

- ✅ highlight our scene YAML
- ✅ put an "Insert character" button in the passage toolbar
- ✅ insert/transform text at the cursor
- ✅ draw scene-jump lines on the story map

A story format **cannot**:

- ❌ open a panel, dialog, or side pane
- ❌ read or write anything outside the current passage's text — no story data, no other
  passages, **no cross-passage scene index**
- ❌ store anything (no asset library, no uploads)
- ❌ show image previews or thumbnails
- ❌ add a route, a tab, a library screen, or a context menu

Your asset manager, character editor, upload flow, tagging/filtering, and duplicate-scene
detection are **all in the second column**. None of them can ship inside a story format.

### The split this forces

```
sliders-format/   (fork of Chapbook)      → runtime + the 4 editorExtensions.
                                            Works in STOCK Twine. Degraded but playable.
twinejs-sliders/  (this repo)             → asset manager, character editor, scene index
                                            panel, uploads, previews, publish pipeline.
```

Design rule that falls out: **the format must never depend on the fork.** A story authored
in Sliders-Twine should still run in stock Twine — you just lose the nice authoring UI.
That keeps the two repos honestly decoupled and keeps your work shareable.

---

## 4. Answering: "can we do native syntax highlighting?"

**Yes**, with one real constraint.

Twine uses **CodeMirror 5.65** (`package.json`), not CM6. So the mode is a classic
streaming tokenizer: `startState()` + `token(stream, state)`.

The constraint, from `EXTENDING.md` verbatim:

> You must use CodeMirror's built-in tokens. Twine contains styling for these tokens that
> will adapt to the user-selected theme.

You **cannot** define custom token names or colours. You must map our concepts onto CM5's
default theme tokens. Proposed mapping:

| Scene concept | CM5 token |
|---|---|
| top-level keys (`bg`, `cast`, `beats`) | `keyword` |
| character / asset ids | `def` |
| `[[links]]` | `link` |
| numbers, coordinates | `number` |
| strings / dialogue text | `string` |
| `true` / `false` / `~` | `atom` |
| `#` comments | `comment` |
| unknown key (lint) | `error` |

This is genuinely good news: dialogue as `string` and ids as `def` gives a readable scene
block for free, in both light and dark themes.

---

## 5. The seams Chapbook gives us

**Vars section** — parsed with `varsSep: /^--$/m`. A line that is exactly `--` splits front
matter from body. Each line is `name: <JavaScript expression>`, optionally
`name (condition): value`.

> ⚠️ **It is not YAML and it is flat.** No nesting, no lists. The layer tree cannot live
> there. Don't fight it — use a modifier block (§7).

**Custom block syntax** (our scene hook):

```js
engine.extend('2.0.0', () => {
  engine.template.modifiers.add({
    match: /^scene$/i,
    // processRaw sees author text BEFORE inserts/links/Markdown touch it.
    processRaw(output, {state, invocation}) { /* output.text is our YAML */ }
  });
});
```

**Built-in modifiers we inherit for free** (from the bundled `format.js`):
`[note]` / `[todo]` / `[fixme]` (→ our director's notes), `[continued]`, `[if]` / `[else]` /
`[unless]`, `[after 2s]`, `[align]`, `[CSS]`, `[JavaScript]`, `[ambient sound]`,
`[sound effect]`, `[embed image]`, `[embed youtube]`.

**Audio is already solved.** `[ambient sound]` and `[sound effect]` exist and work. Don't
build audio in v1 — spend the time on the differ.

**Not solved:** `config.style.backdrop` is a background **colour** only (`--backdrop-color`).
No format has any layer or sprite concept. We build that from zero regardless.

---

## 6. Decisions locked in round 1

| # | Decision |
|---|---|
| D1 | **Sliders = a Chapbook fork.** Track upstream. |
| D2 | **Speech bubbles are DOM**, positioned from character anchors, in every renderer. |
| D3 | **Wiki-style navigation.** Links carry extra props. Links inside bubbles render as real links. |
| D4 | **YAML 1.2** (kills the Norway problem). A restricted subset. **Bundle size is not a constraint.** |
| D5 | Characters hold **named frames** — png / gif / webp. Animation = an animated file, not a timeline. |
| D6 | Users **upload** files to create frames; characters reference them. |
| D7 | Asset manager shows backgrounds + objects + **characters as collections**; character frames hidden by default. Tag / group / filter. |
| D8 | **Separate character editor**, opened by clicking a character in the asset manager. Tabs per character. |

---

## 7. Answering: "other alternatives to YAML? can't avoid full YAML for layers?"

### You *can* avoid full YAML — but that's no longer the interesting question

Our maximum nesting depth is **three**, and level three is only scalars or flow sequences:

```yaml
cast:                    # 1: block map
  mira:                  # 2: block map
    at: [-0.4, 0]        # 3: scalar / flow seq  ← the deepest we ever go
```

No anchors, no aliases, no tags, no multi-doc, no nested flow collections. So a hand-written
parser is very achievable (~400 lines). But since **you said bundle size doesn't matter**,
the original argument for writing one collapses. Better plan:

> **Parse with the `yaml` npm package in YAML-1.2 mode, then validate against a strict
> schema layer that rejects everything outside our subset.**

You get: no parser to maintain, YAML 1.2 semantics (`no` is a string, not `false`), good
line/column errors from the parser, *and* precise domain errors from the schema layer
("unknown key `char` — did you mean `cast`?"). The CM5 mode highlights the subset; if it
ever drifts from the parser the damage is cosmetic, never semantic.

### Alternatives considered

| Format | Fit | Verdict |
|---|---|---|
| **YAML 1.2 subset** | nesting natural, flow style `{a: 1}` is compact, universally known | ✅ **pick this** |
| **KDL** | `character "mira" at=-0.4 frame="arms"` — genuinely the best *technical* fit for scene graphs | ❌ nobody can Google their syntax error |
| **TOML** | arrays-of-tables for `cast` are miserable | ❌ |
| **JSON5 / JSONC** | braces and quotes everywhere | ❌ hostile to writers |
| **Custom indent DSL** | best errors, total control | ❌ authors get zero external docs |

YAML wins on the boring reason that matters most: **your authors already know it, and every
editor on earth highlights it.**

### The subset, explicitly

**Allowed:** block maps, block sequences, flow maps `{}` and flow seqs `[]` (one level,
scalars only), `|` block scalars for long dialogue, `#` comments, and scalars of type
number / `true` / `false` / `~` / string.
**Rejected by the schema layer:** anchors `&`, aliases `*`, tags `!!`, multi-doc `---`,
`>` folded scalars, nested flow collections, non-string keys.

---

## 8. The scene format

### The design decision everything hangs off

**Copy-pasteable** forces declarative over imperative:

- ❌ **Imperative** (`show mira; move mira left; hide joren`) — a pasted block behaves
  differently depending on what ran before. This is how most VN engines work, and it's why
  their scripts can't be refactored.
- ✅ **Declarative snapshot** — the block states the **complete stage**. The engine **diffs**
  it against the previous stage and *derives* the transitions.

Paste a block anywhere, the stage ends up identical. React-vs-jQuery, applied to a stage.

### The base form

```yaml
[scene]
id: tavern-night              # globally unique. Required if anything refers to it.
bg: tavern/night              # asset id, never a path
camera: {at: [0, 0], zoom: 1} # optional; the 3D hook lives here

cast:
  mira:  {at: -0.4, frame: arms-crossed}
  joren: {at: 0.35, frame: idle, flip: true, layer: far}

props:
  candle: {at: [0.1, -0.2], layer: near}
  table:  {at: 0}

fx: [rain@0.6]

beats:
  - mira: "You shouldn't have come back."
  - joren: "And yet."
  - mira: {frame: angry, at: -0.25, say: "Get out."}
  - wait: 0.5
  - box: "The candle gutters."
  - mira: "Will you [[stay]] or [[go]]?"

links:
  stay: {to: Tavern Fight, if: has_weapon, icon: sword}
  go:   {to: Street, transition: fade}
```

### Rules

| Thing | Rule |
|---|---|
| `at: -0.4` | bare number = x only; y snaps to the layer's baseline |
| `at: [x, y]` | explicit. **Origin = screen centre. x −1…+1 = edges. y is UP.** |
| Units | normalized, not pixels — resolution-independent, maps to a 3D camera plane |
| Character origin | its **feet**, so `at: 0` = "standing centre", not "floating centre" |
| `frame:` | names an entry in the character's `frames` map (D5) |
| `layer:` | optional. Default layer per kind; z within a layer derives from y |
| Layer names | declared **once** story-wide (`bg, far, mid, near, fx, ui`) |
| `- mira: "…"` | shorthand beat: character speaks, bubble at their `bubble` anchor |
| `- box: "…"` | narration box, no speaker |
| `[[stay]]` | wiki link. Bare name → looked up in `links:`. `[[stay -> Street]]` inline shorthand. |
| Absent = gone | in a scene **without** `from:`, anyone missing from `cast` auto-exits |
| Changed = tween | position / frame deltas become transitions automatically |

**Dropped from rev 1:** `face:`. You said whole-character renders, not composited faces —
so one `frame:` axis, no face layer. Add a `slots:` mechanism later if compositing is ever
wanted; the scene YAML won't have to change.

### Links carry props (D3)

Two forms, both found by `parsePassageText` so the story map draws lines either way:

- Inline, no props: `[[stay -> Tavern Fight]]`
- Named, with props: `[[stay]]` in the text + an entry in the `links:` map

Because bubbles are DOM (D2), a link inside bubble text is just an `<a>` inside a `<div>`.
It gets hover, focus, keyboard nav, and screen-reader support **for free**. This is the
first place D2 pays for itself.

---

## 9. Scene identity, reuse and branching — the ideation you asked for

Your four wants, restated: name scenes uniquely → global index with dupe errors → reuse a
scene from the next passage by reference → have a start-state / end-state you can branch off.

That's **prototype + instance override**, i.e. Unity prefabs or CSS classes. Here's the model.

### Every scene compiles to a *sequence of states*

```
S₀ (enter) ─beat1→ S₁ ─beat2→ S₂ … ─beatN→ Sₙ (exit)
```

`enter` and `exit` are your "start-state" and "end-state" — they're **derived**, not
authored. That's the key move: you never hand-maintain them, so they can't drift.

### Referring to a state

| Reference | Means |
|---|---|
| `tavern-night` | that scene's **exit** state (the default, and what continuation wants) |
| `tavern-night@enter` | its state at beat 0 |
| `tavern-night@tense` | its state at the beat marked `tense` |

Marks are just named beats — one extra beat type, and they cost nothing:

```yaml
beats:
  - mira: "You shouldn't have come back."
  - mark: tense                              # ← a referenceable state
  - mira: {frame: angry, say: "Get out."}
```

### Continuing and branching

`from:` is just another scene key — no new bracket grammar needed:

```yaml
[scene]
id: tavern-fight
from: tavern-night@tense     # seed the stage from that state
cast:
  mira: {frame: angry}       # delta only — merged over what was inherited
beats:
  - mira: "Then draw."
```

**Merge semantics flip based on `from:` — this is the one rule to memorise:**

| | no `from:` (snapshot) | with `from:` (patch) |
|---|---|---|
| key absent | **removed** from stage | **inherited** unchanged |
| `mira: {frame: angry}` | full definition | shallow-merged onto inherited `mira` |
| `mira: ~` | n/a | **explicitly removed** |
| `cast: !only {…}` | n/a | replace the whole cast (escape hatch) |

### The property that makes this safe

> **`from:` resolves by name, never by "the passage the player came from."**

So a passage renders identically no matter which path reached it. Copy-paste still works —
a patch scene isn't self-contained, but it *declares its own base by name*, which is a
world away from depending on runtime history. Determinism is preserved; the story map stays
honest; and the differ has a single well-defined "previous stage" to work against.

### Decision points force passages — for free

A scene's links are its exit. Links go to passages. So the moment you branch, you have
passages — no special rule needed. The idiom becomes:

```
Tavern - Arrival     [scene] id: tavern-night          … [[stay]] [[go]]
Tavern - Fight       [scene] id: tavern-fight   from: tavern-night@tense
Street               [scene] id: street         from: tavern-night
```

And the fork can offer a **"Branch this scene"** command that creates N passages each
pre-seeded with `from: <current id>`. High value, cheap to build, pure fork territory.

### Validating the global index — three tiers

Because a story format only ever sees one passage (§3), validation has to be layered:

| Tier | Where | Catches |
|---|---|---|
| 1 | CM5 mode + schema, live in the passage editor | syntax, unknown keys, bad coordinates |
| 2 | **Scene Index panel — twinejs fork** | **duplicate `id:`**, unknown `from:` target, unknown `@mark`, `from:` cycles, orphan scenes |
| 3 | Chapbook fork at boot — engine sees all passages | same as tier 2, surfaced in Chapbook's existing `<warning-list>` / Backstage |

Tier 3 matters more than it looks: it's the safety net that still fires in **stock Twine**,
which is what keeps §3's decoupling rule real rather than aspirational.

`from:` edges must form a **DAG**. Cycle → error, both tiers.

### Open sub-question

Should `from:` also draw a line on the story map (via `parsePassageText`)? It's a real
dependency and seeing it would help. But it's a *scene* edge, not a *navigation* edge, and
mixing the two could make the map lie. Leaning: yes, but only as a Twine **reference**
(dotted line), which is exactly what references were built for.

---

## 10. Characters and assets

### Character manifest (revised for D5/D6)

```yaml
# characters/mira.yaml
id: mira
name: Mira
size: {w: 512, h: 1024}       # uniform for now, per-frame later
origin: {x: 0.5, y: 1.0}      # feet, as a fraction of the frame
anchors:                       # fractions -> resolution independent,
  bubble: {x: 0.62, y: 0.18}   # and in 3D these become named sockets/bones
  mouth:  {x: 0.50, y: 0.22}
frames:
  idle:         {asset: a_8f21}                   # animated .webp
  arms-crossed: {asset: a_3c09}
  angry:        {asset: a_77b2}
  wave:         {asset: a_5d14, loop: false}
tags: [tavern, main-cast]
```

**Animation = an animated file** (gif / animated webp / apng). No sprite sheets, no
timelines, no frame scheduler in v1. This is the correct caveman call: it removes an entire
subsystem, and artists can already produce these. A timeline can be added later behind the
same `frames:` key.

Anchors and origins as **frame fractions** is the extensibility hinge: uniform sizes today,
per-frame sizes tomorrow, 3D sockets after that — the scene YAML never changes.

### ⚠️ Where do the asset bytes actually live?

This is unresolved and it will bite. Twine's whole model is *one self-contained HTML file*;
a VN is tens of megabytes of sprites. Chapbook's own docs are blunt about the consequence:

> Assets won't display correctly during testing within the editor.

Chapbook deliberately abandoned Twine 1's base64 embedding (33% size overhead, and nothing
plays until everything downloads). Proposed model:

| Layer | Holds | Notes |
|---|---|---|
| **Passage text** | asset **ids** only (`a_8f21`), never paths | keeps scenes portable and diffable |
| **Editor asset library** (fork) | actual blobs — IndexedDB, or a project folder under Electron | this is what makes previews work, which is the whole point of the asset manager |
| **Generated manifest** | id → relative URL, written into a `StoryAssets` passage on publish | the runtime resolves ids through this |
| **Publish output** | `story.html` + `assets/` | optional "inline assets under N KB as data URI" toggle |

Two consequences worth stating now:

1. The asset library **must be a separate store from story text** — story text goes through
   undo, archive, and import/export, and you do not want 40 MB of sprites riding along.
2. Because passages only ever hold ids, a story still *opens* in stock Twine — it just
   renders placeholders. Consistent with §3.

### Asset manager UX (D7/D8)

```
┌─ Assets ───────────────────────────────────────────────┐
│ [Backgrounds] [Objects] [Characters] [FX]   🔍 tag ▾   │
├────────────────────────────────────────────────────────┤
│  ▢ tavern/night   ▢ street/dusk   ▢ candle   ▢ table   │
│  ◈ Mira (7 frames)   ◈ Joren (4 frames)                │  ← collections, frames collapsed
└────────────────────────────────────────────────────────┘
        click ◈ Mira  →  Character Editor (tab per character)
```

- Character frames are hidden from the flat list by default; characters appear as
  collections. ✅ D7
- Every tile is **copy-pasteable** — copying yields the YAML fragment
  (`mira: {at: 0, frame: idle}`), not just an id. That closes the loop with the scene
  format and is the feature that will actually get used daily.
- Character editor is where anchors get set — and it should let you **drag the bubble
  anchor** on a live preview. Anchors are the one thing authors cannot sanely type by hand.

---

## 11. Architecture

> **The renderer is not a Twine thing.** It's a standalone package with zero Twine imports,
> driven by a plain `Stage` object. The story format is a thin *adapter*.

Get that boundary right and "which story format" becomes a ~200-line, reversible decision.

```
packages/
  scene-schema/    YAML 1.2 -> Stage AST. Subset validation + friendly errors.
                   Shared by runtime, format, AND fork — one source of truth.
  scene-core/      Stage model, the differ, marks, from: resolution, beat timeline.
                   NO DOM. Fully testable.
  scene-index/     Global scene graph: ids, from: edges, cycle + dupe detection.
                   Used by fork (tier 2) and runtime (tier 3).
  asset-registry/  ids -> assets. Manifest, preload, resolution variants.
  cast-registry/   characters: frames, anchors, origins, tags.
  render-dom/      Renderer #1. CSS transforms + <img>. Ship this.
  render-three/    Renderer #2. Later. Same interface.
  ui-dialogue/     Bubbles + boxes + links. DOM in every renderer.
  format-adapter/  Chapbook `modifiers.add` glue + state sync.
  editor-ext/      CM5 mode, toolbar, parsePassageText.   → ships in sliders-format
  twine-ui/        asset manager, character editor, scene index panel. → ships in the fork
```

`scene-schema`, `scene-core`, and `scene-index` are consumed by **both** repos. Publish them
as real packages from day one, or the fork and the format will drift within a month.

### The renderer contract

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
anchor landed. In 2D that's a transform; in three.js it's a camera projection of a socket.
If `scene-core` computed bubble positions itself, the 3D renderer could never be correct.
Decide this now, not after `render-dom` ships.

### State and save

Keep the `Stage` snapshot in Chapbook's variable store — it rides along with save/load for
free, and Chapbook 2.0 deliberately forces all state to be JSON-serializable, which is
exactly the constraint we want. Store the **snapshot**, never renderer objects.

---

## 12. Build order

1. **`scene-schema` + `scene-core` + `scene-index`, headless.** Parse, diff two stages,
   resolve `from:` and marks, assert the derived transition list, detect dupes and cycles.
   Pure unit tests, no browser. **If the differ is right, the rest is drawing.**
2. **`render-dom` + a plain HTML harness.** No Twine at all. Fastest iteration loop you'll
   get on this project.
3. **Fork Chapbook** → `sliders-format`. Add the `[scene]` modifier, wire the adapter, wire
   tier-3 validation into `<warning-list>`. First playable.
4. **`editor-ext`**: CM5 mode, then `parsePassageText`. Cheap, and it's the moment the thing
   feels native.
5. **Fork UI**: asset manager → character editor (with draggable anchors) → scene index
   panel. This is the biggest chunk of work; it is also what makes the tool *yours*.
6. **`render-three`** only once the `Renderer` interface has survived real authoring.

Note the ordering consequence: steps 1–4 produce something that runs in **stock Twine**.
Step 5 is pure quality-of-life on top. That's a good place to be if you ever want other
people to use this.

---

## 13. Still open

- **`from:` on the story map** — dotted reference line, or would it make the map lie? (§9)
> like from: but maybe I'd color code passage nodes with the same scenes from hash or actually use faded bg image from screen if available

- **Beat granularity vs. save granularity.** One passage of 12 beats = one save point. If a
  player quits mid-conversation, do they resume at the beat or the passage? Beat-level
  resume means the beat index goes in state (cheap) — but then `from:` targets could
  reasonably point at *any* beat, not just marks. Do we want that?
> not important, simplest.

- **Layer set: fixed or author-defined?** Fixed (`bg far mid near fx ui`) is simpler and
  makes `layer:` optional almost always. Author-defined is more flexible and immediately
  more error-prone. Leaning fixed, with an escape hatch of explicit numeric `z:`.
> like 3 layer base for now with fixed order. 

- **Preview inside the editor.** Does the passage editor get a live scene preview? It's the
  single highest-value fork feature and also the most work — it needs `render-dom` running
  inside twinejs against the editor's asset library. Worth scheduling deliberately rather
  than letting it happen by accident.
> Yes. Unfortunately we need a number of things:
>  - parser & error indication if the parsing is wrong in the editor, real time
>  - preview screen: I imagine below the text, collapsible, remember when opened, when clicked, first preview comes up covering full screen. 

- **Upstream tracking.** How often do we rebase on Chapbook, and do we upstream anything?
  A `[scene]` modifier is plausibly interesting to Klimas; the fork's UI is not.

> no, I am okay to publish this though as a fork, don't think they'd be interested in an AI gen fork though.
> fork, publish public github with MIT, but do not pr.

> Assets: want it to work both in electron AND on web.
> I imagine that we should convert all images to high quality webp on upload.
> wanna be able to sync down whole package to the viewer, later want to use in webapp URLs - so making it a proper player, or maybe even wrap it into capacitor or something as native app with webview. Later, not now.

> design editor, preview and full screen!

---

## Sources

- `EXTENDING.md`, `package.json`, `src/store/use-format-codemirror-toolbar.ts`,
  `public/story-formats/*/format.js` (this repo)
- [Chapbook: Adding Custom Inserts](https://klembot.github.io/chapbook/guide/advanced/adding-custom-inserts.html)
- [Chapbook: Adding Custom Modifiers](https://klembot.github.io/chapbook/guide/en/advanced/adding-custom-modifiers.html)
- [Chapbook: Publishing Models](https://klembot.github.io/chapbook/guide/en/multimedia/publishing-models.html)
- [Chapbook guide](https://klembot.github.io/chapbook/guide/en/) · [repo](https://github.com/klembot/chapbook)
- [SugarCube macro system](https://deepwiki.com/tmedwards/sugarcube-2/4.3-macro-system) · [Twine Cookbook: SugarCube](https://twinery.org/cookbook/addingfunctionality/sugarcube/sugarcube_adding_functionality.html)
- [Twine 2 story format specs](https://github.com/iftechfoundation/twine-specs)
