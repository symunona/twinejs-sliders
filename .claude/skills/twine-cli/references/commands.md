# twine-cli — every command

Global flags: `--data <dir>`, `--server`, `--token`, `--profile`, `--json` (JSONL),
`--yes`, `-q`.

The CLI is in **local mode** when it can see the store's `DATA_DIR` — then reads come off
disk with no HTTP and assets are symlinked rather than downloaded. `ping` says which mode
it is in. Writes always go over HTTP either way.

## Moving stories

| Command | Does |
|---|---|
| `checkout <story>[@rev] [dir] [--copy-assets]` | explode a story into a working copy |
| `status [dir]` | local changes, server changes since checkout, new asset files, missing or changed blobs |
| `push [dir] [--dry-run] [--no-rewrite-links] [--strict]` | reassemble, upload new assets, `PUT` with `If-Match` |
| `pull [dir] [--force]` | re-explode at the server's rev; refuses over local edits |

`--copy-assets` makes real copies instead of symlinks — for a checkout you will zip, move
to another machine, or keep after the story changes.

`push` order is bytes → manifest → story, so a rejected push leaves nothing behind.

## Looking

| Command | Does |
|---|---|
| `ping` | mode, server version, story count, connected clients |
| `ls [--deleted] [--sort rev\|name\|bytes]` | one line per story: ref, name, rev, passages, assets, bytes, est tokens |
| `assets [dir] [--scene <id>] [--all-frames] [--unused] [--missing] [--json]` | what exists, or what a scene needs, with paths |
| `graph [dir] [--format tree\|dot\|jsonl] [--from <passage>] [--depth n]` | the link graph |
| `revs <story>` | rev, when, who, bytes, passages, `restoredFrom` |
| `lint [dir\|<story>] [--fix]` | `file:line: message`; exit 5 on errors |

Content lives in the working copy: `Read`, `rg` and `sed` cover passages, scenes, beats and
searches.

## Changing the store

| Command | Does |
|---|---|
| `copy <story>[@rev] --name "<n>" [--reid <prefix>] [--assets copy\|link\|none]` | server-side clone: new id, new ifid, new passage ids |
| `new --name "<n>"` | empty story |
| `rm <story> [--purge] --yes` | tombstone, or erase |
| `restore <story> --rev N` | new revision from an old one; prints `missingAssets` |
| `login [--server URL]` | store a token in the profile, 0600 |

`--reid` rewrites scene ids **and** every `from:` and `@mark` that referenced them. A copy
keeps its scene ids by default, which is fine — ids are unique within a story, not across.

`--assets copy` (the default) gives the new story its own blobs. `--assets link` shares the
source's, which the janitor reclaims once nothing names them — use it when you mean it.

## Lint tiers

1. **YAML** — parse errors, unknown keys with suggestions, bad coordinates.
2. **Cross-passage** — duplicate scene ids, unknown `from:`, unknown `@mark`, `from:` cycles.
3. **Story graph** — links to passages that do not exist, unreachable passages, and a scene
   passage whose only exit is a `[[link]]` *outside* the block (spec 02: it is never drawn).
4. **Assets** — references to unknown assets, manifest entries with no blob, orphan blobs.

`--fix` handles the mechanical ones: prune unreferenced manifest entries, normalise `at:`
formatting. Broken links stay for a human to decide.

## Refs

A ref is a story: its uuid, its name, or an unambiguous slug (`chapter-3` → `Chapter 3`).
Ambiguity is exit 2 with the candidates listed. Two suffixes exist:

- `<story>@<rev>` — for `checkout`, `copy`, `revs`
- `<story>#<sceneId>` — for `assets --scene`, `lint`

Quote anything with spaces or `#`.

## Exit codes

`0` ok · `1` not found · `2` usage or ambiguous ref · `3` conflict (rev moved, or `--strict`
hit an advisory lock) · `4` server unreachable or token rejected · `5` lint errors.
