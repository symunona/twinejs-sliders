# 12 — `twine-cli`, terminal client for story store

CLI for server in [`11-server-storage.md`](11-server-storage.md). Agent first, human second.

Store already keep files. Story is `story.json`, art is `a_8f21.webp` on disk. Agent read
them fine. So CLI do only what files cannot do for themselves:

- **hand out one passage as plain text**, and take it back — passage live as a JSON string
  field, and nothing may be written into `data/` by hand
- **map** the story so agent know which passage to ask for
- **resolve** which assets a scene reach
- **lint** the result
- talk to store about **history**: revisions, restore, copy

Fifteen commands. You type four: `map`, `cat`, `put`, `lint`.

---

## 0 — How CLI reach data

Store keep plain files (spec 11):

```
data/stories/79d06063-0d0d-4cb1-bf6f-d9d61272d41b/
  story.json      body, verbatim minus `sync`      one line, no newlines
  meta.json       rev, ifid, name, cached counts, hash      <- this is the index
  assets.json     manifest
  assets/         a_1f0e.webp, a_3450.webp …  real files, real extensions
  revs/           000001.json.gz, 000001.assets.gz …
```

Same box, same user, so **reads take short path**: `ls` read `meta.json`, `map` and `cat`
read `story.json`, old revisions come from `revs/`, blobs already at a path. Nothing
downloaded, nothing cached.

Safe because server write by temp-file + rename. Reader see whole old version or whole new
one. Nothing to lock.

**Writes go through API.** `put`, `restore`, `copy`, `rm` — each one HTTP request. That bump
`rev`, snapshot old body to `revs/`, announce change on websocket so open editors update,
serialise against concurrent autosave, refresh cached counts in `meta.json`. One request to
loopback buy all five. Same reason nothing hand-edit `data/`.

### Local mode

CLI in local mode when it see store `DATA_DIR`. Finds it, in order: `--data <dir>`,
`TWINE_DATA`, `dataDir` in profile, or — server is loopback — `DATA_DIR` from `.env` beside
server binary. `twine-cli ping` say which mode.

Optimisation, not second personality. Remote store answer same commands over HTTP, same
output.

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
| 4 | `map <story> [--json]` | the story map — §2 |
| 5 | `cat <ref> [-o file] [--all -o dir] [--refresh]` | hand out passage text, or asset bytes — §3 |
| 6 | `put <ref> <file> [--all dir] [--delete <name>]` | take it back, splice, `PUT` — §3 |
| 7 | `check <file\|dir>` | is my copy still current? read-only — §3 |
| 8 | `lint [<story>\|<file>] [--fix]` | scene YAML, cross-passage, links, assets — §5 |
| 9 | `assets <story> [--scene <id>] [--unused] [--missing]` | what exists, what scene needs, with real paths — §4 |
| 10 | `graph <story> [--format tree\|dot\|jsonl] [--from <passage>] [--depth n]` | link graph |
| 11 | `copy <story> --name "<n>" [--reid <prefix>] [--assets copy\|link\|none]` | server-side clone — §6 |
| 12 | `new --name "<n>"` | empty story, new ifid |
| 13 | `rm <story> [--purge] --yes` | tombstone, or erase |
| 14 | `revs <story>` | rev, when, who, bytes, passages, `restoredFrom` |
| 15 | `restore <story> --rev N` | `POST /restore`; print new rev and `missingAssets` |

Reading and editing text happen with `Read`, `rg`, `sed`, `Edit` on what `cat` handed out.
No state directory, no sync record, no status subsystem.

### Refs

| Form | Is |
|---|---|
| `ep3` | story: uuid, name, or unambiguous slug (`chapter-3` finds `Chapter 3`) |
| `ep3/Tavern Night` | passage, by name or id prefix |
| `ep3#tavern-night` | passage that hold that scene id — scene ids unique per story |
| `ep3:a_8f21` · `ep3:tavern-dawn` | asset, by id or manifest name |
| `ep3@37` | story at old rev. Read only |

Ambiguous → candidate list, exit 2. Quote refs with spaces or `#`.

---

## 2 — `map`

One command, stdout, the thing to read before deciding anything.

```
$ twine-cli map ep3
ep3  Trip to my Desert  rev 42  4 passages  10 assets (2.3 MB)  ~15k tokens  local

PASSAGES
  ep3/Start                  22 lines  —                links: Tavern Night, Street
  ep3/Tavern Night           48 lines  scene @12        links: Tavern Fight, Street
  ep3/Street                 31 lines  scene @8         links: Start

SCENES
  tavern-night   in Tavern Night   from —   cast mira,joren   7 beats   marks: tense
  street-day     in Street         from tavern-night@tense   cast mira   3 beats

ASSETS  10, 2.3 MB — 4 bg, 5 frame, 1 object.  1 unused, 0 missing
LINT    2 warnings, 0 errors
```

