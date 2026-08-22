# 12 — `twine-cli`, terminal client for story store

CLI for server in [`11-server-storage.md`](11-server-storage.md). Agent first, human second.

Design one line: **decode story to files, work on files, encode back.**

Story on disk = one line JSON. Fixture in `data/` is 4278 bytes, **zero newlines**. Every
passage a string, scene YAML flattened to `\n` escapes. So `rg -n` answer "line 1" to every
question, and editor got nothing to anchor on.

Decode gives one file per passage, scene YAML where author wrote it, art beside it under
readable names. Then agent use what it knows: read file, grep tree, edit line, look at
image.

Decode is what `checkout` is. Not download — local mode fetch nothing, art is symlink to
blobs already on disk. Working copy = derived view. Disposable. Regenerable.

Around it CLI does four things text editor cannot: **write through store API, resolve what
scene needs, check result valid, talk to store about history.** Only first needs decode.

Fifteen commands. You type four.

---

## 0 — How CLI reach data

Store keep plain files (spec 11):

```
data/stories/79d06063-0d0d-4cb1-bf6f-d9d61272d41b/
  story.json      body, verbatim minus `sync`
  meta.json       rev, ifid, name, cached counts, hash      <- this is the index
  assets.json     manifest
  assets/         a_1f0e.webp, a_3450.webp …  real files, real extensions
  revs/           000001.json.gz, 000001.assets.gz …
```

Same box, same user, so **reads take short path**: `ls` read `meta.json` files, `checkout`
read `story.json`, old revisions come from `revs/`, blobs already at a path. Nothing
downloaded, cached, copied.

Sound because server write by temp-file + rename. Reader see whole old version or whole new
one. Nothing to lock.

**Writes go through API.** Four commands write: `push`, `restore`, `copy`, `rm`. Each one HTTP
request. That bump `rev`, snapshot old body to `revs/`, announce change on websocket so open
editors update, serialise against concurrent autosave, refresh cached counts in `meta.json`.
One request to loopback buy all five.

### Local mode

CLI in local mode when it see store `DATA_DIR`. Finds it, in order: `--data <dir>`,
`TWINE_DATA`, `dataDir` in profile, or — when server is loopback — `DATA_DIR` from `.env`
beside server binary. `twine-cli ping` say which mode.

Optimisation, not second personality. Remote store answer same commands over HTTP. Working
copy comes out byte-identical.

---

## 1 — Commands

```
twine-cli <cmd> [args] [flags]
```

Global: `--data`, `--server`, `--token`, `--profile`, `--json`, `--yes`, `-q`.

| # | Command | Does |
|---|---|---|
| 1 | `ping` | mode, server version, story count, who else connected |
| 2 | `login [--server URL]` | store token in profile, 0600 |
| 3 | `ls [--deleted] [--sort rev\|name\|bytes]` | one line per story: ref, name, rev, passages, assets, size, est tokens |
| 4 | `checkout <story> [dir] [--rev N] [--passages <glob>] [--copy-assets]` | decode story to working copy — §2 |
| 5 | `status [dir]` | changed local, changed on server, new asset files, missing or changed blobs |
| 6 | `push [dir]` | reassemble, upload, `PUT` with `If-Match` — §3 |
| 7 | `pull [dir] [--force]` | re-decode at server rev; keep local edits unless `--force` |
| 8 | `lint [dir\|<story>] [--fix]` | scene YAML, cross-passage, link graph, assets — §5 |
| 9 | `assets [dir\|<story>] [--scene <id>] [--unused] [--missing]` | what exists, what scene needs, with real paths — §4 |
| 10 | `graph [dir\|<story>] [--format tree\|dot\|jsonl] [--from <passage>] [--depth n]` | link graph from passage text |
| 11 | `copy <story> --name "<n>" [--reid <prefix>] [--assets copy\|link\|none]` | server-side clone — §6 |
| 12 | `new --name "<n>"` | empty story, new ifid |
| 13 | `rm <story> [--purge] --yes` | tombstone, or erase |
| 14 | `revs <story>` | rev, when, who, bytes, passages, `restoredFrom` |
| 15 | `restore <story> --rev N` | `POST /restore`; print new rev and `missingAssets` |

