# twine-cli — every command

Global: `--data <dir>`, `--server`, `--token`, `--profile`, `--json` (JSONL), `--yes`, `-q`.

CLI in **local mode** when it see store `DATA_DIR`. Then reads come off disk, no HTTP, and
asset paths are the store blobs. `ping` say which mode. Writes always go over HTTP.

## Refs

| Form | Is |
|---|---|
| `ep3` | story: uuid, name, or unambiguous slug (`chapter-3` → `Chapter 3`) |
| `ep3/Tavern Night` | passage, by name or id prefix |
| `ep3#tavern-night` | passage holding that scene id |
| `ep3:a_8f21` · `ep3:tavern-dawn` | asset, by id or manifest name |
| `ep3@37` | story at old rev, read only |

Ambiguous = exit 2 plus candidate list. Quote refs with spaces or `#`.

## Text in, text out

| Command | Does |
|---|---|
| `map <story> [--json]` | passages, scene ids with in-passage line, links, asset summary, lint tally, token estimate |
| `cat <ref> [-o file] [--refresh]` | passage text with receipt front matter, or asset bytes |
| `cat <story> --all -o <dir>` | every passage, one file each, own receipt |
| `put <ref> <file>` | splice into current body, `PUT` with `If-Match` |
| `put <story> --all <dir> [--delete "<name>"]` | per passage, per hash check. Absence never delete |
| `put <ref> <file> --new` | passage that does not exist yet. Plain text file, no receipt needed. Front matter optional |
| `check <file\|dir>` | fresh / stale-elsewhere / conflict. Read only |

Receipt front matter = `story`, `passage`, `rev`, `hash`, plus editable `name`, `tags`, `at`.

`put` three-way test: hash match → write, even when rev moved for other passages. Hash differ
→ exit 3. 412 between read and write → retry once, then exit 3.

## Look

| Command | Does |
|---|---|
| `ping` | mode, server version, story count, connected clients |
| `ls [--deleted] [--sort rev\|name\|bytes]` | one line per story: ref, name, rev, passages, assets, bytes, est tokens |
| `assets <story> [--scene <id>] [--all-frames] [--unused] [--missing] [--fetch -o dir] [--json]` | what exists, or what a scene needs, with paths |
| `graph <story> [--format tree\|dot\|jsonl] [--from <passage>] [--depth n]` | link graph |
| `revs <story>` | rev, when, who, bytes, passages, `restoredFrom` |
| `lint [<story>\|<file>] [--after <file>] [--fix]` | `file:line: message`; exit 5 on errors |

`lint <file>` = YAML tier only, no server. `lint <story> --after <file>` = all four tiers as if
that file were pushed. Pre-flight.

## Change the store

| Command | Does |
|---|---|
| `copy <story>[@rev] --name "<n>" [--reid <prefix>] [--assets copy\|link\|none]` | server-side clone: new id, new ifid, new passage ids |
| `put <story>:<name> <file> --kind bg\|obj\|fx\|frame` | upload art; unknown name create it |
| `new --name "<n>"` | empty story |
| `rm <story> [--purge] --yes` | tombstone, or erase |
| `restore <story> --rev N` | new revision from old one; print `missingAssets` |
| `login [--server URL]` | store token in profile, 0600 |

`--reid` rewrite scene ids **and** every `from:` and `@mark` that referenced them. Copy keep
scene ids by default — fine, ids unique within story, not across.

`--assets copy` (default) give new story own blobs. `--assets link` share source blobs, janitor
reclaim once nothing name them — use when you mean it.

## Lint tiers

1. **YAML** — parse errors, unknown keys with suggestions, bad coordinates.
2. **Cross-passage** — duplicate scene ids, unknown `from:`, unknown `@mark`, `from:` cycles.
3. **Story graph** — links to passages that do not exist, unreachable passages, scene passage
   whose only exit is `[[link]]` *outside* the block (spec 02: never drawn).
4. **Assets** — refs to unknown assets, manifest entries with no blob, orphan blobs.

`--fix` do mechanical ones: prune unreferenced manifest entries, normalise `at:` format. Broken
links wait for human.

## Exit codes

`0` ok · `1` not found · `2` usage or ambiguous ref · `3` conflict (passage changed under you,
or `--strict` hit advisory lock) · `4` server unreachable or token rejected · `5` lint errors.
