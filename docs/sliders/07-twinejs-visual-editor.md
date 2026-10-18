# 07 — Visual editor (twinejs fork)

Drag things on the [preview](06-twinejs-preview.md), get YAML written back (D15).
Built on the preview surface. Works docked or maximized.

## The one rule

> **The text is the source of truth. Always.**

There is no separate scene model that the text is generated from. Visual edits are
**text edits**. Nothing else is coherent — the moment you keep a parallel model, hand-edited
YAML and dragged YAML disagree and one of them silently wins.

## ⚠️ The hard part: write-back without wrecking the file

Naive `parse → mutate → stringify` destroys comments, key order, quote style, and flow-vs-block
formatting. Authors will notice immediately and stop using the tool.

Two-tier strategy:

| Change | How |
|---|---|
| **Change an existing scalar** (`at:`, `pose:`, `flip:`, `z:`) | locate the node with `yaml.parseDocument()`, take its `range`, **splice the text**. Minimal diff. Nothing else in the file moves. |
| **Add or remove a block** (new cast member, delete a prop) | mutate the `Document` and `toString()`. Costs some reformatting; only fires on structural edits, which are rare and deliberate. |

`yaml`'s `parseDocument()` preserves comments and formatting on round-trip — that's exactly
why it's the pick in [05](05-twinejs-parser.md). Prove the round-trip on a comment-heavy
fixture **before** building any drag handles.

## Undo

All writes go through the **CodeMirror document**, never around it. Then Twine's existing
undo works for free, and text edits and drag edits share one history stack.

The document is the passage's registry `Doc` (`store/passage-docs`), written headless: no
passage editor needs to be open. `</>` attaches a view to the same Doc, so the history
survives opening and closing it.

Coalesce a drag into **one** undo entry — `origin` on the CM change, joined for the drag,
sealed on mouse-up. A drag that produces 60 undo steps is unusable.

## What is editable visually

| Gesture | Writes |
|---|---|
| Drag an entity | `at:` |
| Shift-drag | constrain to one axis |
| Drag a corner handle | `scale:` — uniform, about the origin, so the feet stay on the floor. Alt scales about the centre. |
| Drag the rotate dot | `rot:` — whole degrees, about the same origin. Shift snaps to 15°. |
| Drag from asset panel onto stage | new entry under `cast:` / `props:` |
| Drop a background | `bg:` |
| Delete key | remove the entry — or `~` if the scene has `from:` (see [02](02-sliders-format.md)) |
| `F` / context menu | `flip:` |
| Send to back / front | `layer:` (D11 — `back` / `mid` / `front`) |
| Bracket keys | `z:` nudge within a layer |
| Pose dropdown on selection | `pose:` |
| Pan / scroll-zoom the stage | `camera:` |

## Layout

```
┌ Scene Editor ───────────────────── 🔊 </> ⤢ ⛶ ⌄ ✕ ┐   🔊 = preview sounds, </> = open passage source
│ ‹ 1/3 › ▶ ●───●──────●  + 〰                     │   beat line, + add beat, 〰 labels
│ ┌ stage ─────────────── [− 100% + 🔒] ☺ ┐┌ ▣ ⚙ 📷 ♫ ≡ 💬 👤 🚶 🔗 ⚠ ┐│
│ │                                        ││ tab body             ││
│ └────────────────────────────────────────┘└──────────────────────┘│
└───────────────────────────────────────────────────────────────────┘
```

| Part | Notes |
|---|---|
| Beat line | prev · count · next · play · strip · `+` add beat · labels toggle (default ON). `+` and toggle pinned right, strip or not (strip hidden under 2 beats) |
| `+` add beat | menu: Narrator (`box`), characters on stage, then props. Writes `- who: ""` after the beat on screen, steps to it, beat tab, text focused |
| Stage top right | zoom, stage lock. Dark opaque pill, white icons, border on hover |
| Stage bottom right | error badge (smiley) |
| `</>` | dialog header, beside maximize. Opens passage editor on the same Doc |
| 🔊 | dialog header, left of `</>`. Only while something plays or would (Preview running, or stage sound on + scene has `music:`/`sfx:`). Click = mute / unmute stage + Preview, icon → muted. Hover "Preview sounds". Mute in sessionStorage `sliders.preview.muted`: survives dialog close + reload, not a new tab |
| Sidebar | collapsible stripe, right. Collapsed = icon column. Open + tab remembered (`sliders.preview.sidebar.*`). Click on open tab = collapse |

Sidebar tabs, top to bottom of the icon row:

| Tab | Holds |
|---|---|
| ⚙ scene | grid · then groups: Template from (`from:`, searchable passage list, `?` hover help) · Backdrop (`bg`, searchable, thumbnails) · Arrival · Editor (`locked`). Pacing + Bubbles moved to 💬 at Step 0, Music to ♫ |
| 📷 camera | camera tool (old bg lock) · Camera x / y / zoom (shown stage camera, live in a pan, inherited under `from:`; writes whole `camera:`, rest = key removed; disabled by `locked: [bg]`) · Motion (`bg` fx, loop length) · Effects (`fx`) |
| ♫ sounds | stage sound on/off (`sliders.preview.sound`) · Preview / Stop (square) · Music · Sound effect (beat only). Scope-aware. Preview = own `<audio>`, stage muted while it runs: Step 0 = scene music, beat = music in effect there + its `sfx:`. `loop: true`/section loops till Stop, rest plays once, back to Preview when all ended. Scrub = stop. Press while muted = unmute. Sound-command beat (`- sfx:`/`- music:`) or bodyless beat: note, no rows (edit in `</>`) |
| ≡ layers | layers panel |
| 💬 beat | beat panel (below). Opened by press on bubble, add beat. Scope-aware |
| 👤 / ▣ selection | only while something is selected; follows selection, back to previous tab on deselect. name, note · flip, stretch, lock, z, delete · pose · grade: title, match bg + reset grade on top, sliders (hover a slider = min/max preview) |
| 🚶 walk | walk-here toggle, walker, note · "Edit walk area" = bg asset in asset editor, walk tool |
| 🔗 links | scene `links:` editable list |
| ⚠ problems | only with errors. Error badge toggles it |

Every group heading in the sidebar has an icon (`Heading` in `scene-settings-panel.tsx`). New
pane = new tab id + `SceneSettingsPane` value.

## Scope

Scope-aware tab (`SceneSidebarTab.scope`) = edits follow the scrubber:

| Scrubber | Writes | Tab handle |
|---|---|---|
| Step 0 | scene globals: `autoAdvance:` `ease:` `bubble:` · ♫ `music:`. Fallback = story `sliders.bubble.*` | gray |
| beat N | that beat's own keys (♫: `music:` `sfx:`, `music: ~` via `setBeatKeyFormatted`). Fallback = story + scene | blue (override blue) |

Same component both ways (`BeatProps`, `scope: 'beat' \| 'scene'`) — scene globals get every
bubble row a beat has (size, align, valign…). Now: 💬 beat, ♫ sounds. New tab opts in
with `scope`.

## Beat panel

Sidebar beat tab. Opens on: press on the bubble, add beat, its tab. Closes on: its X (collapses
sidebar). Not on sprite select — caret in a beat line selects the speaker.

| Part | Writes |
|---|---|
| Text box (double click bubble = focus) | beat words: scalar, `say:` or `text:`, quote style kept. Live while typing, throttled 300ms, one undo step per burst (`+sliders-type`). Enter = write now, Shift+Enter = newline, Esc = back to text at focus. Ctrl+B `**bold**`, Ctrl+I `_italic_` toggle around selection / word at caret |
| Timing, Bubble groups | `dur:` `ease:` · `bubble:` keys on the beat. Step 0: `autoAdvance:` (no Auto box) `ease:` `bubble:` on the scene, title says "Scene defaults". Grid rows: label · control · X. X = remove beat's key (back to default). "Default: …" line under each = story + scene value, else built-in. Row highlighted when beat states a value ≠ default. Dropdowns' unset option reads `inherit`. Explained dropdown (`sizing`) pane sized to its tallest explanation: no resize on hover, no flicker. Timing `?` = hover help |
| "Make beat styles default for project" + confirm | `sliders.bubble.*` in START passage vars, beat's `as font color bg accent sizing anchor size` over existing. No `w h at tail place`. No beat, no other passage touched. Undoable. |

## What is NOT editable visually

`beats` (structure; words and beat keys are, in the beat panel) · `links` · `mark` · `id`. `from:` only as
a passage pick (no `@mark` picker; a stated `@mark` is kept and shown).

These are prose and structure. Typing them is faster than any widget, and a beat editor is a
whole second product. Selecting an entity **highlights its beat lines** in the text — that's
the connection, and it's enough.

## Snapping and guides

| Guide | |
|---|---|
| Centre line | x = 0 |
| Floor line | layer baseline — where feet land |
| Thirds | soft snap |
| Other entities | snap to their x |
| Hold Alt | disable snapping |

Coordinates are normalized (−1…1), so **round on write**: 3 decimals. `at: -0.4`, never
`at: -0.40000000000000002`.

## Selection

- Click to select. Selection is derived from the **text cursor position** too — put the
  caret inside `mira:` and mira highlights on stage. Bidirectional.
- Multi-select drags together, writing each `at:` separately.
- Selected entity shows its origin cross and bubble anchor as **read-only** markers.
  Editing anchors is the [character editor's](04-twinejs-character-editor.md) job — a
  character's anchors are global, not per-scene, and letting people drag them here would
  silently change every other scene.

## Order of work

1. Round-trip proof on a comment-heavy fixture. No UI.
2. Read-only selection + highlight, both directions.
3. Drag → `at:` write-back with undo coalescing.
4. Drop from asset panel.
5. Layer / flip / pose controls.
6. Camera.

Stop after 3 if it feels wrong. Drag-to-position is 80% of the value; everything after it
is convenience.
