# Sliders — spec index

Visual-novel scene authoring for Twine. Two forks, one shared parser.

## Files

| # | File | Covers |
|---|---|---|
| 01 | [twine-language-review.md](01-twine-language-review.md) | Which format to fork, and why. What a format can/can't do. |
| 02 | [sliders-format.md](02-sliders-format.md) | The Chapbook fork. Scene YAML spec + runtime. |
| 03 | [twinejs-asset-manager.md](03-twinejs-asset-manager.md) | Asset storage, upload, WebP, publish pipeline. |
| 04 | [twinejs-character-editor.md](04-twinejs-character-editor.md) | Frames, anchors, origin. Opened from 03. |
| 05 | [twinejs-parser.md](05-twinejs-parser.md) | Shared YAML→Stage parser. Errors. CM5 highlighting. |
| 06 | [twinejs-preview.md](06-twinejs-preview.md) | Live preview under the passage editor. Full screen. |
| 07 | [twinejs-visual-editor.md](07-twinejs-visual-editor.md) | Drag on the preview, write back to YAML. |
| 08 | [export-import-bundle.md](08-export-import-bundle.md) | `.sliders.zip` — story text plus its assets. |
| 09 | [twinejs-asset-generator.md](09-twinejs-asset-generator.md) | Gemini/OpenAI image generation. History, saving. |
| 10 | [visual-editor-plan.md](10-visual-editor-plan.md) | Build plan for 07. Phases, blockers, shipped bindings. |

Origin notes with the full Q&A history: [`../2026-08-14-twine-languages.md`](../2026-08-14-twine-languages.md).

## Two repos

```
sliders-format/    fork of Chapbook 2.3.1     → runtime + 4 editor extensions
                                                MIT. Public. No upstream PR.
twinejs-sliders/   this repo, fork of twinejs → asset manager, character editor,
                                                parser UI, preview, visual editor
```

**Hard rule: the format must never depend on the fork.** A story authored in
Sliders-Twine still runs in stock Twine. You lose the authoring UI, nothing else.

## Shared packages

Consumed by **both** repos. Publish as real packages day one or they drift.

| Package | Does |
|---|---|
| `scene-schema` | YAML 1.2 → Stage AST. Subset validation. Errors. |
| `scene-core` | Stage model, differ, marks, `from:` resolution, beats. No DOM. |
| `scene-index` | Global scene graph. Dupe ids, unknown refs, cycles. |
| `asset-registry` | id → asset. Manifest, preload. |
| `cast-registry` | Characters: frames, anchors, origins. |
| `render-dom` | Renderer #1. CSS transforms + `<img>`. |
| `render-three` | Renderer #2. Later. Same interface. |
| `ui-dialogue` | Bubbles, boxes, links. DOM always. |

## Decisions

| # | Decision |
|---|---|
| D1 | Sliders = Chapbook 2.3.1 fork. Track upstream. |
| D2 | Speech bubbles are DOM, positioned from character anchors, in every renderer. |
| D3 | Wiki-style navigation. Links carry props. Links inside bubbles are real links. |
| D4 | YAML 1.2, restricted subset. Bundle size is not a constraint. |
| D5 | Characters hold named frames. Animation = an animated file, not a timeline. |
| D6 | Users upload files to make frames. Characters reference them by id. |
| D7 | Asset manager: backgrounds + objects + characters-as-collections. Frames hidden. Tag/group/filter. |
| D8 | Separate character editor, opened by clicking a character. Tab per character. |
| D9 | Story map: colour passage nodes by scene id hash; faded bg thumbnail if available. |
| D10 | Save granularity = **passage**. Simplest. No beat-level resume. |
| D11 | **3 fixed layers**, fixed order. Numeric `z:` escape hatch. |
| D12 | Preview below passage text. Collapsible, remembers state. Click → full screen. |
| D13 | Publish public GitHub fork, MIT. Do not PR upstream. |
| D14 | Assets work in Electron **and** web. Convert all uploads to high-quality WebP. |
| D15 | Visual scene editor on top of the preview. |
| D16 | The player's default format: a scene passage is full screen, and only its YAML is drawn. `sliders.fullScreen` / `sliders.sceneOnly` opt out. |

Later, not now: package sync to a standalone viewer, web-app URLs, Capacitor native wrap.

## Build order

1. `scene-schema` + `scene-core` + `scene-index`, headless. Parse, diff, resolve `from:`,
   detect dupes/cycles. Unit tests only. **If the differ is right, the rest is drawing.**
2. `render-dom` + plain HTML harness. No Twine yet. Fastest loop you will get.
3. Fork Chapbook → `sliders-format`. `[scene]` modifier + adapter. First playable.
4. `editor-ext`: CM5 mode + `parsePassageText`. Feels native.
5. Fork UI: asset manager → character editor → preview → visual editor.
6. `render-three`, only after the `Renderer` interface survives real authoring.

Steps 1–4 run in stock Twine. Step 5 is quality-of-life on top.