Read and edit content in working copy with `Read`, `rg`, `sed`, `Edit`. Agent already fluent,
files already on disk.

`ls`, `assets`, `lint`, `graph`, `revs`, `copy` take story ref and read store direct. None
touch passage text, none need decode. Working copy is for editing.

**Ref** = a story: uuid, name, or unambiguous slug (`chapter-3` finds `Chapter 3`). Ambiguous
→ candidate list, exit 2. Two suffixes: `<story>@<rev>` for `checkout`/`copy`/`revs`, and
`<story>#<sceneId>` for `assets --scene`/`lint`. Scene id unique inside story, and it is what
YAML call itself. That is whole grammar.

---

## 2 — Working copy

```
tmp/ep3/
  STORY.md                                   read this first
  passages/
    001-start.md
    003-tavern-night.md
  assets/
    bg/tavern-night.a_8f21.webp              -> <DATA_DIR>/stories/<id>/assets/a_8f21.webp
    obj/candle.a_44de.webp                   -> …
    char/desert-punk/idle.a_3450.webp        -> …
  characters/
    desert-punk.yaml
  .twine/
    ref.json        server, story id, rev, etag, mode, client id
    story.json      body exactly as pulled — round-trip reference
    assets.json     manifest as pulled
```

Three files, two of them what store handed over. `status` re-decode `.twine/story.json` in
memory, compare with disk — no separate hash record to go stale. Blob changes same way, from
hashes already in `.twine/assets.json`. Delete `.twine/` and check out again when that is
easier than thinking.

### Passages

One file per passage, whole text. `[scene]` block stay inside passage, where author wrote it.
One source of truth per passage, and edit land where person would put it.

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

Front matter = three things author change: `name`, `tags`, `at`. Passage id, size, and any
field future Twine adds live in `.twine/story.json`, carried through untouched.

`name` is truth. Filename cosmetic — `NNN-slug.md` in story passage order, so directory
listing read in build order.

New file = new passage. Delete file = delete passage. Edit `name:` = rename, and `push`
follow rename through every `[[link]]` and `links: to:` that pointed at it, unless
`--no-rewrite-links`.

### Assets

Blobs already on disk under ids. Working copy lay readable name over them as **relative
symlinks**, by kind:

```
assets/bg/…      assets/obj/…      assets/fx/…      assets/char/<character>/<frame>.<id>.<ext>
```

Name from manifest (`desert-punk/idle`), id stay in filename so it survive rename, target is
store own file. Checkout of 2.3 MB library instant, costs no disk. Read one, hand path to
image model, write new one next to it.

`--copy-assets` make real copies — for checkout you zip, move to other machine, or keep after
story move on. Remote store copy too. Layout identical either way.

Asset ids are identity, not content (spec 03). Janitor reclaim blobs manifest stop naming
after `ORPHAN_TTL`. `.twine/assets.json` hold hash each blob had at checkout, so `status`
report `changed` and `vanished` up front.

### `STORY.md`

Generated. Regenerated by `checkout`, `pull`, `status`. The map — one file to read before
deciding anything:

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

Scene table carry `file:line`, so open scene `tavern-night` = `Read` with offset. Token
estimate = `chars / 4` over passage text. Under 50k: read whole `passages/` dir, header say
so. Over: tables pick the three files that matter.

---

## 3 — Push

1. **Rebuild body.** Take `.twine/story.json`. Replace each passage `text`, `name`, `tags`,
   position from its file. Add passage for new file, drop passage for deleted file. Every
   other field, known or unknown, come through from stored object. Checkout then push =
   byte-identical no-op. Test say so.
