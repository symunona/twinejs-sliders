# Recipes

Working copies go in `tmp/`.

## 1 — Read an episode

```sh
twine-cli checkout ep3 tmp/ep3
cat tmp/ep3/STORY.md
```

Header say how many tokens the passages are. Under ~50k: read `tmp/ep3/passages/` outright.
Over: use passage and scene tables to pick files, plus `twine-cli graph tmp/ep3 --format tree`
for shape.

Know what was already broken before you touch it:

```sh
twine-cli lint tmp/ep3
```

## 2 — Move character, change line

`STORY.md` give scene `file:line`. Open it, edit YAML in place, lint.

```sh
rg -n 'id: tavern-night' tmp/ep3/passages/     # or read STORY.md row
# Edit: cast.mira.at -0.4 -> -0.25, beats[2] text
twine-cli lint tmp/ep3
twine-cli push tmp/ep3
```

Scene block is plain YAML inside passage file — normal `Edit`. Keep author formatting and
comments; you edit their text.

## 3 — Look at art a scene uses

```sh
twine-cli assets ep3 --scene tavern-night      # no checkout needed
```

Every row is a real path. Read them. `--missing` = scene name it, store lack blob. `--unused` =
manifest entry nothing reference.

## 4 — Generate missing background

```sh
twine-cli assets tmp/ep3 --scene tavern-night --missing   # gap, and where it goes
# read sibling bg for style, generate, write result:
#   tmp/ep3/assets/bg/tavern-dawn.webp      <- no id in name
twine-cli push tmp/ep3                                    # upload, assign id
twine-cli assets tmp/ep3 | rg tavern-dawn                 # confirm id
# point scene at it: bg: tavern-dawn
twine-cli lint tmp/ep3 && twine-cli push tmp/ep3
```

Kind from directory: `bg/`, `obj/`, `fx/`, `char/<character>/`.

## 5 — Copy episode

```sh
twine-cli copy ep3 --name "Episode 4" --reid ep4-
twine-cli checkout "Episode 4" tmp/ep4
twine-cli lint tmp/ep4          # catch anything --reid failed to rewrite
```

New story id, new IFID, new passage ids. `--reid` also rewrite every `from:` and `@mark`.

## 6 — Rescue old revision

```sh
twine-cli revs ep3                        # newest first
twine-cli checkout ep3@37 tmp/ep3-r37     # old one as files
diff -ru tmp/ep3-r37/passages tmp/ep3/passages
twine-cli restore ep3 --rev 37            # new rev on top; history stay intact
```

`restore` report `missingAssets` → art from that era gone. Confirm with `twine-cli assets ep3
--missing`.

## 7 — Someone wrote while you worked

`push` exit 3, upload nothing.

```sh
twine-cli status tmp/ep3                  # your rev vs theirs, and who
twine-cli checkout ep3 tmp/ep3-theirs     # their version side by side
diff -ru tmp/ep3-theirs/passages tmp/ep3/passages
# merge by hand into tmp/ep3, push again. Or take theirs whole:
twine-cli pull tmp/ep3 --force            # discard your copy — ask first
```
