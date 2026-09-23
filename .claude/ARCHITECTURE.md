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

- Asset **names** and character **ids** are ONE namespace. Scene YAML addresses both by
  that string. Uniqueness is enforced in `asset-store`; a rename throws, an upload numbers.
- Assets are **per story**, not a shared library. `<AssetScopeProvider>` gates the store so
  nothing can write to the wrong scope by accident.
- Character pose images are named `<character id>-<pose>`. A character's first pose is
  always `idle`, whatever the file was called.
- The word `frame` is retired: **pose** (named look: still, animated file or steps) and
  **step**. Old `frame:`/`frameLoop:` YAML and `frames:` manifests are read forever and
  never written. Only the stored `AssetKind 'frame'` keeps the word — it is on the wire.

## Z and layers

One z space. `StageEntity.layer` does not exist. `layer:` desugars to `z` at parse time.
Draw order is z, then insertion order — never alphabetical id.

## Sync model

`rev` is the If-Match token and bumps on every write. Websocket `/api/v1/events` carries
the change bus, presence and advisory locks — it **never writes**.

Three rules that cost real data when broken:

1. **A pull must LAND before it is recorded.** Proof is a dry run of the real reducer over
   the array about to be dispatched — never a mirror of the reducer's conditions, which
   drifts. `apply-pull.ts`.
2. **No retry loop on a refused pull.** A landed pull clears the story's undo stack;
   retrying every 30s wipes the author's history twice a minute. A refusal writes
   `pullBlockedRev` and lifts only when `server.rev` moves past it.
3. **The library compare stops an asset ping-pong.** A pull that changes nothing must fire
   no library-change event, or two clients push art at each other forever.

Editor-only keys (`locked:`) and soft marks (`Stage.bgImplicit`) are never read by the
player. Local-only story fields (`Story.sync`) are stripped on the wire.

## Known gaps

- No conflict UI in the story editor — only on the story list.
- Nothing tells the author when a pulled asset is `missing` server-side.
- A story living only in a browser library is linted by nothing but the editor.
