# Architecture — what the code cannot tell you

Invariants that span the whole app. Everything here is a DECISION, not a description.
Anything you can read off a file is deliberately not here.

## One source of truth, three consumers

`packages/*` is consumed **as TS source** via path aliases (Vite + tsconfig + Jest).
Not built npm packages. No build orchestration, one copy on disk.

Editor preview, published player and `twine-cli` share the SAME parser, renderer and
schema. So:

- A parser change reaches the player by `npm run build:format`, never by patching a bundle.
- Editor and player disagreeing is a BUG, and the usual cause is one of them holding its
  own copy of a rule. Centralize the rule, do not mirror it.
- Every rule that exists twice will drift. Past drifts: vars separator (3 regexps), vars
  line grammar, link case folding, passage-name resolution.

| Need | Package |
|---|---|
| Scene YAML keys, grammar, errors, fixes | `packages/scene-schema/src/parse-scene.ts` |
| Wire types, key lists, presets | `packages/scene-types/src/index.ts` |
| Stage state, beat application, diffing | `packages/scene-core` |
| DOM renderer, sound, bubble shapes | `packages/render-dom` |
| Writing YAML back from a gesture | `packages/scene-edit` |

**Scene format reference lives in the parser + `docs/sliders/02-sliders-format.md`.**
Do not restate keys anywhere else.

## Build-time tripwires (by design — build goes red)

- Scene Help key tables are `Record<typeof KEYS[number], string>`. A new key fails the
  build until documented. Two sessions adding a key both have to document the other's.
- `ENTITY_KEY_ORDER ⊇ ENTITY_KEYS`, asserted in `write.test.ts`.
- `DEFAULT_EASES` exhaustive over `TransitionKind`.
- `format/sliders-markers.json` + `scripts/format-guard.mjs` — build fails if a Sliders
  feature is missing from `format.js`; a unit test fails if the committed bundle is stale.

## The format is a thin fork

`format/` = Chapbook 2.3.1 vendored + a Sliders layer. Touch points into Chapbook's own
files are enumerated in **`format/README.md`** — read it before editing that directory.

The editor half (CodeMirror mode, commands, toolbar, reference scanner) is **silent when
lost**: the format still builds, loads and plays; the passage editor just turns back into
Chapbook's. 0.2.0 shipped exactly that way, in production, for a day.

## Naming and scope

- Asset **names** and character **ids** are ONE namespace, per collection. Scene YAML
  addresses both by that string. A rename throws, an upload numbers (against the story's
  whole view).
- Assets live in the **shared library** (`packages/asset-library`, plans
  `docs/sliders/plans/asset-library-*.md`). Each story = own collection (`kind: story`,
  created on first write) + binding (attached collections, usage refs).
- Name resolution: own collection, then attached in order. **First wins**, later =
  shadowed. `coll/name` = qualified. Same rule in facade, preview, story-map catalog + lint
  (`ambiguous` warning).
- Old callers see `slidersAssetStore(storyId)` = `LibraryAssetStore` facade
  (`src/store/asset-library/story-asset-store.ts`), the old `AssetStore` interface over
  that view. Packager untouched, runs through it.
- Editing art that lives elsewhere or another story uses throws `SharedAssetError` unless
  `{scope: 'all' | 'fork'}`. Never silently changes another story.
- Character pose images are named `<character id>-<pose>`. A character's first pose is
  always `idle`, whatever the file was called.
- The word `frame` is retired: **pose** (named look: still, animated file or steps) and
  **step**. Old `frame:`/`frameLoop:` scene YAML is NO LONGER read (unknown-key warning).
  `frames:` manifests are still read, never written. Stored `AssetKind 'frame'` keeps the
  word — it is on the wire.
- A scene has no name of its own. Its passage name is its address (`from:`, index, voice
  tools, CLI). `id:` was removed 2026-09-24, no back-compat.
- Unknown keys warn, never error: parser drops them, scene plays.

## Z and layers

One z space. `StageEntity.layer` does not exist. `layer:` desugars to `z` at parse time.
Draw order is z, then insertion order — never alphabetical id.

## Sync model

Two syncs, one socket.

| | Stories | Asset library |
|---|---|---|
| code | `store/persistence/server` | `packages/asset-library` engine, `store/asset-library` provider |
| unit | whole story, `rev` If-Match | per record (collection/asset/character/binding), `rev` If-Match |
| bytes | — | blobs by sha256, write-once, fetched lazily into OPFS |
| wake | socket `story`/`deleted`/`revived`, poll | socket `{t:'lib', seq}` → `engine.notify`, reconnect, 30 s poll |
| checkout | text only | nothing: every client holds every record |

Websocket `/api/v1/events` carries the change bus, presence and advisory locks — it
**never writes**. Library invariants live in the engine (contract doc, "Client
invariants"): blob before record, pulled record never re-enters the outbox, base
persisted, 412 → 3-way merge.

Story rules that cost real data when broken:

1. **A pull must LAND before it is recorded.** Proof is a dry run of the real reducer over
   the array about to be dispatched — never a mirror of the reducer's conditions, which
   drifts. `apply-pull.ts`.
2. **No retry loop on a refused pull.** A landed pull clears the story's undo stack;
   retrying every 30s wipes the author's history twice a minute. A refusal writes
   `pullBlockedRev` and lifts only when `server.rev` moves past it.

Editor-only keys (`locked:`) are never read by the player. Local-only story fields (`Story.sync`) are stripped on the wire.

## Known gaps

- No conflict UI in the story editor — only on the story list.
- Library UI (collections rail, attach, conflicts, sync chips) not built yet: facade +
  engine hooks only. `twine-cli` still reads the old per-story manifest.
- A story living only in a browser library is linted by nothing but the editor.
