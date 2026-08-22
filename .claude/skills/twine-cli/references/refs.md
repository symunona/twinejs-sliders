# Ref grammar

One string addresses everything. Full spec: `docs/sliders/12-story-cli.md` §1.

## Sigils

| Sigil | Means | Example |
|---|---|---|
| *(none)* | a story | `ep3`, `"Chapter 3"`, `s_7f2c`, `.` |
| `/` | descend — passage, then a path inside a scene | `ep3/Tavern Fight` |
| `#` | a scene id | `ep3#tavern-night` |
| `@` | a version (before `#`) or a state (after `#`) | `ep3@41`, `ep3#tavern-night@tense` |
| `:` | the asset library | `ep3:a_8f21`, `ep3:mira` |
| `.` | the pinned story, set by `twine-cli use` | `.#tavern-night` |

`a_`-prefixed ids after `:` are assets; anything else is a character id.

## Resolution order

A story segment: exact id → exact name → unique case-insensitive slug (`chapter-3` finds
`Chapter 3`) → unique id prefix. A passage segment adds passage-id prefix. Ambiguity is
never guessed — exit 2, with the candidates printed as refs.

`twine-cli ref <ref>` resolves one ref and prints its canonical `storyId/passageId#scene`
form plus the cache path it lives at. Use it when a name is ambiguous or a command says
"not found" and you disagree.

## Sub-paths inside a scene

The path is the YAML shape, verbatim:

```
#s/bg                  #s/camera        #s/camera/zoom
#s/cast                #s/cast/mira     #s/cast/mira/at   #s/cast/mira/frame
#s/props/candle        #s/props/candle/of
#s/fx                  #s/fx/0
#s/beats               #s/beats/3       #s/beats/3/patch
#s/links               #s/links/stay    #s/links/stay/to
```

Beats are addressed by index, and indices shift after `add`/`rm`/`mv` — re-run
`twine-cli scene beats <ref>` before a second positional edit.

## Read-only refs

`@<rev>` and `@<mark>` are historical or compiled views. `set`/`rm` against them is exit 2.
To bring an old revision back: `twine-cli story restore <ref> --rev N`.

## Quoting

`#` is safe mid-word in bash but not at the start of one, and passage names have spaces.
Single-quote every ref that is not a bare id:

```sh
twine-cli scene show '.#tavern-night'
twine-cli passage show '.../Tavern Fight'
```
