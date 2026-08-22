# 12 — `twine-cli`, the terminal interface to the story store

A command-line client for the server in [`11-server-storage.md`](11-server-storage.md),
built for a coding agent first and a human second.

The whole design is one sentence: **check the story out as files, work on the files, push.**

A working copy turns a story into a directory — one file per passage, the scene YAML inside
it, the art beside it under readable names. From there an agent uses what it already knows:
read a file, grep a tree, edit a line, look at an image. The CLI does the four things files
cannot do for themselves — **move stories between the server and the disk, resolve what a
scene needs, check that the result is valid, and talk to the store about history.**

Fifteen commands, and you will type four of them.

---

## 0 — How the CLI reaches the data

The store keeps plain files (spec 11):

```
data/stories/79d06063-0d0d-4cb1-bf6f-d9d61272d41b/
  story.json      the body, verbatim minus `sync`
  meta.json       rev, ifid, name, cached counts, hash      ← this is the index
  assets.json     the manifest
  assets/         a_1f0e.webp, a_3450.webp …  real files, real extensions
  revs/           000001.json.gz, 000001.assets.gz …
```

On taskbot that directory sits next to the CLI, owned by the same user, so **reads take the
short path**: `ls` reads the `meta.json` files, `checkout` reads `story.json`, older
revisions come out of `revs/`, and asset blobs are already at a path on disk. Nothing is
downloaded, cached or copied.

This is sound because the server writes by temp-file + rename: a reader sees either the
whole previous version or the whole new one, so there is nothing to lock against.

**Writes go through the API** — `push`, `restore`, `copy` and `rm` are the four commands
that write, and each one is an HTTP request to the store. That is what bumps `rev`,
snapshots the old body into `revs/`, announces the change on the websocket so every open
editor updates, serialises against a concurrent autosave, and refreshes the cached counts
in `meta.json`. One request to loopback buys all five.

### Local mode

The CLI is in local mode when it can see the store's `DATA_DIR`. It finds it from, in
order: `--data <dir>`, `TWINE_DATA`, `dataDir` in the profile, or — when the configured
server is a loopback address — the `DATA_DIR` of the `.env` beside the server binary.
`twine-cli ping` reports which mode it is in.

Local mode is an optimisation, not a second personality: a remote store answers the same
commands over HTTP, and the working copy that comes out is byte-identical.

---

## 1 — The commands

```
twine-cli <cmd> [args] [flags]
```

Global: `--data`, `--server`, `--token`, `--profile`, `--json`, `--yes`, `-q`.

| # | Command | Does |
|---|---|---|
| 1 | `ping` | mode (local/remote), server version, story count, who else is connected |
| 2 | `login [--server URL]` | store a token in the profile, 0600 |
| 3 | `ls [--deleted] [--sort rev\|name\|bytes]` | one line per story: ref, name, rev, passages, assets, size, est tokens |
| 4 | `checkout <story> [dir] [--rev N] [--copy-assets]` | explode a story into a working copy — §2 |
| 5 | `status [dir]` | what changed locally, what changed on the server, new asset files, missing or changed blobs |
| 6 | `push [dir]` | reassemble, upload, `PUT` with `If-Match` — §3 |
| 7 | `pull [dir] [--force]` | re-explode at the server's rev; keeps local edits safe unless `--force` |
| 8 | `lint [dir\|<story>] [--fix]` | scene YAML, cross-passage, link graph, assets — §5 |
| 9 | `assets [dir] [--scene <id>] [--unused] [--missing]` | what exists, and what a scene needs, with real paths — §4 |
| 10 | `graph [dir] [--format tree\|dot\|jsonl] [--from <passage>] [--depth n]` | the link graph, derived from the passage text |
| 11 | `copy <story> --name "<n>" [--reid <prefix>] [--assets copy\|link\|none]` | server-side clone — §6 |
| 12 | `new --name "<n>"` | empty story, new ifid |
| 13 | `rm <story> [--purge] --yes` | tombstone, or erase |
| 14 | `revs <story>` | rev, when, who, bytes, passages, `restoredFrom` |
| 15 | `restore <story> --rev N` | `POST /restore`; prints the new rev and any `missingAssets` |

Reading and editing content happens in the working copy with `Read`, `rg`, `sed` and
`Edit` — the tools an agent is already fluent in, on files that are already on disk.

