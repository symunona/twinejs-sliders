---
name: twine-cli
description: Read and edit Sliders/Twine stories on the story-store server from the terminal — list stories, walk passages, inspect and edit scene YAML, resolve which assets a scene needs, copy a story to a new one, lint before pushing. Use whenever a task touches a story that lives on the server (twine-story-store, twine-store.tmpx.space, "the story store", "the library") instead of a local .twee/.html file, or when asked to copy an episode, move a character, change a beat, swap a background, or find where an asset is used. Loads the ref grammar and the context-budget rules for the twine-cli tool.
---

# twine-cli

Terminal client for the Sliders story store. Spec: `docs/sliders/12-story-cli.md`.
Server API: `docs/sliders/11-server-storage.md`. Scene YAML: `docs/sliders/02-sliders-format.md`.

## The one rule

**Never read a story whole.** A story is one JSON body up to 32 MB. Do not `curl` the API,
do not `cat story.json`, do not `jq .` a body. Use the map commands to find the two or
three passages that matter, then read only those.

The tool enforces this and you should rely on it:

- Lists cap at 40 rows and print `… N more — --offset 40`. Ask for the next page only if
  you actually need it.
- Anything over 120 lines is written to a file and the **path** is printed. Read the path,
  or `sed -n '40,80p'` it. `-p` forces stdout — use it only for small things.
- `--json` is JSONL, one record per line. Pipe it to `head`/`grep`/`jq -c`.
- Every output row starts with a **ref** that is valid input to the next command. The
  output is your index.

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
twine-cli ls                       # stories, one line each — no bodies fetched
twine-cli use ep3                  # pin it
twine-cli story show .             # counts, scene ids, lint tally. Still no bodies
```

Then pick a lane:

| You need to | Do |
|---|---|
| Find something by text | `twine-cli grep 'mira' . --scope scene` → `story/passage:line` refs |
| See the shape of the episode | `twine-cli graph . --format tree --depth 3` |
| Go through it node by node | `twine-cli walk .` then `twine-cli next` — one passage per call |
| Understand one scene | `twine-cli scene show '.#tavern-night'` (summary, not YAML) |
| Read the actual YAML | `twine-cli scene get '.#tavern-night'` — prints, or gives a path |
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
