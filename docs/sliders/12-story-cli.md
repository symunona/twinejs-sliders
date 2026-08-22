# 12 — `twine-cli`, the terminal interface to the story store

A command-line client for the server in [`11-server-storage.md`](11-server-storage.md),
designed for a coding agent first and a human second. It does what the editor does — pull
a story, read its scenes, move a character, copy an episode, fetch art — without a browser
and, crucially, **without ever putting a whole story in front of the reader**.

Two audiences, one tool:

- A human wants `twine-cli ls` and readable tables.
- An agent wants stable, re-feedable **refs**, small answers, real file **paths** for
  anything big, and an exit code it can branch on.

Both get the same surface. The agent-shaped rules below are what make it usable by a human
in a 24-line terminal too.

---

## 0 — Measure first, then decide

Most stories are small. A 40-passage episode is 60 KB of text — 15k tokens, less than this
spec. Reading it whole is not a problem to be engineered around; it is the fastest way to
understand it. The tool should hand it over.

Some stories are not small. The body cap is 32 MB, and a long-running series with a hundred
scenes and dense prose will pass the point where a full read is a bad trade. So the CLI
**measures** and changes its default rather than being permanently defensive.

### The estimate

```
est_tokens ≈ chars / 4
```

Before anything is fetched, `GET /stories` already gives `bytes` and `passageCount` per
story, so `est = bytes / 4` is free and conservative — story JSON carries positions, ids
and sizes that never get printed, so the real prose is always smaller than the guess. Once
a body is in the cache, the estimate is exact: the sum of the passage texts it would print.
Both are stored in the cache index, so every later command knows the answer without
re-deciding.

### Two modes, one threshold

| Estimate | Mode | Default behaviour |
|---|---|---|
| **< 50k tokens** (≈ 200 KB) | `full` | Bodies print. `passage show` prints the whole passage. `scene get` prints the YAML. Lists are unpaged up to 200 rows. `story text` will hand over the entire episode as readable text. |
| **≥ 50k tokens** | `brief` | Summaries by default, bodies become cache paths, lists page at 40. Every one of them takes `--full` to override for that call. |

The threshold is `--budget` / `TWINE_BUDGET`, default `50k`. `--brief` and `--full` force a
mode for one call; `--budget 0` means never guard.

When brief mode engages, the CLI says so once, on stderr, with the way out:

```
note: ep3 ≈ 78k tokens (412 KB, 190 passages) — brief mode. --full for whole bodies.
```

Silence means full mode. An agent never has to guess which one it is in — and `twine-cli
size <ref>` answers directly.

### What still holds at any size

Four rules are about being useful, not about being frugal, so they do not relax:

| # | Rule |
|---|---|
| **R1** | **A single output never exceeds `--max-tokens`** (default 6k, ≈ 600 lines). Past that it is written to the cache and the **path** is printed, in either mode. One passage cannot eat a context window by accident. |
| **R2** | **Nothing truncates silently.** A capped list ends with `… 132 more — --offset 40`; a spilled body prints its path and its size. |
| **R3** | **Every row starts with a ref** that is valid input to the next command. The output is the index of the next command. |
| **R4** | **`--json` is JSONL**, one record per line, so `head`, `grep` and `jq -c` work on a stream. |

The map commands — `graph`, `grep`, `scene ls` — exist for the large case and for the
targeted question, not as a mandatory ritual before every read. On a 15k-token episode,
`twine-cli story text .` and reading it is the right move.

### Whole-story reads

Because they are legitimate:

| Command | Does |
|---|---|
| `size [<ref>]` | est tokens, bytes, passages, scenes, mode, and whether it is cached |
| `story text <ref> [--scenes-only\|--prose-only] [-o path]` | the whole story as readable text: `## Passage name` headers, then the passage body. Refuses over `--max-tokens` unless `-o` or `--force`, and then says how big it was |
| `passage cat <ref>...` · `passage cat <story> --tag act1` | several passages, full text, one after another, same ceiling |

`story text` is not the JSON. Positions, sizes, selection flags and ids are dropped; what
is left is what a person would read. That is usually a third of the wire bytes, which is
why the mode decision uses the printed estimate once it can.

## 1 — Refs

One string addresses everything, and every sigil means one thing.