A **ref** is a story: its uuid, its name, or an unambiguous slug (`chapter-3` finds
`Chapter 3`). Ambiguity is answered with the candidate list and exit 2. Two suffixed forms
appear as arguments: `<story>@<rev>` for `checkout`, `copy` and `revs`, and
`<story>#<sceneId>` for `assets --scene` and `lint`, because a scene id is unique inside a
story and is what the YAML calls itself. That is the entire grammar.

---

## 2 — The working copy

```
tmp/ep3/
  STORY.md                                   read this first
  passages/
    001-start.md
    003-tavern-night.md
  assets/
    bg/tavern-night.a_8f21.webp              -> …/data/stories/<id>/assets/a_8f21.webp
    obj/candle.a_44de.webp                   -> …
    char/desert-punk/idle.a_3450.webp        -> …
  characters/
    desert-punk.yaml
  .twine/
    ref.json        server, story id, rev, etag, mode, client id
    story.json      the body exactly as pulled — the round-trip reference
    assets.json     the manifest as pulled
    index.json      passage file -> {id, hash at checkout}, asset id -> {path, hash}
```

### Passages

One file per passage, holding the whole passage text. The `[scene]` block stays where the
author wrote it, inside the passage, so each passage has exactly one source of truth and an
edit lands in the same place a person would have made it.

```markdown
---
name: Tavern Night
tags: [act1, scene]
at: [420, 260]
---
mood: tense
--
[scene]
id: tavern-night
bg: tavern/night
cast:
  mira: {at: -0.4, frame: arms-crossed}
beats:
  - mira: "You shouldn't have come back."
```

The front matter carries the three things an author changes: `name`, `tags`, `at`. The
passage's id, size and every field a future Twine adds live in `.twine/story.json` and are
carried through untouched. `name` is the truth; the filename is cosmetic, `NNN-slug.md` in
the story's own passage order, so a directory listing reads in the order the story was
built.

Creating a file creates a passage. Deleting one deletes it. Editing `name:` renames the
passage, and `push` follows the rename through every `[[link]]` and `links: to:` that
pointed at it, unless you pass `--no-rewrite-links`.

### Assets

The blobs are already on disk under their ids, so the working copy lays a readable name
over them as **relative symlinks**, by kind:

```
assets/bg/…      assets/obj/…      assets/fx/…      assets/char/<character>/<frame>.<id>.<ext>
```

The name comes from the manifest (`desert-punk/idle`), the id stays in the filename so it
survives a rename, and the target is the store's own file — a checkout of a 2.3 MB library
is instant and costs no disk. Read one, hand its path to an image model, write a new one
next to it.

`--copy-assets` makes real copies, for a checkout you intend to zip, move to another
machine, or keep after the story moves on. Remote stores copy as well; the layout is
identical either way, so everything downstream is unaffected.

Asset ids are identity rather than content (spec 03), and the janitor reclaims blobs the
manifest stops naming after `ORPHAN_TTL`. `.twine/index.json` records each blob's hash at
checkout, so `status` reports `changed` and `vanished` up front.

### `STORY.md`

Generated, regenerated by `checkout`, `pull` and `status`. It is the map — the one file to
read before deciding anything:

```markdown
# Trip to my Desert
ep3 · rev 42 · 4 passages · 10 assets (2.3 MB) · ~15k tokens · local · clean

## Passages
| file | name | lines | scene | links to |
|---|---|---|---|---|
| passages/001-start.md | Start | 22 | — | Tavern Night, Street |
| passages/003-tavern-night.md:12 | Tavern Night | 48 | tavern-night | Tavern Fight, Street |

## Scenes
| scene | at | from | cast | beats | marks |
|---|---|---|---|---|---|
| tavern-night | passages/003-tavern-night.md:12 | — | mira, joren | 7 | tense |

## Assets
10 assets, 2.3 MB — 4 bg, 5 frame, 1 object. 1 unused, 0 missing.

## Lint
2 warnings, 0 errors — see `twine-cli lint`.
```

The scene table carries `file:line`, so opening scene `tavern-night` is a `Read` with an
offset. The token estimate is `chars / 4` over the passage text: under 50k, reading the
whole `passages/` directory is a good move and the header says so; over it, the tables are
how you pick the three files that matter.

---

## 3 — Push