2. **Upload new art.** Asset file with no id in name = one you added. CLI assign id, `PUT`
   bytes with `X-Asset-Hash`, rename file to `<name>.<id>.<ext>`, add manifest entry. `kind`
   from directory, `name` from filename.
3. **Publish.** `PUT` manifest if changed, then `PUT` story with `If-Match: "<rev>"`.

Bytes before manifest before story. Client pulling mid-push always see manifest whose blobs
exist — same order `checkout-story.ts` use in browser. Story `PUT` last also mean rejected
push leave store as it was.

`--dry-run` print plan. **412 = exit 3**: CLI print rev you hold, rev server has, who wrote
it, and two ways forward — check server rev out to second directory and compare, or
`pull --force` to take theirs.

---

## 4 — `assets`

Two questions, one command.

**What is here** — `twine-cli assets tmp/ep3`:

```
a_8f21  bg      tavern-night        1280x720  184 KB  assets/bg/tavern-night.a_8f21.webp
a_3450  frame   desert-punk/idle    1344x768  118 KB  assets/char/desert-punk/idle.a_3450.webp
a_9002  object  candle               256x256   12 KB  assets/obj/candle.a_9002.webp   unused
```

**What scene needs** — `twine-cli assets tmp/ep3 --scene tavern-night`. This resolution is the
real work:

1. `bg:` → asset id.
2. every `props:` entry → its `ref` (default = key) → asset id.
3. every `cast:` entry → **character** → frames scene actually names: entity `frame:`, any
   `frame:` in beat patch, character default. `--all-frames` widen to whole character.
4. `fx:` entries that are asset-backed.
5. `from:` set → same walk over inherited scene, marked `inherited`.

```
a_8f21  bg              assets/bg/tavern-night.a_8f21.webp            bg:
a_11c0  frame  mira     assets/char/mira/arms-crossed.a_11c0.webp     cast/mira
a_44de  frame  mira     MISSING BLOB                                  beats/2 patch frame: angry
—       object candle   NOT IN MANIFEST                               props/candle
```

Every row = path, or reason there is none yet. "Look at what scene uses" = one command, three
`Read`s. "Generate missing one" = gap plus place to put result.

`--json` gives `{id, kind, name, via, path, bytes, hash, present}` per line. `--missing` and
`--unused` filter to two answers worth acting on.

---

## 5 — `lint`

Verify step after edit. Decides if working copy ready to push. Four tiers, each already in a
package:

| Tier | From | Catches |
|---|---|---|
| YAML | `@sliders/scene-schema` | parse errors, unknown keys with `keyHint()` suggestions, bad coordinates |
| Cross-passage | `@sliders/scene-index` | duplicate scene ids, unknown `from:`, unknown `@mark`, `from:` cycles |
| Story graph | `scanLinkTargets` + passage names | links to passages that do not exist, unreachable passages, scene passage whose only exit is `[[link]]` outside block — spec 02: that link never drawn |
| Assets | manifest + blobs | scene refs to unknown assets, manifest entries with no blob, blobs nothing names |

Output `file:line: message`. Every editor and every agent know how to open that. Exit 5 on
error, 0 with warnings printed. `--fix` do mechanical ones: prune manifest entries nothing
references, normalise `at:` through `scene-edit.formatAt`. Broken links wait for human.

`lint <story>` run against store, no checkout.

---

## 6 — `copy`

`twine-cli copy ep3 --name "Episode 4"` — server-side, no checkout.

| Thing | What happens | Why |
|---|---|---|
| story `id` | new uuid | new story |
| `ifid` | new uuid | IFID stable across import/export of *same* story; copy is different one |
| passage ids | new uuids | ids per story, fresh set keep every sync record honest |
| names, positions, tags, text | verbatim | |
| scene ids | kept, or rewritten by `--reid <prefix>` | ids unique *within* story (spec 02), index per story, so two stories may share one. Rewrite opt-in because it also rewrite every `from:` and `@mark` |
| assets | `--assets copy` (default), `link`, `none` | `copy` re-`PUT` blobs under new story. `link` copy manifest entries, share source blobs, janitor reclaim once nothing name them — opt-in |
| revisions | start fresh | copy begin at rev 1 |