```
<story>                          story          "s_7f2c"  ·  "Chapter 3"  ·  .
<story>/<passage>                passage        .../Tavern Fight
<story>#<scene>                  scene          .#tavern-night
<story>#<scene>/<path>           inside a scene .#tavern-night/cast/mira
<story>@<rev>                    story at rev   .@41                     read-only
<story>#<scene>@<mark>           scene state    .#tavern-night@tense      read-only
<story>:<assetId|charId>         asset · char   .:a_8f21   .:mira
```

| Sigil | Means | Notes |
|---|---|---|
| `/` | descend | passage, then a path inside a scene |
| `#` | scene id | scene ids are unique inside a story (spec 02); this is why they are addressable without naming the passage |
| `@` | a version or a state | rev before `#`, `@mark` after it — the same `id@mark` syntax `scene-index.resolve()` already speaks |
| `:` | the asset library | `a_` prefix ⇒ asset, otherwise a character id |
| `.` | the pinned story | set by `twine-cli use <story>`; every command takes `.` implicitly |

**Resolution of a story segment**, in order: exact id → exact name → unique
case-insensitive slug match (`chapter-3` finds `Chapter 3`) → unique id prefix. Same for a
passage segment, plus passage-id prefix. Ambiguity is never guessed: exit 2 and print the
candidates as refs.

**Scene sub-paths** are the YAML shape, verbatim, so what you read is what you address:

```
#tavern-night/bg              #tavern-night/camera/zoom
#tavern-night/cast/mira       #tavern-night/cast/mira/at
#tavern-night/props/candle    #tavern-night/fx
#tavern-night/beats/3         #tavern-night/links/stay/to
```

Quote refs with spaces. `twine-cli ref <ref>` resolves one and prints the canonical
`storyId/passageId#scene` form plus the file path it lives at — the debugging escape
hatch when a name is ambiguous.

---

## 2 — Command surface

```
twine-cli <group> <verb> [ref] [flags]
```

Global flags everywhere: `--server`, `--token`, `--profile`, `--json`, `--full`, `--brief`,
`--budget`, `--max-tokens`, `--limit`, `--offset`, `-o/--out`, `--dry-run`, `--yes`,
`-q/--quiet`.

### 2.1 Session and server

| Command | Does |
|---|---|
| `twine-cli use <story>` | pin a story for `.` refs; writes `.twine-cli.json` in cwd, or `--global` |
| `twine-cli where` | print the pinned story, the server, the walk cursor |
| `twine-cli ping` | `/ping` — version, story count, bytes, whether the socket is up, who else is connected |
| `twine-cli login [--server URL]` | store token in the profile (0600), verify with `/health` then `/ping` |
| `twine-cli watch [--story <ref>]` | tail the websocket as JSONL: `story`, `assets`, `presence`, `stolen`. Tier 2 |

### 2.2 Stories

| Command | Does |
|---|---|
| `ls [--all] [--deleted] [--sort rev\|name\|bytes]` | the index — one line per story, from `GET /stories`, no bodies downloaded. Carries the estimate: `ep3  rev 42  190p  ~78k ⚠` |
| `story show <ref>` | rev, updatedAt, lastClient, counts, top passages, scene ids, asset totals, lint tally |
| `story copy <src> --name "<new>"` | see §5 |
| `story new --name "<n>" [--from-template <ref>]` | empty story, new ifid |
| `story rename <ref> --name "<n>"` | |
| `story rm <ref> [--purge] --yes` | tombstone, or erase |
| `story revs <ref>` | `GET /revisions` — rev, when, who, bytes, passages, `restoredFrom` |
| `story get <ref>[@rev] [-o path]` | the raw JSON body to a file. Prints the path — the JSON itself is never worth printing |
| `story text <ref> [-o path]` | the whole story as readable text, §0 |
| `size <ref>` | est tokens, bytes, passages, scenes, mode, cached or not |
| `story diff <refA> <refB>` | passage-level diff between two revs or two stories. Full mode prints the hunks; brief mode prints names with a `+n/-n` count each |
| `story restore <ref> --rev N` | `POST /restore`; prints the new rev and any `missingAssets` |
| `story lint <ref>` | §7 |
| `story stat <ref>` | bytes, passages, scenes, beats, words, assets, orphans |

### 2.3 Passages

