# twine-cli — every command

Global: `--data <dir>`, `--server`, `--token`, `--profile`, `--json` (JSONL), `--yes`, `-q`.

CLI in **local mode** when it see store `DATA_DIR`. Then reads come off disk, no HTTP, and
assets are symlinks not downloads. `ping` say which mode. Writes always go over HTTP.

## Move stories

| Command | Does |
|---|---|
| `checkout <story>[@rev] [dir] [--passages <glob>] [--copy-assets]` | decode story to working copy |
| `status [dir]` | local changes, server changes since checkout, new asset files, missing or changed blobs |
| `push [dir] [--dry-run] [--no-rewrite-links] [--strict]` | reassemble, upload new assets, `PUT` with `If-Match` |
| `pull [dir] [--force]` | re-decode at server rev; refuse over local edits |

`--copy-assets` = real copies not symlinks. For checkout you zip, move to other machine, or
keep after story change.

`push` order: bytes → manifest → story. Rejected push leave nothing behind.

## Look

| Command | Does |
|---|---|
| `ping` | mode, server version, story count, connected clients |
| `ls [--deleted] [--sort rev\|name\|bytes]` | one line per story: ref, name, rev, passages, assets, bytes, est tokens |
| `assets [dir\|<story>] [--scene <id>] [--all-frames] [--unused] [--missing] [--json]` | what exists, or what scene needs, with paths |
| `graph [dir\|<story>] [--format tree\|dot\|jsonl] [--from <passage>] [--depth n]` | link graph |
| `revs <story>` | rev, when, who, bytes, passages, `restoredFrom` |
| `lint [dir\|<story>] [--fix]` | `file:line: message`; exit 5 on errors |

Content live in working copy: `Read`, `rg`, `sed` cover passages, scenes, beats, searches.
Everything here except `checkout`/`status`/`push`/`pull` take story ref too — only editing
passage text need a decode.

## Change the store

| Command | Does |
|---|---|
| `copy <story>[@rev] --name "<n>" [--reid <prefix>] [--assets copy\|link\|none]` | server-side clone: new id, new ifid, new passage ids |
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
   whose only exit is `[[link]]` *outside* block (spec 02: never drawn).
4. **Assets** — refs to unknown assets, manifest entries with no blob, orphan blobs.

`--fix` do mechanical ones: prune unreferenced manifest entries, normalise `at:` format. Broken
links wait for human.

## Refs

Ref = a story: uuid, name, or unambiguous slug (`chapter-3` → `Chapter 3`). Ambiguous = exit 2
plus candidate list. Two suffixes:

- `<story>@<rev>` — `checkout`, `copy`, `revs`
- `<story>#<sceneId>` — `assets --scene`, `lint`

Quote anything with spaces or `#`.

## Exit codes

`0` ok · `1` not found · `2` usage or ambiguous ref · `3` conflict (rev moved, or `--strict` hit
advisory lock) · `4` server unreachable or token rejected · `5` lint errors.
