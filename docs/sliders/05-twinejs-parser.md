# 05 — Parser (`scene-schema`)

Shared package. Used by the format runtime, the format's CM5 mode, the fork's editor
lint, the preview, and the visual editor. **One source of truth or everything drifts.**

## Stack (D4)

```
text → yaml.parseDocument()  → Document (YAML 1.2, comments preserved)
     → subset check           → reject anchors/aliases/tags/etc.
     → schema check           → domain errors
     → Stage AST
```

Use the **`yaml`** npm package (eemeli). Not `js-yaml`.

| Why | |
|---|---|
| YAML **1.2** | `no` is the string "no", not `false`. Kills the Norway problem. |
| `parseDocument()` | keeps comments + formatting. **Required by the [visual editor](07-twinejs-visual-editor.md)** for round-trip writes. |
| Good positions | line/col on every node, for gutter markers |

Bundle size is not a constraint (D4). Don't hand-write a parser.

## The subset

Max nesting depth is **three**, and level three is scalars or flow sequences only:

```yaml
cast:                    # 1 block map
  mira:                  # 2 block map
    at: [-0.4, 0]        # 3 scalar / flow seq   ← deepest we ever go
```

**Allowed:** block maps · block seqs · flow maps `{}` · flow seqs `[]` (one level, scalars
only) · `|` block scalars for long dialogue · `#` comments · scalars of type number /
`true` / `false` / `~` / string.

**Rejected by the subset check:** anchors `&` · aliases `*` · tags `!!` · multi-doc `---` ·
`>` folded scalars · nested flow collections · non-string keys.

Rejecting is not pedantry — every one of these is something the CM5 mode and the visual
editor would have to model, for zero author benefit.

## Errors

```ts
interface SceneError {
  code: string;                   // 'unknown-key'
  message: string;                // "Unknown key 'char'."
  hint?: string;                  // "Did you mean 'cast'?"
  line: number; col: number;      // 1-indexed
  endLine?: number; endCol?: number;
  severity: 'error' | 'warning';
}
```

Every error carries a position. No bare "parse failed".

| Code | Catches |
|---|---|
| `yaml-syntax` | malformed YAML (from the parser) |
| `subset-violation` | anchor, alias, tag, multi-doc, `>` |
| `unknown-key` | typo at any level. Suggest via edit distance. |
| `bad-coordinate` | `at:` not a number or `[x, y]`; out of −1…1 |
| `bad-layer` | not `back` / `mid` / `front` (D11) |
| `unknown-asset` | id not in the asset store *(fork only — needs the store)* |
| `unknown-character` | `cast` id not in `SlidersCast` *(fork only)* |
| `unknown-frame` | `frame:` not in that character's frames *(fork only)* |
| `unknown-link` | `[[name]]` with no `links:` entry and no inline target |
| `dupe-scene-id` | *(index only — cross-passage)* |
| `unknown-from` | `from:` target or `@mark` missing *(index only)* |
| `from-cycle` | `from:` graph is not a DAG *(index only)* |

## Three validation tiers

A story format only ever sees one passage. So:

| Tier | Where | Catches | Runs in stock Twine? |
|---|---|---|---|
| 1 | CM5 mode + schema, live in the editor | syntax, subset, unknown keys, coordinates | ✅ |
| 2 | **Scene Index panel — fork** | dupe ids, unknown `from:`, unknown `@mark`, cycles, orphans, unknown assets | ❌ |
| 3 | Sliders runtime at boot (sees all passages) | same as tier 2 | ✅ |

Tier 3 is the net that still fires in stock Twine. It is what keeps the
format-independent-of-fork rule real rather than aspirational.

## CM5 syntax mode

CodeMirror **5.65**. Classic streaming tokenizer: `startState()` + `token(stream, state)`.

⚠️ `EXTENDING.md` forbids custom token names. Map onto CM5 built-ins:

| Scene concept | CM5 token |
|---|---|
| top-level keys (`bg`, `cast`, `beats`) | `keyword` |
| character / asset / frame ids | `def` |
| `[[links]]` | `link` |
| numbers, coordinates | `number` |
| dialogue and other strings | `string` |
| `true` / `false` / `~` | `atom` |
| `#` comments | `comment` |
| unknown key | `error` |

Dialogue as `string` and ids as `def` gives a readable block for free, in both themes.

The mode is a **tokenizer, not the parser.** If it drifts from the schema the damage is
cosmetic. Never make semantics depend on it.

## Editor integration (fork)

| Concern | Rule |
|---|---|
| Debounce | 150–250 ms after typing stops. Never parse per keystroke. |
| Gutter | dot per line with an error |
| Inline | squiggly underline on the error range |
| Panel | error list under the editor, click → jump to line |
| Partial results | **always return a best-effort Stage even when errors exist**, so the [preview](06-twinejs-preview.md) keeps rendering instead of blanking |
| Cache | key on passage text hash; the preview and visual editor reuse the same parse |

That "partial results" rule matters more than it sounds. A preview that goes blank on every
half-typed line is a preview nobody leaves open.

## Reference parsing

`references.parsePassageText(text)` must find, from raw passage text, without a full parse:

- `[[name -> Target]]` → `Target`
- `[[name]]` + `links: {name: {to: Target}}` → `Target`

Cheap regex is fine and correct here — it feeds the story map, not the runtime.

Open: should `from:` also emit a reference (dotted line)? See D9 — leaning toward colouring
passage nodes by scene-id hash instead, so navigation edges and scene edges don't get mixed
up on the same map.