`scene @12` = scene block start line **inside that passage**, so after `cat` you `Read` with
an offset. Token estimate is `chars / 4` over passage text — under 50k, `cat --all` and read
everything is a fine move; over, map pick the three passages that matter.

`--json` gives one JSONL record per passage.

---

## 3 — `cat`, `put`, `check`

### Receipt

`cat` stamp front matter on what it hands out. State ride with artifact, CLI stay stateless.

```markdown
---
story: ep3
passage: Tavern Night
rev: 42            # story rev at handout
hash: 9f31c8a2     # sha256 of THIS passage text as handed out
---
mood: tense
--
[scene]
id: tavern-night
bg: tavern/night
cast:
  mira: {at: -0.4, frame: arms-crossed}
```

Everything below front matter is passage text, unescaped, exactly as author wrote it. No
`.twine/` directory, no index, no sync record. Delete file, lose nothing.

Front matter also take `name:`, `tags:`, `at:` — edit them to rename, retag, move.

### `put` check the passage, not the story

Story `rev` is story-wide, so plain `If-Match: "42"` make a false conflict every time someone
touch a *different* passage. So `put` do:

1. read current story — local: off disk, instant
2. hash current text of that passage, compare to stamped `hash`
3. splice your text into **current** body, `PUT` with `If-Match: "<rev now>"`

| Server state | Stamped hash vs now | `put` does |
|---|---|---|
| rev still 42 | match | write. exit 0 |
| rev moved, other passages changed | match | write. their edits survive, yours land. exit 0 |
| rev moved, this passage changed | differ | stop, exit 3, print who, when, diff |

Hash do the work. Rev is for `If-Match` and for the report.

Between step 2 and step 3 a write can land. `If-Match` catch it: 412 → re-read, re-hash,
retry **once**, then exit 3. Bounded, no loop.

`put` splice only the passage it name. Passage someone else added meanwhile is untouched — no
deletion-by-absence, which is what whole-story reassembly get wrong.

### `check`

Same three-way test, no write:

```
$ twine-cli check tmp/p.md
fresh            rev 42, passage unchanged
stale-elsewhere  rev 47, other passages moved — your put still safe
conflict         rev 47, Tavern Night changed by user-a268 at 14:02
```

Run before a long edit, run before `put`. Exit 0 / 0 / 3.

### Bulk

```sh
twine-cli cat ep3 --all -o tmp/ep3/          # one file per passage, each with own receipt
twine-cli put ep3 --all tmp/ep3/             # per-passage splice, per-passage hash check
```

`put --all` skip files it did not hand out, and report per file. Deleting a passage need
`--delete "<name>"` — absence never delete.

`cat <ref> --refresh` re-take a passage, refusing when the local file has edits, so a stale
copy is one command from current.

### Assets through same verbs

```sh
twine-cli cat ep3:a_8f21 -o tmp/bg.webp      # local mode: print the store path instead
twine-cli put ep3:tavern-dawn tmp/new.webp --kind bg
```

`put` on unknown asset name create it: assign id, `PUT` bytes with `X-Asset-Hash`, add
manifest entry. Known name or id replace bytes.

---

## 4 — `assets`

Two questions, one command.

**What is here** — `twine-cli assets ep3`:

```
a_8f21  bg      tavern-night      1280x720  184 KB  <DATA_DIR>/stories/<id>/assets/a_8f21.webp
a_3450  frame   desert-punk/idle  1344x768  118 KB  …/assets/a_3450.webp
a_9002  object  candle             256x256   12 KB  …/assets/a_9002.webp   unused
```

Local mode print the store path — blob already a file, read it, feed it to an image model.
Remote store need `--fetch -o <dir>`.

**What scene needs** — `twine-cli assets ep3 --scene tavern-night`. This resolution is the
real work:

1. `bg:` → asset id.
2. every `props:` entry → its `ref` (default = key) → asset id.
3. every `cast:` entry → **character** → frames the scene actually name: entity `frame:`, any
   `frame:` in a beat patch, character default. `--all-frames` widen to whole character.
4. `fx:` entries that are asset-backed.
5. `from:` set → same walk over inherited scene, marked `inherited`.

```
a_8f21  bg              …/assets/a_8f21.webp     bg:
a_11c0  frame  mira     …/assets/a_11c0.webp     cast/mira
a_44de  frame  mira     MISSING BLOB             beats/2 patch frame: angry
—       object candle   NOT IN MANIFEST          props/candle
```

