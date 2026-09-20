# Test audit — the fork's own tests

2026-09-20. Scope: code this fork owns. `git merge-base sliders develop` = `e36c6009`;
a path touched only after that is ours. Upstream twinejs tests under `src/` read, never
rewritten.

Read-mostly audit. One test changed (`cd2f3b7a`), committed separately from this report.

---

## 1. Where the tests are

| area | test files | src files | verdict |
|---|---|---|---|
| `packages/*` | 60 | 77 | **good**. Parsers, differ, renderer, writer all covered. |
| `src/dialogs/passage-edit/scene-preview/` | 22 | 27 | **good per-file**, one 1750-line hole (below). |
| `src/util/` (fork's) | 14 of 22 | — | **good**. Untested ones trivial or covered indirectly. |
| `format/src/twine-extensions/` | 4 | 15 | **thin but guarded** — `built-format.test.ts` is a real tripwire. |
| `format/src/runtime/` | **0** | 125 | **NOT IN JEST ROOTS.** See §4.1. |
| `server/` (Go) | 7 | 22 | **good**. 3064 test lines / 4175 src. |
| `e2e/` | 19 specs | — | **degraded** — 6 fail on clean checkout, 2 flaky (CLAUDE.md 2026-09-07). |
| `src/dialogs/sliders-characters/` | 1 | 8 | **bad**. 1722 LOC, one pure-helper test. |

Headline: the fork tests its **pure logic** well and its **components and player**
barely at all.

---

## 2. Module table — what to test next

Priority = (likelihood it breaks silently) x (how far the breakage travels).

| pri | module | LOC | test kind needed | why |
|---|---|---|---|---|
| **P0** | `format/src/runtime/sliders/*` | 908 | unit, pure fns; add jest root | The player. 0 tests. `states` off-by-one shipped silently for weeks (CLAUDE.md 2026-09-18). `sceneOnlyBlocks` **drops content with no error**. |
| **P0** | `scene-preview.tsx` | 1750 | component (RTL) | Largest fork file, 0 tests. Owns `drawnStage`, `beatNote`, scrubber advance, playback loop. Every gesture funnels through it. |
| **P1** | `sliders-characters/*` | 1722 | component + integration | 1 test (`sprite-geometry`). Its e2e ("character create", "frame fit") is in the known-failing list ⇒ **effectively zero live coverage**. Repeated real defects here. |
| **P1** | `splitVarsSection` tail loss | 4 | fix, not test | Documented by `it.failing` now. Still live in player. §3.1. |
| **P1** | `scene-stage.tsx` | 317 | component | Preview↔renderer bridge. Holds the retime-then-snap order that must not invert. |
| **P2** | `hotkeys-context.tsx` | 281 | unit, cross-realm | `nodeType` instead of `instanceof Element` — a browser-only trap, no test pins it. |
| **P2** | `CardButton` / `Tooltip` portal | — | component | CLAUDE.md 2026-09-17 says both sit in the MenuButton z-index trap, **not yet fixed**. Verified still true: `card-button.tsx` has no `createPortal`. |
| **P2** | `asset-generator/*.tsx` | ~1100 | component | 2 tests cover `generate`/`models` only; UI untested. |
| **P3** | `twine-cli` I/O cmds | ~2500 | integration | `put/cat/map/graph/new/ls/...` untested. Logic-heavy `lint`/`assets`/`copy`/`passage` **are** well covered. |
| **P3** | `asset-store` backends | 338 | e2e, not unit | opfs/indexeddb/electron are thin browser-API wrappers. Unit tests would mock the thing under test. |

### Already good — do not "improve"

- `packages/scene-schema` — 13 test files, per-feature (`parse-bg`, `parse-rot`, `parse-ease`…).
- `packages/scene-edit/write.test.ts:500` — **model test**: asserts `ENTITY_KEY_ORDER ⊇ ENTITY_KEYS`,
  so a schema key the writer would silently drop fails the suite. `scale:` was lost exactly that way.
- `src/dialogs/scene-help/scene-help.tsx` — 612 LOC, no test, and **that is correct**:
  `KeyHelp<typeof KEYS> = Record<T[number], string>` makes an undocumented key a **build
  failure**. Type-level tripwire beats a test. Replicate this pattern.
- `format/src/twine-extensions/__tests__/built-format.test.ts` — asserts markers in the
  committed bundle, so a re-vendor that drops the Sliders half goes red.

---

## 3. Suspect tests — assertions that pin a defect

**Result: one found.** The fork's test discipline is good — fixes land with tests that
assert the *fixed* behaviour, not the defect.

Swept, so the negative result is checkable:

| sweep | command shape | hits | of those, real |
|---|---|---|---|
| defect-ish test **names** | `it\('…(silently\|currently\|for now\|still \|does not\|drops\|loses\|ignores\|falls back\|gives up\|parks\|never)…'` over every fork `__tests__` | ~75 | **0** |
| defect **comments** near an `expect` | `TODO\|FIXME\|XXX\|HACK\|known issue\|should be\|ideally\|for now\|not ideal\|the bug\|defect\|pre-existing\|not yet` | 4 | **0** |
| `.skip` / `.todo` / `xit` / `it.failing` | all fork areas | 13 | **0** (all upstream, §3.3) |
| empty-result assertions | `toEqual([])`, `toBeUndefined()`, `toBeNull()` with defect language nearby | 0 | **0** |
| snapshots | `__snapshots__` dirs | 0 | — |
| the one that hit | manual read of `vars-section.ts` against its test | 1 | **1** (§3.1) |

The ~75 name hits are all *intended* negative behaviour — "never mutates either stage",
"drops a self-reference", "never injects markup from scene text". Defensive, not pinned
defects. Do not mistake them for this bug class.

### 3.1 CONFIRMED bug-asserting — FIXED in `cd2f3b7a`

`packages/scene-schema/src/__tests__/vars-lines.test.ts:35` (pre-fix)

```js
it('DISCARDS everything after a second separator', () => {
  expect(split?.body).toBe('\nfirst\n');
  expect(split?.body).not.toContain('second');   // pins the data loss
});
```

- **Defect**: `splitVarsSection` does `text.split(re, 2)`. JS runs a **full** split then
  truncates — piece 3+ is dropped. A passage whose prose holds a bare `--` line
  **silently loses everything after it**.
- **Ships**: `format/src/runtime/template/parse.ts:58` makes the same call. Live in the player.
- **Why it is the bad kind**: every other case in that file is a grammar quirk where
  narrowing would stop setting a variable in a published story — genuinely "do not touch".
  This one is pure loss. Fixing it can only reveal text the author already wrote. No story
  can depend on it.
- **Fixed as**: split into one `it()` for the fact that survives either way (vars half =
  everything before the FIRST separator) + one `it.failing()` for the body the author
  expected. Verified both directions: green today; with `splitVarsSection` sliced at the
  first separator instead, jest reports *"Failing test passed even though it was supposed
  to fail"*.
- **Source left unchanged** — the real fix needs `parse.ts` in the same commit, out of
  audit scope. Fix is ~5 lines: `exec` the separator, `slice` either side.

### 3.2 Deliberate and correct — leave alone (verdict A)

| file:line | asserts | why it is fine |
|---|---|---|
| `packages/scene-core/__tests__/resolve-stage.test.ts:247` | raw `diffStages` emits nothing for the candle | **Contrast** test. The resolved path is asserted immediately above. Goes red only if `diffStages` ever resolves internally — which is the intended tripwire. |
| `packages/asset-store/__tests__/characters.test.ts:30` | frames get separate anchor objects | States the bug being *prevented*, not pinned. |
| `vars-lines.test.ts` header | "characterization, not wishes" | Correct framing for the rest of the file — narrowing there breaks published stories. |

### 3.3 `.skip` / `.todo` / `xit`

All 13 hits are **upstream-origin and benign** — mock fidelity or a jsdom gap, never a
hidden failure:

- `dialogs/context/__tests__/dialogs.test.tsx:151` `.skip` — jsdom does not report `padding-left`.
- `passage-toolbar.test.tsx:127`, `passage-text.test.tsx:141-143`, `story-format-toolbar.test.tsx:166`,
  `story-javascript/stylesheet:132-135`, `file-chooser.test.tsx:50`, `import.test.ts:82-83` — `it.todo`.

**Zero** `.skip`/`.todo`/`xit`/`it.failing` under `packages/`, `format/src/`, `e2e/`, or
`scene-preview/`. The fork's own suite hides nothing this way. Good.

### 3.4 Not found

- No snapshot files capturing unverified output.
- No test mocking its own unit under test.
- No tautological "assert the fixture" tests worth flagging.
- The `largeWithPreview` size **is** in `passage-toolbar.test.tsx:136` — the fork updated
  the upstream `it.each` table rather than leaving it stale.

---

## 4. Top 5 untested things most likely to bite

### 4.1 The player runtime — `format/src/runtime/sliders/` (908 LOC, 0 tests)

**Not reachable by jest at all.** `roots` = `src`, `packages`, `format/src/twine-extensions`.

What lives there unguarded:

- `stage-element.ts:164` — `states = runBeats(...)`. The `[entry, ...runBeats(...)]`
  off-by-one made every beat stage one late and the last beat's never land. **Silent since
  `2654ee19`** because "one beat late" reads as a slow transition. The *contract* is pinned
  (`run-beats.test.ts:33`, `beats.length + 1`); the *consumer* is not.
- `scene-only.ts:69` `sceneOnlyBlocks` — pure `ContentBlock[] → ContentBlock[]`, and the
  function that **silently ate** a near-miss vars section (2026-09-17). Trivially testable.
- `scene-modifier.ts:47` `pruneEntityLinks` — decides whether a door glows. Pure over Scene + state.
- `assets.ts` manifest resolver, `config.ts` story-bubble vars.

**Fix is cheap**: add `format/src/runtime` to jest `roots` (or just the `sliders` subdir)
and write unit tests for the four pure functions. *Note: `jest.config.js` is dirty — a peer
owns it. Do not edit it in a shared tree; coordinate first.*

Editor preview and player disagreeing is the symptom to watch: the preview indexes
`runBeats` directly and was always right.

### 4.2 `scene-preview.tsx` (1750 LOC, 0 tests)

Every sibling is tested; the orchestrator is not. Untested logic that only it holds:

- `:1016` `drawnStage` — frame-hover preview override + the `TRACE_PREVIEW_ID` second entity.
  Subtle rule: overlay gets the **real** stage, only `<SceneStage>` gets the drawn one.
- `:1069` `beatNote` — why a write is refused / that the file will grow a line.
- `:578` `setBeat(b => b + grew)` — scrubber steps forward after an inserted beat.
  `insertedBeatCount` is unit-tested; **its use is not**, and getting it wrong snaps the
  stage to the wrong state.
- `:302-303` derived locks — scene `locked:` laid over localStorage, one-way.
- Playback: `autoAdvance: 0` honoured **only in full screen**. The two-zeros rule
  (`dur: 0` = go now, `autoAdvance: 0` = wait for click) is pinned in `beat-hold.ts`;
  the **consumption** of it is not.

### 4.3 The character editor — `sliders-characters/` (1722 LOC, 1 test)

Only `sprite-geometry.test.ts`, a pure helper. Its e2e ("character create", "frame fit")
is in the **known-failing six**. So: no working automated coverage at all.

History says this area breaks: drop target covering only the frame column (tab **navigated
away**), `handleCharacterDrop` always throwing on a name clash, two flex traps, frame rename
not invalidating the preview resolver. `character-frames.ts` got tests when it was fixed —
the editor shell around it did not.

### 4.4 Browser-only integration traps — no test pins any of them

CLAUDE.md records these as found-in-browser. They are invisible to jsdom and to the suite:

- Portal events bubbling the React **tree** (MenuButton press clearing the selection it was
  about to set). Fixed via `OWN_PRESS_SELECTOR` — **untested**.
- `CardButton` (z 2000) and `Tooltip` (3000) **still in the same trap, unfixed**. Verified:
  `card-button.tsx` has no `createPortal`.
- `instanceof Element` false across realms → `hotkeys-context.tsx` uses `nodeType`. Untested.
- `ResizeObserver` built in the wrong realm never delivers.

Cheap win: a jsdom test asserting a portalled press does **not** clear stage selection.

### 4.5 `splitVarsSection` tail loss — live, now documented

See §3.1. `it.failing` documents it and turns red on fix. Nothing yet fixes it.
Both copies must change together: `vars-section.ts` and `format/.../parse.ts:58`.

---

## 5. Method notes

- `pgrep -af 'bin/jest'` **matches its own command line** — always a false positive.
  Use `pgrep -af 'node.*bin/jest' | grep -v pgrep`.
- Detecting "untested file" by `<dir>/__tests__/<base>.test.*` gives false positives for
  files in subdirectories (`engines/ormbg-engine.ts` is tested from `asset-editor/__tests__/`).
  Search the whole subtree for an import of the basename instead.
- `it.failing` (jest 29.7) verified both directions here and in `adfc6ee2`. When one turns
  red, **flip it to `it`** — never soften the assertion.
