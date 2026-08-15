# 01 — Twine language review

**Verdict: fork Chapbook 2.3.1.** Facts read from `public/story-formats/*/format.js` and
`EXTENDING.md` in this repo, not from memory.

## The four formats

| | **Harlowe 3.3.9** | **SugarCube 2.37.3** | **Chapbook 2.3.1** | **Snowman 2.1.3** |
|---|---|---|---|---|
| Author | Leon Arnott | T. M. Edwards | Chris Klimas (made Twine) | Dan Cox |
| Size | 1.0 MB | 623 KB | **158 KB** | 176 KB |
| License | Zlib | BSD-2-Clause | **MIT** | MIT |
| Look | `(set: $x to 1)` | `<<set $x to 1>>` | `x: 1` on own line | `<% x = 1 %>` |
| Markup | own | own + HTML | **Markdown** | **Markdown** |
| For | non-coders | game devs | writers | JS devs |
| Raw JS | sandboxed, discouraged | **everywhere** | vars + `[JavaScript]` | **it is JS** |
| Extend with | in-language `(macro:)` | `Macro.add()` | `engine.extend()` | just write JS |
| Save/history | good | **best** | good, JSON-only by design | none |
| Editor extensions | yes | **none** | **yes, all 4** | **none** |

One line each:

- **Harlowe** — pretty walled garden. Extend in *its* language, not JS.
- **SugarCube** — heavy engine, best save. Ugly syntax, zero editor hooks.
- **Chapbook** — writer-first, front matter + Markdown, small, extension-shaped.
- **Snowman** — blank page with `window.story`, `_`, `$`. Build everything yourself.

## What we actually need

Rendering a VN means **throwing away the text renderer**. So "nicest markup" barely matters.

| Need | Harlowe | SugarCube | **Chapbook** | Snowman |
|---|---|---|---|---|
| Passage graph | ✅ | ✅ | ✅ | ✅ |
| State serializes to JSON | ⚠️ | ⚠️ | **✅ enforced** | ❌ |
| Passage = front matter + body already | ❌ | ❌ | **✅ native** | ❌ |
| Hook for **raw** passage text | ❌ | ⚠️ | **✅ `processRaw()`** | ✅ |
| Register block syntax | ❌ | ✅ | **✅ modifiers** | n/a |
| Register inline syntax | ❌ | ✅ | **✅ inserts** | n/a |
| CM syntax highlighting | ✅ | ❌ | **✅** | ❌ |
| Toolbar buttons | ✅ | ❌ | **✅** | ❌ |
| Story-map reference lines | ❌ | ❌ | **✅** | ❌ |
| Source small enough to read | ❌ | ❌ | **✅** | ✅ |

Chapbook wins every row that isn't table stakes.

## ⚠️ What a story format CANNOT do

`editorExtensions` gives exactly four things:

| Capability | What it really is |
|---|---|
| `codeMirror.mode()` | a CodeMirror **5** syntax mode |
| `codeMirror.toolbar()` | buttons / dropdown menus / separators. That is the whole vocabulary. |
| `codeMirror.commands` | functions in `CodeMirror.commands[…]`, called with **`editor` only** |
| `references.parsePassageText(text)` | one passage's text → passage names |

Verified: `src/store/use-format-codemirror-toolbar.ts:72`.

**Can:** highlight our YAML · toolbar button · insert text at cursor · draw map lines.

**Cannot:** open a panel or dialog · read any passage but the current one · store anything ·
show a thumbnail · add a route, tab, or library screen.

So the asset manager, character editor, uploads, tagging, preview, and **cross-passage scene
index** cannot ship in a story format. They go in the twinejs fork. See [README](README.md).

Also from `EXTENDING.md`, verbatim:

> Creating a standalone extension for Twine is not possible. Extensions can only be
> bundled with a story format.

There is no "use stock Chapbook" option. Wanting editor UX means shipping a format.

## Chapbook seams we use

**Vars section.** Split by `varsSep: /^--$/m`. A line that is exactly `--`. Each line is
`name: <JavaScript expression>`, optionally `name (condition): value`.

> ⚠️ Not YAML. **Flat** — no nesting, no lists. The scene tree cannot live here.
> Use a modifier block instead. See [02](02-sliders-format.md).

**Block syntax hook:**

```js
engine.extend('2.0.0', () => {
  engine.template.modifiers.add({
    match: /^scene$/i,
    // sees author text BEFORE inserts/links/Markdown
    processRaw(output, {state, invocation}) { /* output.text is our YAML */ }
  });
});
```

**Inline syntax hook:** `engine.template.inserts.add({match, render})`.

**Built-ins we inherit free:** `[note]` `[todo]` `[fixme]` (director's notes), `[continued]`,
`[if]` `[else]` `[unless]`, `[after 2s]`, `[align]`, `[CSS]`, `[JavaScript]`,
`[ambient sound]`, `[sound effect]`, `[embed image]`, `[embed youtube]`.

**Audio is already solved.** Don't build audio in v1.

**Not solved:** `config.style.backdrop` is a background **colour** only. No format has any
layer or sprite concept. We build that from zero regardless — which is why the format
choice is low-stakes.

## Editor environment facts

| Fact | Value |
|---|---|
| CodeMirror | **5.65** (not CM6) — `startState()` / `token(stream, state)` |
| React | 16.14 |
| Custom CM token names | **forbidden.** Must map onto CM5 built-in tokens. See [05](05-twinejs-parser.md). |

## Sources

- `EXTENDING.md`, `package.json`, `src/store/use-format-codemirror-toolbar.ts`,
  `public/story-formats/*/format.js` (this repo)
- [Chapbook: custom inserts](https://klembot.github.io/chapbook/guide/advanced/adding-custom-inserts.html) ·
  [custom modifiers](https://klembot.github.io/chapbook/guide/en/advanced/adding-custom-modifiers.html) ·
  [publishing models](https://klembot.github.io/chapbook/guide/en/multimedia/publishing-models.html)
- [Chapbook guide](https://klembot.github.io/chapbook/guide/en/) · [repo](https://github.com/klembot/chapbook)
- [SugarCube macro system](https://deepwiki.com/tmedwards/sugarcube-2/4.3-macro-system)
- [Twine 2 story format specs](https://github.com/iftechfoundation/twine-specs)