| Command | Does |
|---|---|
| `passage ls [<story>] [--tag t] [--scenes] [--orphans]` | ref, name, tags, lines, `scene:<id>` if it has one, out-degree |
| `passage show <ref>` | **the whole passage**, with a header line of ref, tags, links and scene id. Brief mode prints the header, the vars and the link table only — `--full` for the body |
| `passage get <ref> [-o path]` | full text to a file, path printed. `show` already prints it; this is for when you want it on disk |
| `passage cat <ref>... [--tag t] [--glob g]` | several passages in full, one after another |
| `passage new <story>/<name> [--tags] [--from-file f] [--at x,y]` | |
| `passage set <ref> --from-file f` | replace text wholesale |
| `passage rename <ref> --name "<n>" [--rewrite-links]` | renames and fixes every `[[link]]` and `links: to:` that pointed at it |
| `passage rm <ref> --yes` | |
| `passage links <ref>` | outgoing: name → target ref, `if:`, `transition:`, plus **broken** flags |
| `passage backlinks <ref>` | who points here |
| `grep <pattern> [<story>] [--scope prose\|scene\|vars\|links\|all] [-i] [-C n]` | `story/passage:12: matched line` — refs, not blobs |

### 2.4 Scenes

The centre of gravity. A scene is a `[scene]` YAML block inside a passage; the passage text
stays the source of truth (spec 07), so **every mutation here is a surgical `TextEdit` from
`@sliders/scene-edit`**, not a re-serialisation. Comments, key order and hand formatting
survive.

| Command | Does |
|---|---|
| `scene ls [<story>]` | `#id`, passage, cast count, beat count, `from:`, marks, link targets, errors |
| `scene show <ref>` | the summary header — id, from, bg, cast/props with `at`, fx, beats by kind, links, marks — and then the YAML block itself. Brief mode stops after the header |
| `scene get <ref> [-o path]` | the block's YAML, printed. Over `--max-tokens` (a very long beat list) it writes and prints the path |
| `scene set <ref> --from-file f` | replace the block, keeping the rest of the passage |
| `scene new <story>/<passage> --id <sceneId> [--from <ref>] [--bg <asset>]` | inserts a `[scene]` block |
| `scene rm <ref> [--keep-passage]` | |
| `scene reid <ref> --id <new>` | rewrites the id and every `from:` and `@mark` reference to it |
| `scene beats <ref>` | numbered beats, one line each: `3  say mira  "Get out."  {frame: angry}` |
| `scene states <ref>` | the compiled state sequence: index, mark, entity count, what changed vs the previous state. This is `scene-index` output, and it is how you check a scene without rendering it |
| `scene lint <ref>` | parse + cross-passage errors for one scene |
| `scene diff <refA> <refB>` | stage diff — entities added/removed/moved, using `scene-core.diffStages` |

Field-level edits address the sub-path directly:

| Command | Example |
|---|---|
| `set <ref> <value>` | `twine-cli set '.#tavern-night/cast/mira/at' -- -0.25` |
| `set <ref> --json` | `twine-cli set '.#tavern-night/cast/mira' --json '{"at":-0.25,"frame":"angry"}'` |
| `get <ref>` | `twine-cli get '.#tavern-night/cast/mira'` → `{at: -0.4, frame: arms-crossed}` |
| `rm <ref>` | `twine-cli rm '.#tavern-night/props/candle'` |
| `mv <ref> <ref>` | reorder a beat: `twine-cli mv '.#s/beats/5' '.#s/beats/2'` |
| `add <ref> --json` | append a beat: `twine-cli add '.#s/beats' --json '{"mira":"And yet."}'` |

`set`/`add`/`rm`/`mv` are one verb family over the whole ref space, so an agent learns four
words instead of twenty. What is legal at a path comes from the schema; an illegal one is
exit 2 with `keyHint()`'s suggestion — the same "did you mean `frame`?" the editor shows.

### 2.5 Assets and characters

