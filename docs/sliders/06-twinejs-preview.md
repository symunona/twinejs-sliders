# 06 — Preview (twinejs fork)

Live render of the scene under the passage text (D12). The highest-value fork feature.

## Placement

```
┌─ Edit Passage: Tavern - Arrival ──────────────────┐
│ [toolbar]                                         │
│ ┌───────────────────────────────────────────────┐ │
│ │ [scene]                                       │ │
│ │ bg: tavern/night                              │ │
│ │ cast:                                         │ │
│ │   mira: {at: -0.4, frame: arms-crossed}       │ │
│ └───────────────────────────────────────────────┘ │
│ ● 1 error: unknown frame 'arms-crosed'            │  ← from 05
├───────────────────────────────────────────────────┤
│ ▼ Preview                              ⛶  ◀ ▶ ⏸  │  ← collapsible header
│ ┌───────────────────────────────────────────────┐ │
│ │                                               │ │
│ │        [ rendered scene ]                     │ │
│ │                                               │ │
│ └───────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

| Rule | |
|---|---|
| Position | below the passage text |
| Collapsible | yes |
| Remembers | open/closed state persists across passages and sessions (prefs) |
| `⛶` | full screen |
| First open | comes up **full screen**, then remembers the docked state after |

## What it runs

`render-dom` (the shipping renderer), inside twinejs, against the **editor asset store**
(03) — not against published URLs. That is the entire reason previews work here and don't
work in stock Twine.

```
passage text → scene-schema (05, cached) → Stage
             → scene-core diff vs previous → transitions
             → render-dom.apply()
```

## Beat scrubber

| Control | Does |
|---|---|
| `◀ ▶` | step beats. Preview shows the stage **at that beat**. |
| `⏸ / ▶` | play the beat timeline at real speed |
| beat list | click a beat line in the editor → preview jumps to it |

Stepping beats is also how an author checks `mark:` points before pointing a `from:` at one.

## Rules that keep it usable

| Rule | Why |
|---|---|
| Render **partial** parses (05) | a preview that blanks on every half-typed line gets closed and never reopened |
| Debounce with the parser, 150–250 ms | not per keystroke |
| **Never remount** on edit — `apply()` a new Stage | remounting restarts animations and flashes |
| Show missing assets as labelled placeholders | not blank, not an exception |
| Fixed aspect box, letterboxed | so normalized coordinates mean something visually |
| Optional centre + floor guides | makes `at: 0` and feet-origin legible |

## Transitions in preview

Editing shows the **end state**, not the transition — otherwise every keystroke replays an
animation. Transitions play only when: stepping beats, pressing play, or hitting "replay".

## Full screen

Same component, same state, `position: fixed`. Esc exits. Keep the beat scrubber.
Also the surface the [visual editor](07-twinejs-visual-editor.md) builds on.

## Out of scope

Playing the actual story (that's Twine's Play/Test). Audio. Save/load. Multi-passage flow.
This previews **one passage's scene**.
