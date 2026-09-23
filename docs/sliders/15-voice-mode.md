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
| threads | `src/voice/threads.ts` | `localStorage`. Nothing else |
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

## Threads

One conversation open at a time, out of a per-story list. New / list / restore / delete in
the panel's title bar.

| | |
|---|---|
| store | `localStorage`, key `sliders-voice-threads`, `Record<storyId, VoiceThread[]>` |
| shape | copied from `store/persistence/server/sync-record.ts` — one blob, module cache, every access in try/catch |
| caps | **20 threads/story**, 300 rows/thread. First unbounded blob in the app; the cap IS the quota defence |
| save | debounced 500 ms, plus a flush on unmount and before anything that replaces the open thread |
| never | not a `Story` prop, not synced, not on the undo stack, not exported |

**New thread** stops the mic, banks the open thread, and **rebuilds the runner** — the
`read before write` gate is per session, so a new thread must re-arm it. `clear` never did
this; wiping rows is not the same as telling the model it may write from memory.

**Deleting a story leaves its threads behind.** `deleteSyncRecord` has the same gap.

## Restoring loads the context

`seed.ts` renders the thread into ONE user turn with `turnComplete: false`, sent after
`setupComplete` and before the panel says `listening`. The model opens knowing what was
said; it does not answer it.

- **Not `sessionResumption`.** A handle resumes a session that already existed and expires
  2 h after it ended. Neither survives closing the laptop and picking the thread up on
  Tuesday.
- **Not a per-role replay.** The API is strict about turn sequences and a rejected
  `clientContent` does not error — it hangs the turn. A single narrated block has no
  sequence to get wrong.
- System rows are left out. They are our notices, not the conversation.
- The seed says the story may have moved on and to call `map`.
- Restoring while the mic is on tears the socket down and reopens it, or the model answers
  thread A inside thread B.

## Context usage

`usageMetadata.promptTokenCount` is what is in the window and the only figure that can go
DOWN. A drop is a sliding-window compaction and the panel says so — it is the one thing
that happens to a long session without anybody asking.

`contextWindowCompression: {slidingWindow: {}}` is on, so a long thread compacts instead of
dying on `goAway`.

The bar needs a denominator the API does not report. `LiveModel.contextTokens` is a
published figure copied by hand; unset means the panel shows tokens and no bar.

## Two switches

Mic and socket are separate.

| Author does | Socket | Mic |
|---|---|---|
| types a sentence | opens on demand | stays shut |
| clicks the mic | opens if needed | opens |
| clicks the mic again | stays up | track stopped, light out |
| closes the panel, new/other thread | closed | stopped |

- Box is **never disabled**. `/tool` needs no socket and no key — straight to the runner.
- Typed turns queue until `setupComplete`, sent after the thread seed. Mic audio is still
  dropped before ready: that is stale throat-clearing, a typed sentence is work.
- `listening` with the mic shut reads **"Connected, mic off"**, grey not green. Green = hot mic.
- Checkpoint pins when the SOCKET opens, not the mic — a model that can write is the risk.
- No key → yellow warning with an `Open AI preferences` link
  (`dialogs/ai-prefs-link.tsx`, shared with the asset generator's two key warnings).

## The text box is the debugger

Step 2 shipped the whole tool surface with **no audio**, driven by typed calls. That is not
a fallback — it is how a bad session is reproduced. Now it is `/read_passage Tavern Night`,
with the leading slash, and it still works unquoted when a tool has exactly one required
argument (`parseToolLine`).

Without the slash the box talks to the model, mic on or off — the prefix is the switch, not
a mode the author has to remember.

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

## Models

Ids in `live/models.ts`. Picker in the status row, pref `voiceLiveModel`, locked while the mic
is on (model fixed at setup).

| id | note |
|---|---|
| `gemini-3.8-live` | default. Rejects `thinkingConfig` (1007) |
| `gemini-3.8-live-extended-thinking` | **requires** `thinkingLevel` (1007). Ends turns `interactionStatus: IN_PROGRESS` → panel shows `working` |
| `gemini-3.1-flash-live-preview` | legacy preview |
| `gemini-2.5-flash-native-audio-preview-12-2025` | best voice, weakest tools |

- Retired id = close **1008** "not found for API version v1beta". Endpoint path is fine; the
  id is gone. Panel rewrites that reason to name the model.
- Saved pref naming a dropped id → falls back to default (`pickLiveModel`).
- Live list, truer than the docs page:
  `GET /v1beta/models?key=…` where `supportedGenerationMethods` has `bidiGenerateContent`.
- Mic audio sent as `realtimeInput.audio`. `mediaChunks` still accepted 2026-09, undocumented.
- Transcription streams a few words per frame. Client joins them: one row per side per turn,
  split at tool calls.

## Panel states

Pill + dot, coloured: listening green (pulse), speaking blue, working orange (pulse),
error red with the server reason, off grey. Theme vars only — `colors.css`.

## Not done

- No committed e2e. Verified 2026-09-23 in headless Chrome with a real key
  (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`): connect, `/map`,
  typed turn → `toolCall map` → response → spoken answer. Wiring: `live-client.test.ts`
  drives a fake `WebSocket`.
- `revs` and `checkpoint` need a server; local-only stories get an honest error.
- Threads are per browser. Nothing is written to the story, and nothing syncs.
