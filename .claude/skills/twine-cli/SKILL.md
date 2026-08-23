---
name: twine-cli
description: Work on Sliders/Twine stories that live on the story-store server — map a story, pull one passage out as text, edit its scene YAML, resolve and read the assets a scene uses, lint, put it back. Use whenever a task touches a story on the server (twine-story-store, twine-store.tmpx.space, "the story store", "the library") rather than a local .twee/.html file, or when asked to copy an episode, move a character, change a beat, swap or generate a background, or find where an asset is used.
---

# twine-cli

`map`, `cat`, edit, `lint`, `put`. Spec: `docs/sliders/12-story-cli.md`.
Server: `docs/sliders/11-server-storage.md`. Scene YAML: `docs/sliders/02-sliders-format.md`.

Store keep real files, and CLI read them direct. Two things it exist for: passage text live
as a JSON string field (`story.json` is one line, no newlines), and nothing may be written
into `data/` by hand — writes must go through the API so rev bump and open editors hear it.

## Loop

```sh
twine-cli map ep3                              # passages, scene ids, links, assets, lint tally
twine-cli cat ep3/Tavern\ Night -o tmp/p.md    # one passage, unescaped, with receipt
# ... Read / Edit tmp/p.md ...
twine-cli lint tmp/p.md                        # fast, no server
twine-cli put ep3/Tavern\ Night tmp/p.md       # splice + PUT
```

Edit with `Read`, `rg`, `sed`, `Edit` on the file `cat` gave you. No state dir, no checkout,
no sync record — delete the tmp file whenever, lose nothing.

Refs: `ep3` · `ep3/Tavern Night` · `ep3#tavern-night` (passage holding that scene) ·
`ep3:a_8f21` (asset) · `ep3@37` (old rev, read only).

## The receipt

`cat` stamp front matter. That is how `put` know what you started from:

```markdown
---
story: ep3
passage: Tavern Night
rev: 42
hash: 9f31c8a2
---
mood: tense
--
[scene]
id: tavern-night
```

Leave `story`, `rev`, `hash` alone. Edit `name:`, `tags:`, `at:` to rename, retag, move the
passage. Everything below front matter is the passage text.

## Staleness

`put` compare the stamped hash against that passage **now**:

| Server state | `put` does |
|---|---|
| nothing moved | write |
| other passages changed | write — their edits survive, yours land |
| this passage changed | stop, exit 3, print who and diff |

So an unrelated concurrent edit never block you, and a real collision never silently win.
`twine-cli check tmp/p.md` run the same test read-only — use it before a long edit.

Long edit session: `check` first, then `cat --refresh` if stale.

## Two rules

1. **Writes go through CLI** — `put`, `restore`, `copy`, `rm`. Reading `data/` direct is fine
   and fast; CLI do it for you.
2. **Lint before put.** Exit 5 = scene, link or asset ref need fix. Clean lint = work done.

## Assets = real paths

```sh
twine-cli assets ep3 --scene tavern-night   # what scene needs, resolved
twine-cli assets ep3 --missing              # referenced, no blob
twine-cli assets ep3 --unused               # in manifest, nothing use it
```

Local mode print the store blob path. Read it direct — feed to image model, compare frames.

`--scene` resolve `bg:` + props + only the character frames the scene actually name. Print
path, or reason there is none.

**Add art:** `twine-cli put ep3:tavern-dawn tmp/new.webp --kind bg`. Unknown name = create,
assign id, update manifest. Then point the scene at it: `bg: tavern-dawn`.

**Add passage:** `twine-cli put ep3/"Signal Fire" tmp/s.txt --new`. Plain text, no receipt —
nothing was handed out yet. Front matter optional, sets `tags:`/`at:` when present.

**Characters cannot be made by CLI.** A scene with `cast:` needs its character to exist
already (the editor rigs them). `lint` flag it when missing.

## How big

`map` header carry token estimate. Under ~50k: `cat ep3 --all -o tmp/ep3/` and read
everything. Over: use map tables and `twine-cli graph ep3 --format tree` to pick few passages.

## Exit codes

`0` ok · `1` not found · `2` usage or ambiguous ref · `3` conflict · `4` server unreachable or
token rejected · `5` lint errors.

## More

- `references/commands.md` — all fifteen commands, flags, refs
- `references/recipes.md` — copy episode, retheme scene, generate missing art, rescue old rev
