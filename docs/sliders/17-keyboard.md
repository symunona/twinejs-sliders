# 17 — Keyboard in the player

Read a story without a mouse. Runtime only (`format/src/runtime/sliders/`), every passage,
scene or prose.

## Keys

| key | scene running | scene over / prose |
|---|---|---|
| → | next beat | one way out → follow it. Two or more → nothing, pick first |
| ← | previous line | previous passage, opened at its **last** line |
| ↑ / ↓ | — (links still held) | move between ways out |
| Enter | — | follow the focused way out; or the only one if nothing focused |
| Shift+R | start over | same |

Modified arrows (ctrl/alt/cmd) untouched — browser history. Typing in an input untouched.

## Rules

- **Stop = `say` or `box`.** `set`, `fx`, `wait` are machinery. One ← = one line, not one beat.
- **→ never skips the ending.** Last line still needs one → to reveal the link list
  (same step a click does). Only then does → follow a single link.
- **← from the first line leaves the passage.** Scene's opening stage is not a stop —
  reader never stands on it going forward.
- **Back is a snap.** Transitions re-timed to 0. No sfx replay. No auto-advance re-armed —
  reader has the wheel.
- **Back into beats re-hides the link list** (`holdLinkListAgain`). Choices are a spoiler
  again.
- **Held links are not reachable.** `[data-pending]` filtered out of link collection.
- **Selection is DOM focus.** No highlight state. Agrees with Tab, works for screen
  readers, survives re-render.
- **Shift+R = `restart()`** — clears state, reloads. No confirm, same as the footer link.
  Needed because PLAY restores the saved trail on a plain reload, and a scene hides the
  footer (`sliders.css`, `body.sliders-cinema #page > footer`). Ctrl+Shift+R left to the
  browser.

## Passage history

`trail` is the only history. Back = pop it (same as `<error-handler>`).

`history.ts` leaves a note — `{passage, depth}` — for the passage landed in, so its scenes
open at the last beat instead of replaying. Note is never cleared; it stops matching
because any move changes name or depth.

## Files

| file | holds |
|---|---|
| `sliders/keyboard.ts` | the key table, link collection, focus moves. One `document` listener from `initSliders()`. |
| `sliders/history.ts` | trail pop + the resume-at-end note. |
| `sliders/beat-steps.ts` | pure stop math (`stopIndices`, `currentStop`, `previousStop`, `lastStop`). |
| `sliders/stage-element.ts` | `canAdvance()`, `advance()`, `stepBack()`, `showStop()`. |

Keyboard finds a stage by those three method names, not by class — an un-upgraded
`<sliders-stage>` falls through to links.

## Not covered

- Editor preview player (`packages/scene-edit`) has its own player. Mouse only still.
- No unit test mounts a real stage: root `tsconfig` does not typecheck `format/src/runtime`,
  so importing `stage-element.ts` in jest drags type errors out of Chapbook files. Stop math
  and the key table are unit tested; the drawing half was verified by hand in Chrome.