`copy ep3@37 --name "Ep3 rescue"` copy old revision. Prints new story ref, plus any reference
it could not rewrite.

---

## 7 — Config, identity, exits

`~/.config/twine-cli/config.json`, 0600:

```json
{
  "profile": "local",
  "profiles": {
    "local": {"server": "http://127.0.0.1:8080", "token": "…", "dataDir": "<DATA_DIR>"},
    "prod":  {"server": "https://twine-story-store.tmpx.space", "token": "…"}
  },
  "clientId": "cli_9f31",
  "clientName": "twine-cli@<host>"
}
```

`TWINE_STORE_URL`, `TWINE_STORE_TOKEN`, `TWINE_DATA`, `TWINE_PROFILE` override file. Flags
override env. `dataDir` default = `DATA_DIR` from server `.env`, so no host paths in config.

`clientId` persisted, not per-process. Ride every request as `X-Client-Id`, so change bus skip
CLI own writes when same person has editor open, and history list read `twine-cli@<host>`.

Locks advisory (spec 11). `push` warn when other client focused on passage it change, then go
ahead. `--strict` turn that into exit 3.

| Exit | Means |
|---|---|
| 0 | fine |
| 1 | not found |
| 2 | usage, or ambiguous ref |
| 3 | conflict — server rev moved, or `--strict` hit lock |
| 4 | server unreachable, or token rejected |
| 5 | lint errors |

---

## 8 — Build it

TypeScript, `packages/twine-cli`, bin `twine-cli`, Node 20, native `fetch`. Only new runtime
dep is `yaml`, already in tree.

Lives in this repo because everything past `curl` is already here: `@sliders/scene-schema`
parse scene, `@sliders/scene-index` resolve `from:` and marks and find cross-passage errors,
`@sliders/scene-core` compile states, `@sliders/asset-store` own id and hash rules,
`scanLinkTargets` read link graph. One parser, shared by editor, runtime, CLI.

```
packages/twine-cli/src/
  bin.ts          arg parse, profile, mode detect, exit codes
  source/         one interface, two impls: local files, HTTP
  wc/             decode, STORY.md, reassemble, status, push
  assets.ts       symlink farm, per-scene resolution
  lint.ts         four tiers, formatted file:line
  cmd/            one small file per command
```

`source/` is seam that keep local mode honest: `checkout` and `ls` ask it for body or
manifest, never learn which side answered. Write commands hold HTTP client direct, so going
through API is structural, not habit.

`src/store/persistence/server/client.ts` already speak this API from browser. Node client
share its types and `ServerError`. Both compile against `server.types.ts`, so they stay in
step.

**Tiers.**

| Tier | Commands |
|---|---|
| **1** | `ping`, `ls`, `checkout`, `status`, `push`, `lint`, `assets` |
| **2** | `pull`, `copy`, `revs`, `restore`, `graph`, `new`, `rm`, `login` |
| **3** | `--fix`, `--reid`, `assets --all-frames`, `graph --format dot` |

**Tests.** Round-trip is load-bearing: decode fixture story, encode back unchanged, assert
body byte-identical. Then edit one passage file, assert exactly one passage differs. Rest run
against real server — `go run . --addr 127.0.0.1:0` print its port on first line for exactly
this, Playwright fixture already prove pattern. Local mode tests read data dir that same
server built.

---

## 9 — Skill

`.claude/skills/twine-cli/` teach agent the loop — checkout, read map, edit files, lint, push
— plus two facts it cannot infer: writes go through CLI, and `assets/` hold real paths meant
to be read. `SKILL.md` is that loop. `references/commands.md` and `references/recipes.md` hold
detail, loaded when needed.
