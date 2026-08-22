---
name: twine-cli
description: Work on Sliders/Twine stories that live on the story-store server — check one out as files, edit passages and scene YAML, resolve and read the assets a scene uses, lint, push. Use whenever a task touches a story on the server (twine-story-store, twine-store.tmpx.space, "the story store", "the library") rather than a local .twee/.html file, or when asked to copy an episode, move a character, change a beat, swap or generate a background, or find where an asset is used.
---

# twine-cli

Decode story to files. Work on files. Push. Spec: `docs/sliders/12-story-cli.md`.
Server: `docs/sliders/11-server-storage.md`. Scene YAML: `docs/sliders/02-sliders-format.md`.

Story on server = **one line JSON**. Every passage a string, scene YAML flattened to `\n`
escapes. `checkout` decode that to files, so line numbers, `rg` hits, `Edit` anchors exist.
Not a download — local mode fetch nothing.

## Loop

```sh
twine-cli checkout ep3 tmp/ep3
cat tmp/ep3/STORY.md          # map: passages, scenes with file:line, assets, lint tally
# ... Read / rg / Edit files like any repo ...
twine-cli lint tmp/ep3        # exit 5 = broken. Not optional.
twine-cli push tmp/ep3
```

Read and edit in checkout with `Read`, `rg`, `Edit`.

No checkout needed when not editing passage text — `assets`, `lint`, `graph`, `ls`, `revs`,
`copy` take story ref, read store direct:

```sh
twine-cli assets ep3 --scene tavern-night
twine-cli lint ep3
```

## Two rules

1. **Writes go through CLI** — `push`, `restore`, `copy`, `rm`. That bump rev, snapshot old
   version, tell open browser editors to update. (Reading server `data/` direct is fine and
   fast; CLI do it for you.)
2. **Lint before push.** Exit 5 = scene, link or asset ref needs fix. Clean lint = work done.

## Working copy

```
tmp/ep3/
  STORY.md                        generated map — read first
  passages/003-tavern-night.md    front matter + whole passage, scene YAML inside
  assets/bg/tavern-night.a_8f21.webp     symlinks to real blobs
  assets/char/desert-punk/idle.a_3450.webp
  characters/desert-punk.yaml
  .twine/                         rev, etag, pulled body. Leave alone.
```

Passage file:

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
```

- Front matter = `name`, `tags`, `at`. Rest of passage ride through untouched from
  `.twine/story.json`.
- **New file = new passage. Delete file = delete passage.** Filename cosmetic. `name:` renames,
  and push follow rename through every link that pointed at it.
- `[scene]` block live inside passage file. `STORY.md` give `file:line` per scene id, so open
  one = `Read` with offset.

## Assets = real paths

`assets/` hold symlinks to store actual blobs. Read them direct — feed one to image model,
look at background, compare two frames.

```sh
twine-cli assets tmp/ep3 --scene tavern-night   # what scene needs, resolved
twine-cli assets tmp/ep3 --missing              # referenced, no blob
twine-cli assets tmp/ep3 --unused               # in manifest, nothing use it
```

`--scene` resolve `bg:` + props + only character frames scene actually names. Print path, or
reason there is none.

**Add art:** write file to `assets/<kind>/<name>.webp` — no id in name. Push upload it, assign
id, rename file, update manifest. Kind from directory (`bg`, `obj`, `fx`, `char/<character>`).

## How big

`STORY.md` header has token estimate. Under ~50k: read whole `passages/` dir, usually fastest.
Over: use STORY.md tables and `twine-cli graph tmp/ep3 --format tree` to pick few files.

## Conflicts

Push send `If-Match`. Exit 3 = someone wrote while you worked, store untouched. Check story out
to second directory, compare, merge by hand. Or `pull --force` to take theirs — that discard
your copy, so ask first.

## Exit codes

`0` ok · `1` not found · `2` usage or ambiguous ref · `3` conflict · `4` server unreachable or
token rejected · `5` lint errors.

## More

- `references/commands.md` — all fifteen commands, flags
- `references/recipes.md` — copy episode, retheme scene, generate missing art, rescue old rev
