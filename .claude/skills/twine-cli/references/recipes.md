# Recipes

Working copies go in `tmp/`.

## 1 — Read an episode

```sh
twine-cli checkout ep3 tmp/ep3
cat tmp/ep3/STORY.md
```

The header says how many tokens the passages are. Under ~50k: read `tmp/ep3/passages/`
outright. Over: use the passage and scene tables to pick files, and
`twine-cli graph tmp/ep3 --format tree` for the shape.

Before changing anything, know what was already broken:

```sh
twine-cli lint tmp/ep3
```

## 2 — Move a character, change a line

`STORY.md` gives the scene's `file:line`. Open it, edit the YAML in place, lint.

```sh
rg -n 'id: tavern-night' tmp/ep3/passages/     # or read the STORY.md row
# Edit: cast.mira.at -0.4 -> -0.25, beats[2] text
twine-cli lint tmp/ep3
twine-cli push tmp/ep3
```

The scene block is plain YAML inside the passage file — normal `Edit`. Keep the author's
formatting and comments; you are editing their text.

## 3 — Look at the art a scene uses

```sh
twine-cli assets tmp/ep3 --scene tavern-night
```

Every row is a real path. Read them. `--missing` shows what the scene names but the store
does not have; `--unused` shows manifest entries nothing references.

## 4 — Generate the missing background

```sh
twine-cli assets tmp/ep3 --scene tavern-night --missing   # the gap, and where it goes
# read a sibling bg for style, generate, write the result:
#   tmp/ep3/assets/bg/tavern-dawn.webp      <- no id in the name
twine-cli push tmp/ep3                                    # uploads it, assigns the id
twine-cli assets tmp/ep3 | rg tavern-dawn                 # confirm the id it got
# point the scene at it: bg: tavern-dawn
twine-cli lint tmp/ep3 && twine-cli push tmp/ep3
```

Kind comes from the directory: `bg/`, `obj/`, `fx/`, `char/<character>/`.

## 5 — Copy an episode

```sh
twine-cli copy ep3 --name "Episode 4" --reid ep4-
twine-cli checkout "Episode 4" tmp/ep4
twine-cli lint tmp/ep4          # catches anything --reid failed to rewrite
```

New story id, new IFID, new passage ids. `--reid` also rewrites every `from:` and `@mark`.

## 6 — Rescue an old revision

```sh
twine-cli revs ep3                        # newest first
twine-cli checkout ep3@37 tmp/ep3-r37     # the old one, as files, read-only history
diff -ru tmp/ep3-r37/passages tmp/ep3/passages
twine-cli restore ep3 --rev 37            # makes a new rev on top; history stays intact
```

If `restore` reports `missingAssets`, the art from that era is gone — `twine-cli assets
tmp/ep3 --missing` confirms after a fresh checkout.

## 7 — Someone else wrote while you worked

`push` exits 3 and uploads nothing.

```sh
twine-cli status tmp/ep3                  # your rev vs theirs, and who
twine-cli checkout ep3 tmp/ep3-theirs     # their version, side by side
diff -ru tmp/ep3-theirs/passages tmp/ep3/passages
# merge by hand into tmp/ep3, then push again. Or take theirs wholesale:
twine-cli pull tmp/ep3 --force            # discards your copy — ask first
```
