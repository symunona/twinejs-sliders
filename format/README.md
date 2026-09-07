# Sliders story format

The player. Chapbook 2.3.1 with a scene layer bolted on, built into
`public/story-formats/sliders-<version>/format.js`.

```sh
npm run build:format    # from the repo root
```

## Layout

- `src/runtime`, `src/twine-extensions` — Chapbook 2.3.1, vendored verbatim except for
  four lines. Keeping the fork this thin is the point: a Chapbook upgrade is a re-copy
  plus those four edits.
- `src/runtime/sliders` — everything Sliders adds.

The four edits into Chapbook's own files:

| File | Edit |
| --- | --- |
| `runtime/index.ts` | calls `initSliders()` after `initStory()` |
| `runtime/index.css` | imports `sliders/sliders.css` |
| `runtime/template/modifiers/index.ts` | adds `sceneModifier` to the builtins |
| `runtime/template/render-parsed.ts` | filters blocks through `sceneOnlyBlocks()` |

## Scene semantics live in `packages/`

`@sliders/scene-schema`, `scene-core`, `scene-index`, `render-dom` and `scene-types` are
aliased straight to `../packages/*/src` by `vite.runtime.config.js`. The editor imports the
same files, so the preview and the player cannot drift: a parser or renderer change reaches
both, and the only step is rebuilding the format.

This is why the format is in this repo at all. It used to be a separate project whose
source was not checked out anywhere, so every renderer fix had to be hand-patched into the
minified bundle — the reason old notes mention patching `bgD`/`bgIm` by hand.

## Versioning

The version in `format.js` comes from `format/package.json`. Bumping it writes a NEW
directory under `public/story-formats/`; the editor's format list
(`src/store/story-formats/defaults.ts`) and the default in `src/store/prefs/defaults.ts`
both name a version explicitly, so bump those in the same commit. Stories that pin the old
version are repaired onto the default when it no longer exists.