| Command | Does |
|---|---|
| `asset ls [<story>] [--kind bg\|object\|frame\|fx] [--tag t] [--unused] [--missing]` | `story:a_8f21  bg  tavern-night  1280×720  184 KB  webp  ✓server` |
| `asset ls --scene <ref>` | **assets this scene needs** — §6 |
| `asset ls --passage <ref>` | same, for every scene in a passage |
| `asset get <ref> [-o path]` | downloads the bytes into the cache and prints the path. Never bytes on stdout |
| `asset put <story> <file> [--kind] [--name] [--tags]` | uploads bytes, then patches the manifest; prints the new asset ref |
| `asset rm <story>:<id> [--force]` | refuses while a scene references it, unless forced; lists the referring scene refs |
| `asset where <story>:<id>` | which scenes/passages use it, as refs |
| `asset diff <story>` | `POST /assets/diff` — what the server is missing, has, or has stale |
| `asset gc <story> [--dry-run]` | manifest entries no scene references, and blobs no manifest names |
| `char ls [<story>]` | id, name, frame count, size, tags |
| `char show <ref>` | frames table: name → asset ref, fit, anchors present |
| `char frames <ref> [-o dir]` | pulls every frame asset into a directory, prints the dir |

### 2.6 Walking

| Command | Does |
|---|---|
| `walk <story> [--from <passage>] [--order links\|name\|created]` | start a traversal; prints node 1 |
| `next [n]` | advance the cursor, print the next node |
| `prev`, `goto <ref>`, `walk --reset` | |
| `walk --list` | the whole traversal as refs only — the itinerary, cheap at any size |
| `graph <story> [--format tree\|dot\|jsonl] [--depth n] [--from <ref>]` | the link graph. `tree` is the map an agent reads once before deciding what to open |

A walk node is one passage: its ref, its full text in full mode, its scene summary, the
assets it needs, and the outgoing links as refs. That is the unit of "episode by episode",
and on a large story it is the way to read one that will not fit whole.

### 2.7 Working copy

| Command | Does |
|---|---|
| `checkout <story> [dir] [--assets\|--no-assets] [--rev N]` | explode a story into a directory — §4 |
| `status [dir]` | what changed locally, what changed on the server since the checkout rev |
| `pull [dir] [--force]` | re-fetch; refuses on local changes without `--force` |
| `push [dir] [--message m]` | reassemble, `PUT` with `If-Match`, print the new rev |

---

## 3 — Output, exits, and the cache

**Human output** is aligned columns, no borders, no colour when not a TTY. **`--json`** is
JSONL. **Every mutation** prints one line: `ok  <ref>  rev 42  (+3 −1 lines)`, and under
`--dry-run` the same line plus a unified diff of the passage text it would have written,
bounded by R1.

| Exit | Means |
|---|---|
| 0 | fine |
| 1 | not found (story, passage, scene, asset) |
| 2 | usage, ambiguous ref, or schema-invalid edit |
| 3 | conflict — the server's rev moved (HTTP 412) |
| 4 | server unreachable or auth rejected |
| 5 | lint found errors |

**The cache** is `${XDG_CACHE_HOME:-~/.cache}/twine-cli/<server-host>/<storyId>/`:
bodies by rev, asset blobs by id, the last written `.txt`/`.yaml` extracts, and an index
holding each story's exact estimate and mode so §0 is decided once, not per command. It is
content-addressed and disposable; `twine-cli cache path <ref>` prints where something
would land, `twine-cli cache clear` empties it. Every path the CLI prints is absolute, so
an agent can hand it straight to `Read` or `sed`.

---

## 4 — The working copy

For a heavy editing session, one download beats forty round trips — and it turns the story
into ordinary files that ordinary tools can grep.

```
<dir>/
  STORY.md                     the map: counts, passage table, scene table, lint tally
  passages/
    0001-tavern-night.md       whole passage text, verbatim and lossless
    0002-street.md
  scenes/
    tavern-night.yaml          derived: the [scene] block, alone
  assets/
    a_8f21.webp
  characters/
    mira.yaml
  .twine/
    ref.json                   server, story id, rev, etag, client id
    story.json                 the body exactly as pulled — the round-trip reference
    manifest.json              the asset manifest as pulled
    index.json                 name→file, scene→file, and a hash of each at checkout
```

**Two writable views of one text, and a rule that keeps them honest.** `passages/*.md` is
the source of truth; `scenes/*.yaml` is a derived extract that push splices back. On
`push`, for each scene, compare the hashes recorded in `index.json`:

| passage changed | scene file changed | push does |
|---|---|---|
| no | no | nothing |
| yes | no | takes the passage |
| no | yes | splices the YAML into the stored passage |
| yes | yes | **conflict**: exit 3, names both files, changes nothing |

