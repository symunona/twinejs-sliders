# 12 — `twine-cli`, the terminal interface to the story store

A command-line client for the server in [`11-server-storage.md`](11-server-storage.md),
built for a coding agent first and a human second.

The whole design is one sentence: **check the story out as files, work on the files, push.**

Everything else follows from it. An agent already knows how to work in a directory — read a
file, grep a tree, edit a line, look at an image. Every command that would have wrapped
those in a bespoke verb (`passage show`, `scene get`, `grep`, `walk`, `set …/cast/mira/at`)
is a worse copy of a tool the agent already has. So the CLI does not have them. It does the
four things files cannot do for themselves: **move stories between the server and the disk,
resolve what a scene needs, check that the result is valid, and talk to the store about
history.**

Fifteen commands, and you will type four of them.

---

## 0 — Read direct, write through the API

The store's data directory is plain files (spec 11):

```
data/stories/79d06063-0d0d-4cb1-bf6f-d9d61272d41b/
  story.json      the body, verbatim minus `sync`
  meta.json       rev, ifid, name, cached counts, hash      ← this is the index
  assets.json     the manifest
  assets/         a_1f0e.webp, a_3450.webp …  real files, real extensions
  revs/           000001.json.gz, 000001.assets.gz …
```

On taskbot that directory sits next to the CLI, owned by the same user. So when the store
is local, **reads skip HTTP entirely**: `ls` reads `meta.json` files, `checkout` reads
`story.json`, old revisions come out of `revs/`, and asset blobs are already on disk at a
path — nothing is downloaded, nothing is cached, nothing is copied.

Reading behind the server's back is safe by construction. Every write it makes is
temp-file + rename, so a reader sees either the whole previous version or the whole new
one. There is no torn state to protect against and therefore no lock to take.

**Writing behind its back is not safe**, and not because of the file format:

| `PUT /stories/{id}` does | a direct file write skips |
|---|---|
| bumps `rev`, snapshots the old body into `revs/` | no history, no `restore`, no diff against yesterday |
| **announces the change on the websocket** | every open editor keeps its stale copy |
| takes the per-story mutex | torn state against a concurrent autosave |
| rewrites `meta.json` counts and hash | `ls` starts lying about every story |
| verifies the asset hash, bumps `assetRev` | the janitor may reap a blob nothing claims |

The second row is the one that bites. An editor holding rev 42 that never hears about your
change keeps holding rev 42, and its next autosave sends `If-Match: "42"` — which still
matches, because you never bumped it. Your work is overwritten silently and the server
believes nothing went wrong.

Reimplementing those five in the CLI is writing a second server. `PUT` is one HTTP request
to loopback. So:

> **Reads take the shortest path. The four commands that write — `push`, `restore`,
> `copy`, `rm` — always go through the API.**

### Local mode

The CLI is in local mode when it can see the store's `DATA_DIR`. It finds it from, in
order: `--data <dir>`, `TWINE_DATA`, `dataDir` in the profile, or — when the configured
server is a loopback address — the `DATA_DIR` of the `.env` beside the server binary.
`twine-cli ping` says which mode it is in, and it is not a second code path: a remote store
answers the same commands over HTTP, just slower, and the working copy that comes out is
byte-identical.

### Should the server store exploded passages instead?

No. It would not fix anything — the write problem is about the rev-and-notify contract, not
the layout — and it would cost the two properties the server has on purpose: `story.json`
is the body **verbatim**, so unknown and future fields round-trip untouched, and `store.go`
knows nothing about a passage beyond counting them. Explosion needs the scene parser, and
the scene parser is TypeScript. Keep the server dumb; put the knowledge in the CLI.

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
| 3 | `ls [--deleted] [--sort rev\|name\|bytes]` | one line per story: ref, name, rev, passages, assets, size, est tokens. Local: reads `meta.json`, opens no body |
| 4 | `checkout <story> [dir] [--rev N] [--copy-assets]` | explode a story into a working copy — §2 |
| 5 | `status [dir]` | what changed locally, what changed on the server, new asset files, missing blobs |
| 6 | `push [dir]` | reassemble, upload, `PUT` with `If-Match` — §3 |
| 7 | `pull [dir] [--force]` | re-explode at the server's rev; refuses over local edits without `--force` |
| 8 | `lint [dir\|<story>] [--fix]` | scene YAML, cross-passage, link graph, assets — §5 |
| 9 | `assets [dir] [--scene <id>] [--unused] [--missing]` | what exists and what a scene needs, with real paths — §4 |
| 10 | `graph [dir] [--format tree\|dot\|jsonl] [--from <passage>] [--depth n]` | the link graph, derived from the passage text |
| 11 | `copy <story> --name "<n>" [--reid <prefix>] [--assets copy\|link\|none]` | server-side clone — §6 |
| 12 | `new --name "<n>"` | empty story, new ifid |
| 13 | `rm <story> [--purge] --yes` | tombstone, or erase |
| 14 | `revs <story>` | rev, when, who, bytes, passages, `restoredFrom` |
| 15 | `restore <story> --rev N` | `POST /restore`; prints the new rev and any `missingAssets` |

