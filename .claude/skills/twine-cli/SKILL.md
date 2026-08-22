---
name: twine-cli
description: Read and edit Sliders/Twine stories on the story-store server from the terminal — list stories, walk passages, inspect and edit scene YAML, resolve which assets a scene needs, copy a story to a new one, lint before pushing. Use whenever a task touches a story that lives on the server (twine-story-store, twine-store.tmpx.space, "the story store", "the library") instead of a local .twee/.html file, or when asked to copy an episode, move a character, change a beat, swap a background, or find where an asset is used. Loads the ref grammar and the context-budget rules for the twine-cli tool.
---

# twine-cli

Terminal client for the Sliders story store. Spec: `docs/sliders/12-story-cli.md`.
Server API: `docs/sliders/11-server-storage.md`. Scene YAML: `docs/sliders/02-sliders-format.md`.

## Size first, then read freely

Most stories are small. A 40-passage episode is ~15k tokens — read it whole, that is the
fastest way to understand it. Don't ritually summarise something that fits.

```sh
twine-cli size .          # ep3  62 KB  40 passages  12 scenes  ~15k tokens  full
```

| Estimate | Mode | What the CLI does by default |
|---|---|---|
| **< 50k tokens** | `full` | prints bodies — whole passages, whole scene YAML, unpaged lists. `story text` hands over the entire episode |
| **≥ 50k tokens** | `brief` | summaries, cache paths instead of bodies, lists page at 40. `--full` on any call overrides |

It decides for you and says so on stderr when it guards:

```
note: ep3 ≈ 78k tokens (412 KB, 190 passages) — brief mode. --full for whole bodies.
```

Silence = full mode. `GET /stories` carries `bytes`, so `twine-cli ls` shows every story's
estimate without downloading anything.

**On a small story, just read it.** `twine-cli story text .` → the whole episode as
readable text, `## Passage name` headers and bodies, no JSON noise. `twine-cli passage cat
. --tag act1` for a slice.

**On a large story, use the map**: `grep`, `graph --format tree`, `scene ls` to find the
three passages that matter, then `passage show --full` on those, or `walk`/`next` to go
node by node.

Whatever the mode:

- A single output never exceeds `--max-tokens` (default 6k, ≈600 lines). Past that it spills
  to a cache file and prints the **path** — read the path.
- Nothing truncates silently. `… 132 more — --offset 40` means there is more.
- Every row starts with a **ref** that is valid input to the next command.
- `--json` is JSONL: pipe it to `head`, `grep`, `jq -c`.

Never `curl` the API or `jq .` a story body — that is the raw JSON, mostly passage
positions and ids. `story text` is the same content at a third the size.

## Refs

```
<story>                    ep3 · "Chapter 3" · .          . = the pinned story
<story>/<passage>          .../Tavern Fight
<story>#<scene>            .#tavern-night                  scene ids are unique per story
<story>#<scene>/<path>     .#tavern-night/cast/mira/at     the path IS the YAML shape
<story>@<rev>              .@41                            read-only
<story>#<scene>@<mark>     .#tavern-night@tense            a compiled state
<story>:<id>               .:a_8f21 (asset) · .:mira (character)
```

Pin once with `twine-cli use <story>`, then say `.` everywhere. Quote refs containing
spaces or `#`.

## Start every session this way

```sh
twine-cli ping                     # server up? who else is connected?
twine-cli ls                       # stories + their size estimates, no bodies fetched
twine-cli use ep3                  # pin it
twine-cli size .                   # full or brief? decides how you read
twine-cli story show .             # counts, scene ids, lint tally
```

Then pick a lane:

| You need to | Do |
|---|---|
| Read a small story | `twine-cli story text .` — the whole thing, readable |
| Read a few passages | `twine-cli passage show <ref>` (full text) or `passage cat` |
| Find something by text | `twine-cli grep 'mira' . --scope scene` → `story/passage:line` refs |
| See the shape of the episode | `twine-cli graph . --format tree --depth 3` |
| Go through a big one node by node | `twine-cli walk .` then `twine-cli next` |
| Understand one scene | `twine-cli scene show '.#tavern-night'` — summary + its YAML |
| Know what art it needs | `twine-cli asset ls --scene '.#tavern-night'` |
| Look at that art | add `--paths`, then Read the printed paths |

## Editing

One verb family over the whole ref space — `get`, `set`, `add`, `rm`, `mv`:

```sh
twine-cli set '.#tavern-night/cast/mira/at' -- -0.25
twine-cli set '.#tavern-night/cast/mira' --json '{"at":-0.25,"frame":"angry"}'
twine-cli add '.#tavern-night/beats' --json '{"mira":"And yet."}'
twine-cli mv  '.#tavern-night/beats/5' '.#tavern-night/beats/2'
twine-cli rm  '.#tavern-night/props/candle'
```

Edits are surgical text edits on the passage — comments and formatting survive. Rules:

1. `--dry-run` first when the edit is structural (moving beats, removing entities). It
   prints the diff and changes nothing.
2. **`twine-cli lint .` after every batch of edits.** Exit 5 means you broke something.
   That is the verification step; do not report success without it.
3. Exit 3 = someone else moved the rev. Re-read, re-apply. Never `--force` unasked.
4. For many edits in one story, `twine-cli checkout . tmp/ep3` → edit files with normal
   tools → `twine-cli status` → `twine-cli push`. Cheaper than forty round trips.

Put working copies and downloaded assets under `tmp/`.

## Copying a story

```sh
twine-cli story copy ep3 --name "Episode 4"                    # full clone, assets copied
twine-cli story copy ep3 --name "Ep4" --reid ep4- --assets copy
twine-cli story copy ep3@37 --name "Ep3 rescue"                # from an old revision
```

New story id, new IFID, new passage ids. Scene ids are kept unless `--reid`, which also
rewrites every `from:` and `@mark`. It prints the new ref and anything it could not
rewrite — read that line.

## Exit codes

`0` ok · `1` not found · `2` bad usage or ambiguous ref · `3` conflict, rev moved ·
`4` server unreachable or token rejected · `5` lint errors.

## More

- `references/commands.md` — every command and flag
- `references/refs.md` — the ref grammar in full, resolution order, sub-paths
- `references/recipes.md` — walkthroughs: audit an episode, retheme a scene, find unused art, rescue an old rev