Push rebuilds `story.json` from `.twine/story.json` with the edited passage texts
substituted — nothing else in the body is touched, so unknown and future fields survive —
then `PUT`s with `If-Match: "<rev>"`. A 412 is exit 3 and a suggestion:
`twine-cli pull --force` or `twine-cli story diff .@<yours> .@<theirs>`.

Assets are downloaded lazily unless `--assets`. A scene that names a missing blob shows up
in `status` as `missing asset`, not as a broken push.

---

## 5 — Copying a story

`twine-cli story copy <src> --name "Episode 4"`

| Thing | What happens | Why |
|---|---|---|
| story `id` | new uuid | it is a new story |
| `ifid` | new uuid | an IFID is stable across import/export of *the same* story; a copy is not it |
| passage `id`s | new uuids | ids are per story and a shared id makes the sync record lie |
| passage names, positions, tags | verbatim | |
| scene `id`s | verbatim by default, `--reid <prefix>` to rewrite | ids are unique *within* a story (spec 02), and the index is built per story, so two stories may share one. Rewriting is opt-in because it also has to rewrite every `from:` and `@mark` |
| `from:` and link targets | rewritten alongside any rename | a copy with dangling `from:` is worse than no copy |
| assets | `--assets copy` (default), `link`, or `none` | `copy` re-`PUT`s the blobs under the new story; `link` copies the manifest entries and relies on the source's blobs, which the janitor may reap — allowed, warned about, never the default |
| `sync` | not copied | it is never on the server anyway (spec 11) |
| revision history | not copied | the copy starts at rev 1 |

Useful shapes:

```sh
twine-cli story copy ep3 --name "Episode 4"                      # full clone
twine-cli story copy ep3 --name "Ep4 skeleton" --passages 'Act1/*' --no-assets
twine-cli story copy ep3 --name "Ep4" --reid ep4- --assets copy  # ids namespaced
twine-cli story copy ep3@37 --name "Ep3 rescue"                  # from an old rev
```

It prints the new story ref, the passage and asset counts, and any reference it could not
rewrite. Then `twine-cli use <new>`.

---

## 6 — Assets per scene

The question "what art does this scene need?" has no single field to read; it is a
resolution, and the CLI is where it belongs.

For scene `S`:

1. `bg:` → an asset id.
2. every entry in `props:` → its `ref` (defaulting to the key) → an asset id.
3. every entry in `cast:` → a **character** id → for each frame the scene actually names
   (`frame:` on the entity, `frame:` in any beat patch, plus the character's default
   frame) → that frame's asset id. `--all-frames` widens it to the whole character.
4. every `fx:` entry that names an asset-backed effect.
5. if `from:` is set, the same walk over the inherited scene, marked `inherited`.

Output, one line per asset, each starting with a ref:

```
ep3:a_8f21   bg      tavern-night     1280x720  184 KB  ✓server  bg
ep3:a_11c0   frame   mira/arms-crossed 512x1024  92 KB  ✓server  cast mira
ep3:a_44de   frame   mira/angry        512x1024  88 KB  ✗server  beats/2 patch
ep3:—        object  candle            —         —      missing  props/candle
```

`✗server` means the manifest names it but the store has no blob (the `missing` array of
`GET /assets`); `missing` means the scene names something the manifest does not have at
all. Both are lint errors, and both are the actual failure an agent needs to see before
it declares a scene done.

`--json` gives `{ref, kind, name, via, assetId, bytes, hash, onServer}` per line, `--paths`
downloads each and prints local paths instead, so "look at the three images this scene
uses" is one command and three `Read`s.

---

## 7 — Lint

`twine-cli lint [<story>|<ref>]` is the verification step after any edit. It runs, in
order, and reports every class with a ref and a line:

| Tier | From | Catches |
|---|---|---|
| YAML | `@sliders/scene-schema` | parse errors, unknown keys (with `keyHint` suggestions), bad coordinates |
| Cross-passage | `@sliders/scene-index` | duplicate scene ids, unknown `from:`, unknown `@mark`, `from:` cycles |
| Story graph | `scanLinkTargets` + passage names | links to passages that do not exist, unreachable passages, scene passages whose only exit is a `[[link]]` outside the block (spec 02: it will not be drawn) |
| Assets | manifest + `/assets/diff` | references to unknown assets, manifest entries with no blob, orphan blobs |

