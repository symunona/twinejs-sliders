# Voice mode — Gemini Live edits the story

Status: planned. 2026-09-22. Supersedes the sketch in `docs/sliders/plans/`.

Author talks. Model edits. Model has **eyes**: it can look at the rendered scene.

Tool surface copied from `twine-cli` (spec 12) — `map`, `cat`, `put`, `lint` is already an
agent-shaped command set. Runs in the editor, not the CLI: the author must watch the edit
land.

Depends on rev labels from [`2026-09-22-plan-history-enrichment.md`](2026-09-22-plan-history-enrichment.md).

## 0 — Version tracking, what exists

| Layer | Where | Gives |
|---|---|---|
| `rev` | `server/store/story.go`, `meta.json` | monotonic per story, ETag / `If-Match` |
| snapshot | `revs/000042.json.gz` + `.assets.gz` | body + manifest at a rev, only when body hash changed, pruned past `REV_KEEP`=20 |
| restore | `POST /stories/{id}/restore` | ordinary write; bumps rev, records `restoredFrom`, returns `missingAssets` |
| undo | `src/store/undoable-stories` | local, per session, cleared on pull |

Voice session **auto-pins a checkpoint on start**: `before voice session, 10:12`. That is
the escape hatch, and the reason pinning ships first.

## 1 — Shape

```
story-edit route
  VoiceMode ── WebSocket ─> generativelanguage…BidiGenerateContent
    mic 16k PCM16 ──>                       <── 24k PCM16 speech
    inline image  ──>   (scene screenshot)
    toolCall      <──                       ──> toolResponse
        │
        └─> tool runner ─> undoable dispatch ─> story store ─> autosave ─> rev
```

Key from `prefs.geminiApiKey`, same as the asset generator
(`src/dialogs/asset-generator/models.ts`). Live-capable flash, half-cascade — native audio
sounds better, function calling is weaker, and this is a tool-calling app. Model ids move;
keep them in one config next to `generatorModels`.

One adapter module owns the protocol. Nothing else knows Gemini exists.

## 2 — Interactive, not push to talk

Open mic. Server-side VAD. Barge-in: author talks over the model, model stops.

- `getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}})` — without AEC
  the model hears its own speech through the speakers and answers itself. Headphones are
  the reliable answer; say so in the tooltip.
- Toggle **off** = socket closed, mic track stopped, hardware light out. No hot mic idle.
- Wake gate: the model is instructed to act only on a turn addressed to it. Room chatter
  is not an instruction. This is a prompt rule, not a guarantee — undo is the guarantee.

### The toggle

`src/routes/story-edit/toolbar/story-edit-toolbar.tsx`, `pinnedControls`, **left of
`<ZoomButtons/>`**:

```tsx
pinnedControls={
  <>
    <VoiceModeButton story={story} />
    <ZoomButtons story={story} />
    <UndoRedoButtons />
  </>
}
```

States: off · connecting · listening · model speaking · working (tool running) · error.
One button, colour + icon, live region for screen readers.

## 3 — Show the work

The model drives the UI, not just the data. Rules:

- Before any edit: `goto(ref)` — select the passage, scroll it into view.
- Editing a scene → **preview opens**. `ScenePreviewDialog` already exists and is
  once-per-story (`src/dialogs/scene-preview/scene-preview-dialog.tsx`); the tool dispatches
  the same dialog action the author's own gesture does.
- Beat touched → preview stands on that beat (`beat-timeline.tsx`,
  `use-active-beat-mark.ts` lights the source lines).
- Transcript panel: one row per turn, one row per tool call, with the undo affordance.
  Rows are the audit trail — voice leaves nothing else behind.

## 4 — Eyes

The model asks to see the scene. It gets a picture of the real preview at a real beat.

```
screenshot_scene(ref, beat?) -> {image: png, width, height, beat}
```

Mechanics:

1. Preview mounts the scene (hidden offscreen host if the dialog is closed — same
   `ScenePreview` component, same resolver, same stylesheet).
2. Stand on `beat` via the existing beat runner (`packages/scene-core/src/run-beats.ts`).
3. Wait for `img.decode()` on every asset in the stage, and `document.fonts.ready`.
4. Rasterise the stage node. `html-to-image` class of library — the stage is DOM
   (`packages/render-dom/src/dom-renderer.ts`), there is no canvas renderer to reuse, and
   writing one is a bigger job than this whole feature.
5. Downscale to ~768 px on the long edge, PNG. Send as an inline image part.

Risks, stated: web fonts and CSS bubble shapes must inline or the picture lies. Assets are
same-origin blobs from OPFS, so no canvas tainting. Cap: one screenshot per model turn,
and never automatic — the model must ask.

## 5 — Tools

Read is free. Write goes through **undoable dispatch**, always. Responses are small —
ok/err and counts, never the new body.

### Read

| Tool | Args | Returns |
|---|---|---|
| `map` | — | story map: passages, line counts, scene ids, links, cast, assets, lint count |
| `read_passage` | `ref` | text, `name`, tags, scene block start line |
| `read_scene` | `sceneId` | parsed scene: beats, cast, bg, marks |
| `lint` | `ref?` | errors + warnings, file:line |
| `graph` | `from?, depth?` | link graph as edges |
| `list_assets` | `sceneId?` | ids, names, kinds, which scene uses them |
| `find_asset` | `q` | matches with ids |
| `screenshot_scene` | `ref, beat?` | picture (§4) |

`map` is the context. Never paste the story. Refresh and resend after every mutation.
Rendering lives in `packages/twine-cli/src/cmd/map.ts` today, bound to node + disk — pull
the pure part into `packages/story-map` over `(story, manifest)` so CLI and panel print the
same thing.

### Write

| Tool | Args | Notes |
|---|---|---|
| `write_passage` | `ref, text` | whole passage. Requires a `read_passage` of that ref this session — the runner rejects a blind write |
| `create_passage` | `name, text?, at?` | `at` optional, else auto-placed |
| `delete_passage` | `ref` | undoable like any other |
| `rename_passage` | `ref, name` | rewrites inbound links, same as the UI does |
| `tag_passage` | `ref, add[], remove[]` | |
| `patch_scene` | `sceneId, yaml` | through `packages/scene-edit/src/write.ts` — surgical, keeps the author's formatting, does not reserialise the block |
| `set_beat` | `sceneId, beat, patch` | one beat, same writer |
| `link` | `from, to` | inserts a link, creates the target passage when missing |
| `find_replace` | `q, with, scope?` | existing action creator |

Story-level (`update_story`, format, stylesheet) is **out**. Voice is for storylines.

### UI

| Tool | Args | Does |
|---|---|---|
| `goto` | `ref` | select + scroll. Mandatory before an edit |
| `open_preview` | `ref, beat?` | scene preview dialog, standing on a beat |
| `open_passage_editor` | `ref` | when the author should type |
| `highlight` | `refs[]` | map highlight, for "these three are orphans" |

### History

| Tool | Args | Does |
|---|---|---|
| `checkpoint` | `label` | pin current rev (history-enrichment §1) |
| `revs` | — | recent revs with labels |

`restore` is **not** a tool. Restoring is the author's button, not something a microphone
does.

## 6 — Order

1. `packages/story-map` extracted. CLI still green.
2. Tool runner + every tool, driven by **typed text** in the panel. No audio. Jest.
3. Live socket adapter, open mic, VAD, barge-in, toolbar toggle, transcript.
4. `screenshot_scene` — offscreen mount, beat stand, rasterise, inline image part.

Steps 1–2 are the value; audio and eyes are the last mile. Rev labels + pinning ship from
the history ticket before step 3 goes live.
