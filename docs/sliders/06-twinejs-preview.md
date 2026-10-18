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
│ │   mira: {at: -0.4, pose: arms-crossed}        │ │
│ └───────────────────────────────────────────────┘ │
│ ● 1 error: unknown pose 'arms-crosed'             │  ← from 05
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
| Bigger | the dialog's own maximize |

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

## Full screen — removed 2026-10-18

Was a second size past maximize (`⛶`, `shift+f`, double click, tap-to-advance player,
corner navigator). Confusing next to the dialog's own maximize. Gone. Maximize is the big
view.

## Playback waits

- `autoAdvance: 0` honoured again: untimed `say`/`box` stops play (`beatWaitsForClick`,
  `beat-hold.ts`). Press on stage = go on. Last beat = play ends, no wait.
- Waiting = mouse-in-ring cue, bottom right of the stage, fade + spin in. Renderer's own
  (`DomRenderer.setWaitingForClick`), same in player. Editor moves it left of the error
  badge (`--sliders-wait-cue-right`).
- Play stopping does NOT re-apply the stage: a zero-duration re-apply in the same task
  killed the last beat's move (drone landed in one frame). `scene-stage.tsx`.

- Play runs on `sceneTimeline` (scene-core): same hold per beat as the player.

## Timing overlay

Debug view of the whole scene on the player's clock. `timing-overlay.tsx` + `timing-layout.ts` + `timing-scrub.ts`.

| | |
|---|---|
| Open | clock button in the scene bar (next to labels toggle), or in the beat panel's Timing heading. Esc / ✕ closes. |
| Where | docked to stage bottom-left. Width = label + 88px per beat (max: stage minus sidebar). Height = rows, max 50%, scrolls. Sidebar stays usable: retime in the beat panel, bars move live. |
| Groups | Stage (bg, camera, fx, music), each entity in cast order, Narration. |
| Rows | per kind of change: `say`, `enter`, `exit`, `move`, `scale`, `rot`, `pose`, `steps`, `flip`, `grade`. Says = bar over the beat with the words. |
| Bars | start + length in seconds. 0s = white tick (snap). |
| Beat edges | dashed = auto-advance. Double + mouse = waits for a click. Plain = timer or animation end. |
| Columns | current beat lit. Click a beat number = scrubber jumps there. |
| Click wait width | drawn as the scene's standard beat (it has no length). |
| Hover a track | pointer x = scene time → beat + seconds in. Stage draws that moment still: `stageAt` (`scene-core`) eases + lerps `move`/`scale`/`rot`/`camera`/enter-exit fade; `pose`/`flip`/`grade`/`bg`/`fx` switch at midpoint. White cursor line. |
| Hover an entity bar | same, at the bar's own beat, plus that entity's beat start + end as ghosts (opacity × 0.35, ids `__timing-ghost-from/to-<id>`). Unchanged entity = no ghosts. |
| Leave / close | stage back on the scrubber's beat. Hover never writes: overlay, selection, writes stay on `stage`. Playback snaps while hovering. |

## Test from this beat (Alt+T)

Launch Twine's Test on the passage in the preview, **standing on the beat the scrubber is
on**. Author eight lines into a scene does not click through eight lines to see it play.

| | |
|---|---|
| Key | `Alt+T` — scopes `scene-preview` and `passage-editor` (hands are in the text) |
| Beat 0 | ordinary Test, no beat sent |
| Channel | `data-sliders-start-beat` on `<tw-storydata>` (`src/util/publish.ts`) |
| Web | `#/stories/<id>/test/<pid>?beat=N` |
| Electron | same attribute, scratch file — no URL to read |
| Player | `format/src/runtime/sliders/start-beat.ts`, **one-shot**: first stage takes it |
| Lands on | last STOP before the beat (`currentStop`). Not a stop → nearest before it |
| Before first line | plays from the top, no snap — reader never stands on the opening stage |

## Out of scope

Playing the actual story (that's Twine's Play/Test). Audio. Save/load. Multi-passage flow.
This previews **one passage's scene**.
