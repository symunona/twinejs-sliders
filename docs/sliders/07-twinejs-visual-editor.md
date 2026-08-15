# 07 — Visual editor (twinejs fork)

Drag things on the [preview](06-twinejs-preview.md), get YAML written back (D15).
Built on the preview surface. Works docked or full screen.

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
| **Change an existing scalar** (`at:`, `frame:`, `flip:`, `z:`) | locate the node with `yaml.parseDocument()`, take its `range`, **splice the text**. Minimal diff. Nothing else in the file moves. |
| **Add or remove a block** (new cast member, delete a prop) | mutate the `Document` and `toString()`. Costs some reformatting; only fires on structural edits, which are rare and deliberate. |

`yaml`'s `parseDocument()` preserves comments and formatting on round-trip — that's exactly
why it's the pick in [05](05-twinejs-parser.md). Prove the round-trip on a comment-heavy
fixture **before** building any drag handles.

## Undo

All writes go through the **CodeMirror document**, never around it. Then Twine's existing
undo works for free, and text edits and drag edits share one history stack.

Coalesce a drag into **one** undo entry — `origin` on the CM change, joined for the drag,
sealed on mouse-up. A drag that produces 60 undo steps is unusable.

## What is editable visually

| Gesture | Writes |
|---|---|
| Drag an entity | `at:` |
| Shift-drag | constrain to one axis |
| Drag from asset panel onto stage | new entry under `cast:` / `props:` |
| Drop a background | `bg:` |
| Delete key | remove the entry — or `~` if the scene has `from:` (see [02](02-sliders-format.md)) |
| `F` / context menu | `flip:` |
| Send to back / front | `layer:` (D11 — `back` / `mid` / `front`) |
| Bracket keys | `z:` nudge within a layer |
| Frame dropdown on selection | `frame:` |
| Pan / scroll-zoom the stage | `camera:` |

## What is NOT editable visually

`beats` · `links` · `from` · `mark` · `id`.

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
5. Layer / flip / frame controls.
6. Camera.

Stop after 3 if it feels wrong. Drag-to-position is 80% of the value; everything after it
is convenience.