Every row = a path, or the reason there is none yet. "Look at what scene use" = one command,
three `Read`s. "Generate the missing one" = the gap plus where result go.

`--json` gives `{id, kind, name, via, path, bytes, hash, present}` per line. `--missing` and
`--unused` filter to the two answers worth acting on.

---

## 5 — `lint`

Verify step after edit. Four tiers, each already in a package:

| Tier | From | Catches |
|---|---|---|
| YAML | `@sliders/scene-schema` | parse errors, unknown keys with `keyHint()` suggestions, bad coordinates |
| Cross-passage | `@sliders/scene-index` | duplicate scene ids, unknown `from:`, unknown `@mark`, `from:` cycles |
| Story graph | `scanLinkTargets` + passage names | links to passages that do not exist, unreachable passages, scene passage whose only exit is `[[link]]` outside block — spec 02: that link never drawn |
| Assets | manifest + blobs | scene refs to unknown assets, manifest entries with no blob, blobs nothing name |

`lint ep3` run all four against the store. `lint tmp/p.md` run tier 1 on a file in hand, before
`put` — fast, no server. `lint ep3 --after tmp/p.md` run all four as if that file were already
pushed, which is the honest pre-flight.

Output `file:line: message`, or `ep3/Tavern Night:12: message` when linting the store. Exit 5
on error, 0 with warnings. `--fix` do mechanical ones: prune manifest entries nothing
reference, normalise `at:` through `scene-edit.formatAt`. Broken links wait for human.

---

## 6 — `copy`

`twine-cli copy ep3 --name "Episode 4"` — server-side, nothing local.

| Thing | What happens | Why |
|---|---|---|
| story `id` | new uuid | new story |
| `ifid` | new uuid | IFID stable across import/export of *same* story; copy is different one |
| passage ids | new uuids | ids per story, fresh set keep every sync record honest |
| names, positions, tags, text | verbatim | |
| scene ids | kept, or rewritten by `--reid <prefix>` | ids unique *within* story (spec 02), index per story, so two stories may share one. Rewrite opt-in because it also rewrite every `from:` and `@mark` |
| assets | `--assets copy` (default), `link`, `none` | `copy` re-`PUT` blobs under new story. `link` copy manifest entries and share source blobs, janitor reclaim once nothing name them — opt-in |
| revisions | start fresh | copy begin at rev 1 |

`copy ep3@37 --name "Ep3 rescue"` copy an old revision. Print new story ref plus any reference
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
CLI own writes when same person has editor open, and history read `twine-cli@<host>`.

Locks advisory (spec 11). `put` warn when other client focused on that passage, then go ahead.
`--strict` turn that into exit 3.

| Exit | Means |
|---|---|
| 0 | fine |
| 1 | not found |
| 2 | usage, or ambiguous ref |
| 3 | conflict — passage changed under you, or `--strict` hit lock |
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
  ref.ts          the five ref forms, resolve against a story
  source/         one interface, two impls: local files, HTTP
  passage.ts      receipt front matter: stamp, parse, hash, splice
  assets.ts       per-scene resolution
  lint.ts         four tiers, formatted file:line
  cmd/            one small file per command
```

`source/` is the seam that keep local mode honest: `map` and `cat` ask it for a body, never
learn which side answered. `put` and friends hold the HTTP client direct, so going through API
is structural, not habit.

`src/store/persistence/server/client.ts` already speak this API from browser. Node client share
its types and `ServerError`. Both compile against `server.types.ts`, so they stay in step.

**Tiers.**

| Tier | Commands |
|---|---|
| **1** | `ping`, `ls`, `map`, `cat`, `put`, `check`, `lint` |
| **2** | `assets`, `graph`, `copy`, `revs`, `restore`, `new`, `rm`, `login` |
| **3** | `--fix`, `--reid`, `--all`, `assets --all-frames`, `graph --format dot`, `watch` |

**Tests.** Round-trip is load-bearing: `cat` a fixture passage, `put` it back unchanged, assert
body byte-identical and rev bumped by exactly one. Then the three-way table — same passage
edited elsewhere, other passage edited elsewhere, nothing edited — as three tests, because that
is where correctness live. Rest run against real server: `go run . --addr 127.0.0.1:0` print
its port on first line for exactly this, Playwright fixture already prove the pattern.

---

## 9 — Skill

`.claude/skills/twine-cli/` teach agent the loop — `map`, `cat`, edit, `lint`, `put` — plus two
facts it cannot infer: writes go through CLI, and asset paths are real files meant to be read.
`SKILL.md` is that loop. `references/commands.md` and `references/recipes.md` hold detail,
loaded when needed.