Exit 5 if anything is an error, 0 with warnings printed if only warnings. `--fix` handles
exactly the mechanical ones: prune orphan manifest entries, renumber beats, normalise
`at:` formatting through `scene-edit.formatAt`. Everything else it refuses to guess.

---

## 8 — Config, identity, concurrency

**Config** `~/.config/twine-cli/config.json`, 0600:

```json
{
  "profile": "prod",
  "profiles": {
    "prod":  {"server": "https://twine-story-store.tmpx.space", "token": "…"},
    "local": {"server": "http://127.0.0.1:8080", "token": "…"}
  },
  "clientId": "cli_9f31",
  "clientName": "twine-cli@taskbot"
}
```

`TWINE_STORE_URL`, `TWINE_STORE_TOKEN`, `TWINE_PROFILE` override the file; flags override
the environment. `--server` with no token in the profile is exit 4 with the `login` hint.

**Identity matters.** `clientId` is persisted, not per-process, and rides every request as
`X-Client-Id`, so the change bus does not echo the CLI's own writes back at an editor
session the same person has open, and `lastClient` reads `twine-cli@taskbot` in the
history list instead of `unknown`.

**Concurrency.** Every write is read-modify-write with `If-Match: "<rev>"`. On a 412 the
CLI retries **once** after re-reading, and only when its edit is a scene sub-path edit that
still applies cleanly to the new text; anything else is exit 3 and the user's call. It never
force-writes without `--force`.

**Locks are advisory** (spec 11). Before a write, `ping` shows who is focused where; if
another client holds the passage, a mutation warns and proceeds — the server enforces
nothing and neither should the CLI — unless `--strict`, which makes it exit 3 instead.

---

## 9 — Building it

TypeScript, in `packages/twine-cli`, bin `twine-cli`. Node 20, native `fetch`, no new
runtime dependency beyond `yaml`, which is already here.

It exists in this repo rather than beside the Go server because everything that makes it
more than curl is already TypeScript: `@sliders/scene-schema` parses, `@sliders/scene-index`
resolves `from:` and marks, `@sliders/scene-core` compiles states and diffs stages,
`@sliders/scene-edit` produces the surgical text edits, `@sliders/asset-store` owns id and
hash rules. A Go CLI would mean a second scene parser, and two parsers disagree the week
after they are written.

```
packages/twine-cli/src/
  bin.ts              arg parse, profile, exit codes
  ref.ts              the grammar in §1: parse, resolve, canonicalise, print
  client.ts           HTTP over the spec 11 API; ETag cache; If-Match; typed errors
  budget.ts           the estimate, the mode decision, the spill-to-path rule
  render/             table + jsonl writers, one place that enforces §0
  cmd/                one file per group: story, passage, scene, asset, char, walk, wc
  wc/                 working copy: checkout, index.json, splice, push
```

`src/store/persistence/server/client.ts` already speaks this API from the browser; the
node client reuses its types and its `ServerError` shape rather than re-deriving them, and
the two stay honest because both compile against `server.types.ts`.

**Tiers.** Ship 1 before designing 3.

| Tier | Commands |
|---|---|
| **1** | `login`, `ping`, `use`, `ls`, `size`, `story show/text/get/copy/revs`, `passage ls/show/cat/get`, `scene ls/show/get`, `asset ls --scene`, `asset get`, `grep`, `lint` |
| **2** | the `get/set/add/rm/mv` field family, `scene new/rm/reid/beats/states`, `passage new/set/rename`, `asset put/rm/where/gc`, `checkout/status/pull/push` |
| **3** | `walk/next/graph`, `story diff`, `scene diff`, `watch`, `char frames`, `--fix` |

**Tests** are the same fixtures the sync tests use (`test-fixtures.ts`), plus a spawned
real server — `go run . --addr 127.0.0.1:0` already prints its port for exactly this, and
the Playwright fixture proves the pattern.

---

## 10 — The skill

`.claude/skills/twine-cli/` wraps this for an agent: `SKILL.md` holds §0, the ref grammar
and the recipes; `references/commands.md`, `references/refs.md` and `references/recipes.md`
hold the rest, loaded only when needed. Its job is to teach one habit — `twine-cli size`
before a big read, and then read freely — not to make an agent nervous about a 15k-token
episode.
