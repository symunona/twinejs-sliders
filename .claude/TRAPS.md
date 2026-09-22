# Traps — things this codebase does that bite twice

`hits` = times it actually cost a debugging session (counted from the 2026-08..09 log,
`docs/sliders/archive/2026-log.md`). Bump the count when one bites you again.

## React / DOM

| hits | Trap | Answer |
|---|---|---|
| 3 | React 16 bubbles a **portal's** events up the React TREE, not the DOM tree. A menu in `document.body` still reaches the stage's `pointerdown`. | Guard by selector, never by DOM ancestry. `OWN_PRESS_SELECTOR` in `stage-editor-overlay.tsx`. |
| 3 | A press on the editor's own chrome hit-tests through to empty ground, clears the selection that chrome belongs to, and unmounts it before the click lands. | Add the new chrome to `OWN_PRESS_SELECTOR`. Symptom: "the button only works sometimes". |
| 3 | z-index collapse. `transform` and `position: fixed` each open a stacking context, so a child's `z-index: 2000` only sorts against its siblings and the whole subtree paints at ~0. | Portal to body with a real z-index, or `isolation: isolate` on the container. Raising numbers does not work. |
| 2 | Renderer counts z to 50, editor chrome counts to 7, in one stacking context. | `isolation: isolate; z-index: 0` on the renderer's host. The two scales are not comparable. |
| 1 | A layout effect that writes the state that re-renders what it measures → "Maximum update depth exceeded". `t()` from `useTranslation` is not identity-stable. | Bail when nothing changed (`sameMetrics`). |
| 2 | Flex item will not shrink past its content; ellipsis silently does nothing. | `min-width: 0` on the item that may truncate. |
| 1 | `<label>` wrapping a number box AND a range gives its name to the FIRST labelable child only. | e2e must target the `spinbutton`, not the slider. |
| 1 | A parent's ref attaches AFTER its children's layout effects run — first measure sees null. | One-tick `mounted` state. |

## Tests

| hits | Trap | Answer |
|---|---|---|
| 4 | jsdom has no `ResizeObserver`, `CSS.supports`, `document.elementsFromPoint`. | Guard the observer; stub the rest per test. |
| 2 | i18n is not initialised under jest, so `t()` returns its own KEY. | Find controls structurally; assert on keys. Never `t()` a keyword the author typed. |
| 1 | `src/__mocks__/react-i18next.ts` hands back a FRESH `t` every call. A component memoising on `t` re-runs forever — `<PromptButton>` re-validates and sets state on each new identity. Worker climbed to 2 GB and was OOM-killed twice, ~250 s each. Reads as a slow test, is an infinite render. | Mock `react-i18next` locally with a STABLE `t`, as the real hook does. Suspect it when one suite eats the box. |
| 1 | React 16 derives `onPointerEnter/Leave` from the pointerover/out pair. | Fire `pointerOver`/`pointerOut`; a dispatched `pointerenter` does not bubble. |
| 1 | `clientWidth` lives on Element, not HTMLElement — nothing to restore after shadowing. | `delete` the shadow. |
| 1 | `codemirror` resolves to a build whose default export is not the constructor. | Drive `mode()` over a hand-made `StringStream`. |
| 2 | `marqueeable-passage-map.test.tsx` marquee tests are FLAKY, rate rising with box load — clean 6/6 alone on an idle box, ~1 in 3 on a busy one, and two different assertions have failed. Seen on three branches including ones that share no commits, so not yours. | Re-run the one file before believing it. `uptime` first: another agent's jest is usually the reason. |
| 1 | `jest-canvas-mock` is loaded globally, so `getContext('2d')` works and every drawing call is a no-op — `getImageData` returns a BLANK `ImageData` whatever was drawn. A rasteriser tested against it passes while drawing nothing. | Nothing that composites pixels is provable under jest. Test the geometry, stub a real scanline context for the raster, and verify the pixels in a browser. |
| 1 | `pgrep -af 'bin/jest'` matches a peer's `while pgrep -f 'bin/jest'` waiter loop, so the lock check reports a false positive and an agent waits forever for itself. | Match `node.*bin/jest`. |

## agent-browser / manual verification

| hits | Trap | Answer |
|---|---|---|
| 2 | `open` with the same URL and a different HASH does not reload. | `location.reload()`. |
| 2 | Chapbook persists story state per story in localStorage (`chapbook-<name>-<ifid>`) — a reload RESUMES mid-story and every sample reads the final pose. | Clear the key before measuring. |
| 2 | A real file drag is not scriptable. A synthetic `DragEvent` exercises React's handler but NOT the browser default (which navigates the tab to `file://…`). | CDP `Input.dispatchDragEvent` for the default; synthetic event for the handler. |
| 1 | `click --at` does not reach this app's pointer handlers. | Dispatch `PointerEvent`s at `elementFromPoint`. |
| 1 | Snapshot refs go stale after a re-snapshot and silently point at a different control. | Query by `aria-label`. |
| 1 | Inline `transitionDuration` is rewritten to `0s` ~300ms after an apply, while the CSS transition keeps running. | Measure the transform matrix and look for the peak, not the inline style. |
| 1 | Player links are `<passage-link>` elements, not `<a>`. | — |
| 1 | `data-sfx-count` in HTML is `dataset.sfxCount` in JS. A lowercase lookup reads undefined. | — |

## Shared working tree

| hits | Trap | Answer |
|---|---|---|
| 2 | `git add <path>` takes the WHOLE file, including a peer's half-written lines. | `git diff --cached` before every commit. For a shared file: `git diff -U0`, drop foreign hunks, `git apply --cached --unidiff-zero`. `-U3` is too coarse. |
| 1 | The git INDEX is shared too — a peer may have things staged. | Private index: `GIT_INDEX_FILE=… git read-tree HEAD`, add own paths, `write-tree` + `commit-tree` + `update-ref`. |
| 1 | Deploy and `build:format` build the WORKING TREE, so they ship a peer's half-finished code. | Build from a clean `git worktree` at the pushed head. |
| 1 | `npx prettier --write` on a file you did not create reflows ~53 never-formatted src files and buries your diff. | Re-apply edits by hand. |

## Misc

| hits | Trap | Answer |
|---|---|---|
| 6 | Scene Help `KeyHelp` tripwire fires and the build goes red. | Working as designed. Document the key. |
| 1 | Editing any `.css` under `src/` makes vite-plugin-checker lint it as JS → full-screen "Parsing error", blank app. | Restart the dev server. |
| 1 | `npx vite` after a branch switch loads React twice ("Invalid hook call"), app renders blank. | `rm -rf node_modules/.vite`. |
| 2 | Files with a literal NUL are BINARY to git AND to grep — `use-scene-parse.ts`, `src/util/sliders-bundle/apply-bundle.ts`. Not a corruption, a join delimiter. | Leave the file. Search it with `grep -a`. |
| 1 | `grep` in a NUL file prints NOTHING — no "binary file matches", no error, exit 1. Reads as "symbol not here" and sends you looking in the wrong place. | `grep -a`. Suspect it when a symbol you can see in the file will not match. |
