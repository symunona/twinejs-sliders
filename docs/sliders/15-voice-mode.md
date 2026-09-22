# 15 — Voice mode

Author talks. Model edits. Model has **eyes**.

Shipped 2026-09-22 from [`../2026-09-22-plan-voice-mode.md`](../2026-09-22-plan-voice-mode.md).

## Shape

```
story-edit route
  VoiceModeDialog ── WebSocket ─> generativelanguage…BidiGenerateContent
    mic 16k PCM16 ──>                       <── 24k PCM16 speech
    inline image  ──>   (scene screenshot)
    toolCall      <──                       ──> toolResponse
        │
        └─> runner ─> undoable dispatch ─> story store ─> autosave ─> rev
```

| Layer | File | Knows about |
|---|---|---|
| tools | `src/voice/tools.ts` | nothing. 22 declarations, provider-neutral |
| runner | `src/voice/runner.ts` | `VoiceToolEnv` only. No React, no socket |
| env | `src/voice/use-voice-tool-env.ts` | the editor's contexts |
| session | `src/voice/use-voice-session.ts` | transcript, undo |
| socket | `src/voice/live/live-client.ts` | **the only file that knows Gemini exists** |
| eyes | `src/voice/screenshot/` | `html-to-image`, offscreen `<SceneStage>` |
| map | `packages/story-map` | nothing. Shared with `twine-cli` |

Swap providers = replace `live/live-client.ts` + `live/protocol.ts`. No test moves.

## Rules

| Rule | Where | Why |
|---|---|---|
| Write goes through **undoable dispatch**, always | `use-voice-tool-env.ts` | Ctrl-Z reaches a voice edit like a typed one. The only real guarantee. |
| `write_passage` refused until `read_passage` of that ref **this session** | `runner.ts`, `seen` | A write over unseen text is a guess. Model says "done" either way. |
| `link` gated the same way | `runner.ts` | It appends to the text. |
| Results are ok/err + counts, **never the new body** | `runner.ts` | A model handed the passage back reads the story aloud. |
| `patch_scene` / `set_beat` splice per key | `scene-patch.ts` → `@sliders/scene-edit` | Author's comments, key order and flow maps survive. |
| `patch_scene` refuses `beats:` | `scene-patch.ts` | Whole-list rewrite is the reserialisation this avoids. Use `set_beat`. |
| One screenshot per turn | `runner.ts`, `endTurn()` | Two views of one stage → model narrates the difference. |
| `goto` before every edit | system instruction | An edit the author did not watch land is an argument later. |
| Wake gate | system instruction | Prompt rule, **not a guarantee**. Undo is the guarantee. |
| Mic off = `track.stop()` | `live/audio.ts` | Hardware light out. An author cannot verify a flag. |
| Checkpoint pinned when the **mic opens** | `voice-mode-dialog.tsx` | Typing three tool calls needs no pin. Talking does. |

**No `restore` tool.** Restoring is the author's button. **No story-level tools** — no
`update_story`, no stylesheet. Voice is for storylines.

## Tools

Read: `map` `read_passage` `read_scene` `lint` `graph` `list_assets` `find_asset`
`screenshot_scene` `revs`
Write: `write_passage` `create_passage` `delete_passage` `rename_passage` `tag_passage`
`patch_scene` `set_beat` `link` `find_replace`
UI: `goto` `open_preview` `open_passage_editor` `highlight` `checkpoint`

Schemas are `tools.ts`. It is the spec.

## The text box is the debugger

Step 2 shipped the whole tool surface with **no audio**, driven by typed calls. That is not
a fallback — it is how a bad session is reproduced. `read_passage Tavern Night` works
unquoted when a tool has exactly one required argument (`parseToolLine`).

With the socket up, the same box talks **to the model** instead. Which one the author wants
is exactly whether the mic is on.

## Eyes

`screenshot_scene(ref, beat?)` mounts an ordinary `<SceneStage>` **offscreen** — same
component, resolver, stylesheet and beat runner the author sees. A second simplified
renderer would drift and the model would describe a picture nobody else can see.

- Offscreen (`left: -20000px`), never `display: none` — a node with no layout rasterises to
  nothing.
- Waits `img.decode()` + `document.fonts.ready`, then one frame.
- `html-to-image` → canvas → 768px long edge, PNG.
- Rides its **own user turn**, after the tool response. A `functionResponse` is JSON; an
  image there is base64 the model reads as text.

Beat N is state **N+1** — `stateForBeat`. States are S0..Sn and S0 is the stage before
anything ran.

## Audio

| | |
|---|---|
| in | 16 kHz mono PCM16, `ScriptProcessorNode`, nearest-neighbour resample |
| out | 24 kHz mono PCM16, scheduled gapless against `AudioContext.currentTime` |
| barge-in | `interrupted` frame → drop every queued source |
| AEC | requested, **and** the panel says wear headphones — AEC on laptop speakers is best-effort |

Model ids in `live/models.ts`, next to `generatorModels`. Half-cascade by default: native
audio sounds better and calls functions worse, and this is a tool-calling app.

## Not done

- No e2e. Audio and rasterising are both unprovable under jest; verified by hand in Chrome.
- `revs` and `checkpoint` need a server; local-only stories get an honest error.
- Transcript is memory-only, capped at 300 rows. Nothing is written to the story.
