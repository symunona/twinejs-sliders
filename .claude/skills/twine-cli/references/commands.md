# twine-cli — command reference

Global flags on everything: `--server`, `--token`, `--profile`, `--json` (JSONL),
`--full`, `--brief`, `--budget` (50k tokens), `--max-tokens` (6k per output), `--limit`,
`--offset`, `-o/--out`, `--dry-run`, `--yes`, `-q/--quiet`.

Under the budget the CLI prints bodies; over it, summaries and cache paths. `--full` and
`--brief` force one call either way. `twine-cli size <ref>` says which mode a story is in.

## Session and server

| Command | Does |
|---|---|
| `use <story> [--global]` | pin a story for `.` refs |
| `where` | pinned story, server, walk cursor |
| `ping` | version, counts, socket state, connected clients |
| `login [--server URL]` | store a token in the profile (0600) |
| `watch [--story <ref>]` | tail the websocket as JSONL |
| `ref <ref>` | resolve one ref; print canonical form and cache path |
| `cache path <ref>` · `cache clear` | where things land; empty it |

## Stories

| Command | Does |
|---|---|
| `ls [--all] [--deleted] [--sort rev\|name\|bytes]` | the index, one line per story, with size estimates |
| `size [<ref>]` | est tokens, bytes, passages, scenes, mode, cached or not |
| `story show <ref>` | rev, counts, scene ids, asset totals, lint tally |
| `story copy <src> --name "<n>" [--reid <prefix>] [--assets copy\|link\|none] [--passages <glob>]` | see SKILL.md |
| `story new --name "<n>" [--from-template <ref>]` | |
| `story rename <ref> --name "<n>"` | |
| `story rm <ref> [--purge] --yes` | tombstone, or erase |
| `story revs <ref>` | rev, when, who, bytes, passages, `restoredFrom` |
| `story get <ref>[@rev] [-o path]` | raw JSON body to a file; prints the path |
| `story text <ref> [--scenes-only\|--prose-only] [-o path]` | the whole story as readable text — `## Passage` headers and bodies, no JSON noise |
| `story diff <refA> <refB>` | hunks in full mode; names with `+n/−n` in brief |
| `story restore <ref> --rev N` | prints new rev and `missingAssets` |
| `story stat <ref>` | bytes, passages, scenes, beats, words, assets, orphans |
| `lint [<ref>] [--fix]` | see below |

## Passages

| Command | Does |
|---|---|
| `passage ls [<story>] [--tag t] [--scenes] [--orphans]` | ref, name, tags, lines, scene id, out-degree |
| `passage show <ref>` | the whole passage plus a header of ref, tags, links, scene id. Brief mode stops at the header |
| `passage get <ref> [-o path]` | full text to a file, when you want it on disk |
| `passage cat <ref>... [--tag t] [--glob g]` | several passages in full, one after another |
| `passage new <story>/<name> [--tags] [--from-file f] [--at x,y]` | |
| `passage set <ref> --from-file f` | replace text |
| `passage rename <ref> --name "<n>" [--rewrite-links]` | fixes `[[link]]` and `links: to:` |
| `passage rm <ref> --yes` | |
| `passage links <ref>` · `passage backlinks <ref>` | with broken-target flags |
| `grep <pattern> [<story>] [--scope prose\|scene\|vars\|links\|all] [-i] [-C n]` | `story/passage:12: line` |

## Scenes

| Command | Does |
|---|---|
| `scene ls [<story>]` | id, passage, cast/beat counts, `from:`, marks, errors |
| `scene show <ref>` | summary header, then the YAML block. Brief mode stops at the header |
| `scene get <ref> [-o path]` | the YAML. Spills to a path only past `--max-tokens` |
| `scene set <ref> --from-file f` | replace the block |
| `scene new <story>/<passage> --id <id> [--from <ref>] [--bg <asset>]` | |
| `scene rm <ref> [--keep-passage]` | |
| `scene reid <ref> --id <new>` | rewrites every `from:` and `@mark` too |
| `scene beats <ref>` | numbered, one line each |
| `scene states <ref>` | compiled state sequence with per-state changes |
| `scene diff <refA> <refB>` | stage diff: added/removed/moved entities |
| `scene lint <ref>` | parse + cross-passage errors for one scene |

### Field edits (any ref, any depth)

| Command | Example |
|---|---|
| `get <ref>` | `twine-cli get '.#s/cast/mira'` |
| `set <ref> <value>` | `twine-cli set '.#s/cast/mira/at' -- -0.25` |
| `set <ref> --json <j>` | `twine-cli set '.#s/cast/mira' --json '{"at":-0.25,"frame":"angry"}'` |
| `add <ref> --json <j>` | `twine-cli add '.#s/beats' --json '{"mira":"And yet."}'` |
| `rm <ref>` | `twine-cli rm '.#s/props/candle'` |
| `mv <ref> <ref>` | `twine-cli mv '.#s/beats/5' '.#s/beats/2'` |

Illegal keys are exit 2 with a "did you mean…" suggestion from the schema.

## Assets and characters

| Command | Does |
|---|---|
| `asset ls [<story>] [--kind bg\|object\|frame\|fx] [--tag t] [--unused] [--missing]` | |
| `asset ls --scene <ref> [--all-frames] [--paths] [--json]` | what a scene needs |
| `asset ls --passage <ref>` | every scene in a passage |
| `asset get <ref> [-o path]` | downloads; prints the path. Never bytes on stdout |
| `asset put <story> <file> [--kind] [--name] [--tags]` | prints the new asset ref |
| `asset rm <story>:<id> [--force]` | refuses while referenced; lists referrers |
| `asset where <story>:<id>` | scenes and passages using it |
| `asset diff <story>` | what the server is missing / has / has stale |
| `asset gc <story> [--dry-run]` | unreferenced manifest entries and unnamed blobs |
| `char ls [<story>]` · `char show <ref>` · `char frames <ref> [-o dir]` | |

## Walking

| Command | Does |
|---|---|
| `walk <story> [--from <passage>] [--order links\|name\|created]` | start; print node 1 |
| `next [n]` · `prev` · `goto <ref>` · `walk --reset` | move the cursor |
| `walk --list` | the itinerary as refs only |
| `graph <story> [--format tree\|dot\|jsonl] [--depth n] [--from <ref>]` | the link graph |

## Working copy

| Command | Does |
|---|---|
| `checkout <story> [dir] [--assets\|--no-assets] [--rev N]` | explode into files |
| `status [dir]` | local changes vs server changes |
| `pull [dir] [--force]` | re-fetch; refuses over local edits |
| `push [dir] [--message m]` | reassemble, `PUT` with `If-Match`, print the new rev |

Layout: `passages/*.md` (source of truth), `scenes/*.yaml` (derived, splices back on push),
`assets/`, `characters/`, `STORY.md` (the map), `.twine/` (rev, etag, hashes).
Both a passage and its scene file edited since pull = conflict, exit 3, nothing written.

## Lint tiers

YAML parse and unknown keys · duplicate scene ids, unknown `from:`, unknown `@mark`,
`from:` cycles · links to missing passages, unreachable passages, scene passages whose only
exit is a `[[link]]` outside the block · unknown assets, manifest entries with no blob,
orphan blobs. Exit 5 on any error. `--fix` only does the mechanical ones.

## Exit codes

`0` ok · `1` not found · `2` usage / ambiguous ref / invalid edit · `3` conflict (rev
moved) · `4` server unreachable or auth rejected · `5` lint errors.