**What is deliberately absent**: any command that prints a passage, a scene, a beat list or
a search result, and any command that edits one. `Read`, `rg`, `sed` and `Edit` do those,
on the working copy, better than a flag ever will. The CLI never prints a story body — it
puts bodies on disk and tells you where.

A **ref** is a story: its uuid, its name, or an unambiguous slug (`chapter-3` finds
`Chapter 3`). Ambiguity is never guessed — exit 2 with the candidates. Two suffixed forms
appear as arguments: `<story>@<rev>` for `checkout` and `revs`, and `<story>#<sceneId>` for
`assets --scene` and `lint`, because a scene id is unique inside a story and is what the
YAML calls itself. That is the entire grammar.

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

One file per passage, whole text, nothing extracted out of it. The `[scene]` block stays
where the author wrote it, inside the passage, because splitting it into a second file
means two writable copies of one text and a conflict rule to referee them. There is one
source of truth per passage and no referee.

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

The front matter is the three things an author changes: `name`, `tags`, `at`. Everything
else about the passage — its id, size, and any field a future Twine adds — lives in
`.twine/story.json` and is carried through untouched. `name` is the truth; the filename is
cosmetic, `NNN-slug.md` in the story's own passage order, so a directory listing reads in
the order the story was built.

Creating a file creates a passage. Deleting one deletes it. Renaming the file does nothing;
editing `name:` renames the passage, and `push` fixes every `[[link]]` and `links: to:`
that pointed at the old name unless you pass `--no-rewrite-links`.

### Assets

The blobs already exist on disk, under ids. All the working copy adds is a readable name
over them, as **relative symlinks**, laid out by kind:

```
assets/bg/…      assets/obj/…      assets/fx/…      assets/char/<character>/<frame>.<id>.<ext>
```

The name comes from the manifest (`desert-punk/idle`), the id stays in the filename so it
survives a rename, and the target is the store's own file — zero bytes copied, and a
checkout of a 2.3 MB library is instant. Read one, hand its path to an image model, write
a new one next to it.

`--copy-assets` makes real copies instead, for a checkout you intend to zip, move to
another machine, or keep after the story changes. Remote stores always copy; the layout is
identical either way, so nothing downstream cares.

Two things a symlink farm has to admit: an asset re-uploaded under the same id changes
under you (ids are identity, not content — spec 03), and the janitor may reap a blob the
manifest stops naming after `ORPHAN_TTL`. `.twine/index.json` records each blob's hash at
checkout, so `status` reports both as `changed` and `vanished` rather than letting you
discover it in a broken render.

### `STORY.md`

Generated, read-only, regenerated by `checkout`, `pull` and `status`. It is the map — the
one file to read before deciding anything:

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

The scene table carries `file:line`, so "open scene `tavern-night`" is a `Read` with an
offset and never a lookup command. The token estimate is `chars / 4` over the passage text;
under 50k, reading the whole `passages/` directory is a reasonable move and the header says
so. Over it, the tables are how you pick the three files that matter.

---

## 3 — Push

1. Rebuild the body: take `.twine/story.json`, replace each passage's `text`, `name`,
   `tags` and position from its file, add passages for new files, drop passages for deleted
   ones. Every other field, known or unknown, is carried through from the stored object. A
   checkout followed immediately by a push is a byte-identical no-op, and there is a test
   that says so.
2. Upload any asset file that has **no id in its name** — a file you dropped in yourself.
   The CLI assigns an id, `PUT`s the bytes with `X-Asset-Hash`, renames the file to
   `<name>.<id>.<ext>` and adds the manifest entry, taking `kind` from the directory and
   `name` from the filename.
3. `PUT` the manifest if it changed, then `PUT` the story with `If-Match: "<rev>"`.

Bytes before manifest before story, so a client that pulls mid-push never sees a manifest
naming blobs the store does not have — the same order `checkout-story.ts` uses in the
browser.

`--dry-run` prints what it would do and changes nothing. A **412 is exit 3** and stops
there: the CLI prints the rev it holds, the rev the server has, who wrote it, and the two
ways out (`pull --force` to discard yours, or diff the two by checking the server's rev out
into a second directory). It does not merge, and it does not retry. Nothing is uploaded on
a conflict — the story `PUT` goes last precisely so a rejected push leaves no debris.

---

## 4 — `assets`

Two questions, one command.

**What is here** — `twine-cli assets tmp/ep3`:

```
a_8f21  bg      tavern-night        1280x720  184 KB  assets/bg/tavern-night.a_8f21.webp
a_3450  frame   desert-punk/idle    1344x768  118 KB  assets/char/desert-punk/idle.a_3450.webp
a_9002  object  candle               256x256   12 KB  assets/obj/candle.a_9002.webp   unused
```

