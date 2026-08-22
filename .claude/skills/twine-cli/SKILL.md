---
name: twine-cli
description: Work on Sliders/Twine stories that live on the story-store server — check one out as files, edit passages and scene YAML, resolve and read the assets a scene uses, lint, push. Use whenever a task touches a story on the server (twine-story-store, twine-store.tmpx.space, "the story store", "the library") rather than a local .twee/.html file, or when asked to copy an episode, move a character, change a beat, swap or generate a background, or find where an asset is used.
---

# twine-cli

Check the story out as files. Work on the files. Push. Spec: `docs/sliders/12-story-cli.md`.
Server: `docs/sliders/11-server-storage.md`. Scene YAML: `docs/sliders/02-sliders-format.md`.

## The loop

```sh
twine-cli checkout ep3 tmp/ep3
cat tmp/ep3/STORY.md          # the map: passages, scenes with file:line, assets, lint tally
# ... Read / rg / Edit the files like any repo ...
twine-cli lint tmp/ep3        # exit 5 = broken. Not optional.
twine-cli push tmp/ep3
```

That is the job. The CLI has no command that prints a passage, a scene or a search result —
`Read`, `rg` and `Edit` do that better, on the checkout.

## Two rules

1. **Never write into the server's `data/` directory.** Reading it is fine and fast; writing
   skips the rev bump and the change notification, so an open browser editor will silently
   overwrite you and the server will think nothing happened. Writes go through `push`,
   `restore`, `copy`, `rm` — nothing else.
2. **Lint before push.** Exit 5 means you broke a scene, a link or an asset reference. Don't
   report success without a clean lint.

## The working copy

```
tmp/ep3/
  STORY.md                        generated map — read it first
  passages/003-tavern-night.md    front matter + whole passage, scene YAML inside it
  assets/bg/tavern-night.a_8f21.webp     symlinks to the real blobs
  assets/char/desert-punk/idle.a_3450.webp
  characters/desert-punk.yaml
  .twine/                         rev, etag, the pulled body. Don't edit.
```

A passage file:

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

- Front matter is `name`, `tags`, `at`. Everything else about the passage is carried through
  untouched — leave it alone.
- **New file = new passage. Deleted file = deleted passage.** The filename is cosmetic;
  `name:` is what renames, and push rewrites the links that pointed at the old name.
- The `[scene]` block lives inside the passage. There is no separate scene file. `STORY.md`
  gives you `file:line` for every scene id.

## Assets are real paths

`assets/` holds symlinks to the store's actual blobs. Read them directly — feed one to an
image model, look at a background, compare two frames.

```sh
twine-cli assets tmp/ep3 --scene tavern-night   # what this scene needs, resolved
twine-cli assets tmp/ep3 --missing              # referenced but no blob
twine-cli assets tmp/ep3 --unused               # in the manifest, nothing uses it
```

`--scene` resolves `bg:` + props + only the character frames the scene actually names, and
prints a path or the reason there isn't one.

**Adding art:** write the file into `assets/<kind>/<name>.webp` — no id in the name. Push
uploads it, assigns the id, renames the file, updates the manifest. Kind comes from the
directory (`bg`, `obj`, `fx`, `char/<character>`).

## How big is it

`STORY.md`'s header has a token estimate. Under ~50k, reading the whole `passages/`
directory is fine and usually fastest. Over it, use the tables in `STORY.md` — and
`twine-cli graph tmp/ep3 --format tree` — to pick the few files that matter.

## Conflicts

Push sends `If-Match`. Exit 3 means someone wrote while you worked; nothing was uploaded.
Check the story out again into a second directory to compare, or `pull --force` to throw
your copy away. Never force past a conflict unasked.

## Exit codes

`0` ok · `1` not found · `2` usage or ambiguous ref · `3` conflict · `4` server unreachable
or token rejected · `5` lint errors.

## More

- `references/commands.md` — all fifteen commands and their flags
- `references/recipes.md` — copy an episode, retheme a scene, generate missing art, rescue an old rev