1. **Rebuild the body.** Take `.twine/story.json`, replace each passage's `text`, `name`,
   `tags` and position from its file, add passages for new files, drop passages for deleted
   ones. Every other field, known or unknown, comes through from the stored object — a
   checkout followed immediately by a push is a byte-identical no-op, and a test says so.
2. **Upload new art.** Any asset file whose name carries no id is one you added: the CLI
   assigns an id, `PUT`s the bytes with `X-Asset-Hash`, renames the file to
   `<name>.<id>.<ext>`, and adds the manifest entry with `kind` from the directory and
   `name` from the filename.
3. **Publish.** `PUT` the manifest if it changed, then `PUT` the story with
   `If-Match: "<rev>"`.

Bytes before manifest before story, so a client pulling mid-push always sees a manifest
whose blobs exist — the order `checkout-story.ts` already uses in the browser. The story
`PUT` going last also means a rejected push leaves the store exactly as it was.

`--dry-run` prints the plan. A **412 is exit 3**: the CLI prints the rev it holds, the rev
the server has, who wrote it, and the two ways forward — check the server's rev out into a
second directory and compare, or `pull --force` to take theirs.

---

## 4 — `assets`

Two questions, one command.

**What is here** — `twine-cli assets tmp/ep3`:

```
a_8f21  bg      tavern-night        1280x720  184 KB  assets/bg/tavern-night.a_8f21.webp
a_3450  frame   desert-punk/idle    1344x768  118 KB  assets/char/desert-punk/idle.a_3450.webp
a_9002  object  candle               256x256   12 KB  assets/obj/candle.a_9002.webp   unused
```

**What a scene needs** — `twine-cli assets tmp/ep3 --scene tavern-night`. This resolution is
the real work behind the command:

1. `bg:` → an asset id.
2. every `props:` entry → its `ref` (defaulting to the key) → an asset id.
3. every `cast:` entry → a **character** → the frames the scene actually names: the
   entity's `frame:`, any `frame:` in a beat patch, and the character's default.
   `--all-frames` widens it to the whole character.
4. `fx:` entries that are asset-backed.
5. if `from:` is set, the same walk over the inherited scene, marked `inherited`.

```
a_8f21  bg              assets/bg/tavern-night.a_8f21.webp            bg:
a_11c0  frame  mira     assets/char/mira/arms-crossed.a_11c0.webp     cast/mira
a_44de  frame  mira     MISSING BLOB                                  beats/2 patch frame: angry
—       object candle   NOT IN MANIFEST                               props/candle
```

Every row is a path or the reason there isn't one yet, so "look at what this scene uses" is
one command and three `Read`s, and "generate the one that's missing" has both the gap and
the place to put the result.

`--json` gives `{id, kind, name, via, path, bytes, hash, present}` per line. `--missing` and
`--unused` filter to the two answers worth acting on.

---

## 5 — `lint`

The verification step after any edit, and what decides whether a working copy is ready to
push. Four tiers, each already implemented in a package:

| Tier | From | Catches |
|---|---|---|
| YAML | `@sliders/scene-schema` | parse errors, unknown keys with `keyHint()` suggestions, bad coordinates |
| Cross-passage | `@sliders/scene-index` | duplicate scene ids, unknown `from:`, unknown `@mark`, `from:` cycles |
| Story graph | `scanLinkTargets` + passage names | links to passages that do not exist, unreachable passages, and a scene passage whose only exit is a `[[link]]` outside the block — spec 02: that link is never drawn |
| Assets | manifest + blobs | scene references to unknown assets, manifest entries with no blob, blobs nothing names |

Output is `file:line: message`, which every editor and every agent already knows how to
open. Exit 5 on any error, 0 with warnings printed. `--fix` handles the mechanical ones:
prune manifest entries nothing references, normalise `at:` through `scene-edit.formatAt`.
Broken links stay for a human to decide.

`lint <story>` runs against the server for a quick check without a checkout.

---

## 6 — `copy`

`twine-cli copy ep3 --name "Episode 4"` — server-side, no checkout needed.