**What a scene needs** — `twine-cli assets tmp/ep3 --scene tavern-night`. This is the one
resolution that is real work, and the reason the command exists:

1. `bg:` → an asset id.
2. every `props:` entry → its `ref` (defaulting to the key) → an asset id.
3. every `cast:` entry → a **character** → only the frames the scene actually names: the
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

Every row is a path or a stated reason there isn't one, so "look at what this scene uses"
is one command and three `Read`s, and "generate the missing one" has both the gap and the
place to put the result.

`--json` gives `{id, kind, name, via, path, bytes, hash, present}` per line. `--missing`
and `--unused` filter to the two answers worth acting on.

---

## 5 — `lint`

The verification step after any edit, and the only thing that decides whether a working
copy is worth pushing. Four tiers, each already implemented in a package:

| Tier | From | Catches |
|---|---|---|
| YAML | `@sliders/scene-schema` | parse errors, unknown keys with `keyHint()` suggestions, bad coordinates |
| Cross-passage | `@sliders/scene-index` | duplicate scene ids, unknown `from:`, unknown `@mark`, `from:` cycles |
| Story graph | `scanLinkTargets` + passage names | links to passages that do not exist, unreachable passages, and a scene passage whose only exit is a `[[link]]` outside the block — spec 02: that link is never drawn |
| Assets | manifest + blobs | scene references to unknown assets, manifest entries with no blob, blobs nothing names |

Output is `file:line: message`, which every editor and every agent already knows how to
open. Exit 5 on any error, 0 with warnings printed. `--fix` does only the mechanical ones:
prune manifest entries nothing references, normalise `at:` through `scene-edit.formatAt`.
It never guesses at a broken link.

`lint <story>` without a working copy lints what is on the server, for a quick check that
does not need a checkout.

---

## 6 — `copy`

`twine-cli copy ep3 --name "Episode 4"` — server-side, no checkout needed.

| Thing | What happens | Why |
|---|---|---|
| story `id` | new uuid | it is a new story |
| `ifid` | new uuid | an IFID is stable across import/export of *the same* story; a copy is not it |
| passage ids | new uuids | ids are per story, and a shared one makes every sync record lie |
| names, positions, tags, text | verbatim | |
| scene ids | kept, or rewritten by `--reid <prefix>` | ids are unique *within* a story (spec 02) and the index is per story, so two stories may share one. Rewriting is opt-in because it must also rewrite every `from:` and `@mark` |
| assets | `--assets copy` (default), `link`, `none` | `copy` re-`PUT`s the blobs under the new story. `link` copies manifest entries and leans on the source's blobs, which the janitor may reap — allowed, warned, never the default |
| revisions | not copied | the copy starts at rev 1 |

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
change bus does not echo the CLI's own writes at an editor session the same person has
open, and the history list reads `twine-cli@taskbot` instead of `unknown`.

Locks are advisory (spec 11). `push` warns when another client is focused on a passage it
is about to change and proceeds anyway — the server enforces nothing and neither should
the CLI. `--strict` makes it exit 3 instead.

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

It lives in this repo and not beside the Go server because everything that makes it more
than `curl` is already TypeScript: `@sliders/scene-schema` parses a scene,
`@sliders/scene-index` resolves `from:` and marks and finds the cross-passage errors,
`@sliders/scene-core` compiles states, `@sliders/asset-store` owns id and hash rules,
`scanLinkTargets` reads the link graph. A Go CLI means a second scene parser, and two
parsers disagree the week after they are written.

```
packages/twine-cli/src/
  bin.ts          arg parse, profile, mode detection, exit codes
  source/         one interface, two implementations: local files, HTTP
  wc/             explode, STORY.md, index.json, reassemble, status, push
  assets.ts       the symlink farm and the per-scene resolution
  lint.ts         the four tiers, formatted as file:line
  cmd/            one small file per command
```

`source/` is the seam that keeps local mode honest: `checkout` and `ls` ask it for a body
or a manifest and never know which one answered. Writes do not go through it — they are
always the HTTP client, by construction rather than by discipline.

`src/store/persistence/server/client.ts` already speaks this API from the browser; the node
client shares its types and its `ServerError`, and both compile against `server.types.ts`,
so they cannot drift apart quietly.

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
proves the pattern. Local mode gets tested against a `t.TempDir()`-shaped data directory
built by that same server, never by hand.

---

## 9 — The skill

`.claude/skills/twine-cli/` teaches an agent one loop — checkout, read the map, edit files,
lint, push — plus the two facts it cannot infer: writes go through the CLI and never
straight into `data/`, and `assets/` holds real paths meant to be read. `SKILL.md` is that
loop; `references/commands.md` and `references/recipes.md` hold the detail, loaded only
when needed.
