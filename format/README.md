# Sliders story format

The player. Chapbook 2.3.1 with a scene layer bolted on, built into
`public/story-formats/sliders-<version>/format.js`.

```sh
npm run build:format    # from the repo root
```

## Layout

- `src/runtime`, `src/twine-extensions` — Chapbook 2.3.1, vendored verbatim except for the
  edits listed below. Keeping the fork this thin is the point: a Chapbook upgrade is a
  re-copy plus those edits.
- `src/runtime/sliders` — everything Sliders adds to the player.
- `src/twine-extensions/sliders` — everything Sliders adds to the editor.

The edits into Chapbook's own files, runtime half:

| File | Edit |
| --- | --- |
| `runtime/index.ts` | calls `initSliders()` after `initStory()` |
| `runtime/index.css` | imports `sliders/sliders.css` |
| `runtime/template/modifiers/index.ts` | adds `sceneModifier` to the builtins |
| `runtime/template/render-parsed.ts` | filters blocks through `sceneOnlyBlocks()` |

And the editor half — these are the ones 0.2.0 shipped without:

| File | Edit |
| --- | --- |
| `twine-extensions/codemirror-mode.ts` | hands a `[scene]` block to `sceneToken()` |
| `twine-extensions/codemirror-commands.ts` | spreads in `sceneCommands` and `sceneInsertText` |
| `twine-extensions/codemirror-toolbar.ts` | puts `sceneMenu()` first in the toolbar |
| `twine-extensions/parse-references.ts` | adds `sceneLinkTargets()` to the passages found |

## Do not lose the Sliders half

**When you change anything under `format/`, check that the Sliders behaviour is still
there — especially the CodeMirror ones.** They are easy to drop and invisible when
dropped: a format missing them builds, loads and plays. The passage editor just quietly
turns back into Chapbook's, and nobody notices until an author opens a scene.

That is not hypothetical. Version 0.2.0 moved the format into this repo, re-vendored
Chapbook, and shipped `src/twine-extensions` unmodified. Every story pinned to it lost the
Scene toolbar menu, scene syntax highlighting, the Scene Help button and the story-map
arrows drawn from a scene's `links:` — for a day, in production.

What holds the line now:

- `format/sliders-markers.json` lists a string per feature that must survive into
  `format.js`. `scripts/format-guard.mjs` asserts them and **the build fails** if one is
  gone; `src/twine-extensions/__tests__/built-format.test.ts` asserts the same list
  against the committed bundle, so a stale `format.js` fails too.
- The unit tests in `src/twine-extensions/__tests__` run the mode, the toolbar and the
  commands for real.

Deleting a marker is allowed — features do get retired — but do it in the same commit as
the removal, and say why here. Never delete one to make a red build go green.

Three couplings with the editor that no test in this directory can see:

- The editor appends its **Scene Help** item to whatever toolbar menu is labelled `Scene`
  (`src/dialogs/passage-edit/story-format-toolbar.tsx`). Renaming the menu removes that
  button from the app.
- **Insert Scene** is re-pointed at the passage's real links as it lands
  (`src/dialogs/passage-edit/scene-preview/prefill-links.ts`), which finds the skeleton's
  `links:` at column 0 with its entries indented under it. Keep that shape.
- The **last-scene handoff** goes through `localStorage`, written by
  `src/dialogs/passage-edit/scene-preview/use-last-scene.ts` and read by
  `src/twine-extensions/sliders/last-scene.ts`. Both sides must agree on the keys.

## Scene semantics live in `packages/`

`@sliders/scene-schema`, `scene-core`, `scene-index`, `render-dom` and `scene-types` are
aliased straight to `../packages/*/src` by `vite.runtime.config.js` and
`vite.extensions.config.js`. The editor imports the same files, so the preview, the syntax
highlighting and the player cannot drift: a parser or renderer change reaches all of them,
and the only step is rebuilding the format.

This is why the format is in this repo at all. It used to be a separate project whose
source was not checked out anywhere, so every renderer fix had to be hand-patched into the
minified bundle — the reason old notes mention patching `bgD`/`bgIm` by hand.

## Versioning

The version in `format.js` comes from `format/package.json`. Bumping it writes a NEW
directory under `public/story-formats/`; the editor's format list
(`src/store/story-formats/defaults.ts`) and the default in `src/store/prefs/defaults.ts`
both name a version explicitly, so bump those in the same commit.

Stories that pin a version no longer installed are repaired onto the newest version of the
same format (`src/store/stories/reducer/repair/repair-story.ts`). Note that semver alone
cannot do this below 1.0.0: `^0.1.0` does not admit `0.2.0`, which is why that repair falls
back to matching on the format's NAME. Without the fallback, every 0.x bump silently moved
stories onto whatever the user's default format happened to be.