| Thing | What happens | Why |
|---|---|---|
| story `id` | new uuid | it is a new story |
| `ifid` | new uuid | an IFID is stable across import/export of *the same* story; a copy is a different one |
| passage ids | new uuids | ids are per story, so a fresh set keeps every sync record honest |
| names, positions, tags, text | verbatim | |
| scene ids | kept, or rewritten by `--reid <prefix>` | ids are unique *within* a story (spec 02) and the index is per story, so two stories may share one. Rewriting is opt-in because it also rewrites every `from:` and `@mark` |
| assets | `--assets copy` (default), `link`, `none` | `copy` re-`PUT`s the blobs under the new story. `link` copies manifest entries and shares the source's blobs, which the janitor reclaims once nothing names them — available, warned about, opt-in |
| revisions | start fresh | the copy begins at rev 1 |

`copy ep3@37 --name "Ep3 rescue"` copies an old revision. It prints the new story's ref and
any reference it could not rewrite.

---

## 7 — Config and identity

`~/.config/twine-cli/config.json`, 0600:

```json
{
  "profile": "local",
  "profiles": {
    "local": {"server": "http://127.0.0.1:8080", "token": "…",
              "dataDir": "/home/symunona/dev/twinejs-sliders/server/data"},
    "prod":  {"server": "https://twine-story-store.tmpx.space", "token": "…"}
  },
  "clientId": "cli_9f31",
  "clientName": "twine-cli@taskbot"
}
```

`TWINE_STORE_URL`, `TWINE_STORE_TOKEN`, `TWINE_DATA`, `TWINE_PROFILE` override the file;
flags override the environment.

`clientId` is persisted, not per-process. It rides every request as `X-Client-Id`, so the
change bus skips the CLI's own writes when the same person has an editor open, and the
history list reads `twine-cli@taskbot`.

Locks are advisory (spec 11). `push` warns when another client is focused on a passage it is
about to change and goes ahead; `--strict` turns that into exit 3.

| Exit | Means |
|---|---|
| 0 | fine |
| 1 | not found |
| 2 | usage, or an ambiguous ref |
| 3 | conflict — the server's rev moved, or `--strict` hit a lock |
| 4 | server unreachable, or the token was rejected |
| 5 | lint errors |

---

## 8 — Building it

TypeScript, `packages/twine-cli`, bin `twine-cli`, Node 20, native `fetch`. The only new
runtime dependency is `yaml`, already in the tree.

It lives in this repo because everything that makes it more than `curl` is already here:
`@sliders/scene-schema` parses a scene, `@sliders/scene-index` resolves `from:` and marks
and finds the cross-passage errors, `@sliders/scene-core` compiles states,
`@sliders/asset-store` owns id and hash rules, `scanLinkTargets` reads the link graph. One
parser, shared by the editor, the runtime and the CLI.

```
packages/twine-cli/src/
  bin.ts          arg parse, profile, mode detection, exit codes
  source/         one interface, two implementations: local files, HTTP
  wc/             explode, STORY.md, index.json, reassemble, status, push
  assets.ts       the symlink farm and the per-scene resolution
  lint.ts         the four tiers, formatted as file:line
  cmd/            one small file per command
```

`source/` is the seam that keeps local mode honest: `checkout` and `ls` ask it for a body or
a manifest and never learn which side answered. The writing commands hold the HTTP client
directly, so going through the API is structural rather than a habit.

`src/store/persistence/server/client.ts` already speaks this API from the browser; the node
client shares its types and its `ServerError`, and both compile against `server.types.ts`,
which keeps them in step.

**Tiers.**

| Tier | Commands |
|---|---|
| **1** | `ping`, `ls`, `checkout`, `status`, `push`, `lint`, `assets` |
| **2** | `pull`, `copy`, `revs`, `restore`, `graph`, `new`, `rm`, `login` |
| **3** | `--fix`, `--reid`, `assets --all-frames`, `graph --format dot` |

**Tests.** Round-trip is the load-bearing one: check a fixture story out, push it back
unchanged, assert the body is byte-identical. Then edit one passage file and assert exactly
one passage differs. The rest run against a real server — `go run . --addr 127.0.0.1:0`
prints its port on the first line for exactly this, and the Playwright fixture already
proves the pattern. Local mode tests read a data directory that same server built.

---

## 9 — The skill

`.claude/skills/twine-cli/` teaches an agent the loop — checkout, read the map, edit files,
lint, push — plus the two facts it cannot infer: writes go through the CLI, and `assets/`
holds real paths meant to be read. `SKILL.md` is that loop; `references/commands.md` and
`references/recipes.md` hold the detail, loaded when needed.
