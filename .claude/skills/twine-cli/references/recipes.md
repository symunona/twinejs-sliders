# Recipes

Temp files go in `tmp/`.

## 1 — Read an episode

```sh
twine-cli map ep3
```

Header carry token estimate. Under ~50k: `twine-cli cat ep3 --all -o tmp/ep3/` and read the
lot. Over: map tables plus `twine-cli graph ep3 --format tree` pick the few passages.

Know what was already broken:

```sh
twine-cli lint ep3
```

## 2 — Move character, change line

```sh
twine-cli map ep3 | rg "Tavern Night"            # which passage, which line
twine-cli cat "ep3/Tavern Night" -o tmp/p.md    # passage = its scene
# Edit tmp/p.md: cast.mira.at -0.4 -> -0.25, beats[2] text
twine-cli lint tmp/p.md
twine-cli put "ep3/Tavern Night" tmp/p.md
```

Scene block is plain YAML in the file — normal `Edit`. Keep author formatting and comments.
Leave `story`, `rev`, `hash` in front matter alone.

## 3 — Long edit, stay current

```sh
twine-cli check tmp/p.md          # fresh / stale-elsewhere / conflict
twine-cli cat "ep3/Tavern Night" -o tmp/p.md --refresh   # re-take; refuse if you edited
```

`put` do the same test anyway. `check` just let you find out before you write more.

## 4 — Look at art a scene uses

```sh
twine-cli assets ep3 --scene "Tavern Night"
```

Every row a real path. Read them. `--missing` = scene name it, store lack blob. `--unused` =
manifest entry nothing reference.

## 5 — Generate missing background

```sh
twine-cli assets ep3 --scene "Tavern Night" --missing    # the gap
# read a sibling bg for style, generate, write tmp/tavern-dawn.webp
twine-cli put ep3:tavern-dawn tmp/tavern-dawn.webp --kind bg
twine-cli cat "ep3/Tavern Night" -o tmp/p.md
# set: bg: tavern-dawn
twine-cli lint tmp/p.md && twine-cli put "ep3/Tavern Night" tmp/p.md
```

## 6 — Copy episode

```sh
twine-cli copy ep3 --name "Episode 4"
twine-cli map "Episode 4"
twine-cli lint "Episode 4"
```

New story id, new IFID, new passage ids. Passage names kept, so `from:` still resolve.

## 7 — Rescue old revision

```sh
twine-cli revs ep3                                   # newest first
twine-cli cat ep3@37/Tavern\ Night -o tmp/old.md     # old text, read only
diff tmp/old.md tmp/p.md
twine-cli restore ep3 --rev 37                       # new rev on top; history stay intact
```

`restore` report `missingAssets` → art from that era gone. Confirm with `twine-cli assets ep3
--missing`.

## 8 — Someone changed the same passage

`put` exit 3, store untouched.

```sh
twine-cli cat "ep3/Tavern Night" -o tmp/theirs.md      # what is there now
diff tmp/theirs.md tmp/p.md                          # merge by hand into tmp/p.md
twine-cli cat "ep3/Tavern Night" -o tmp/p.md --refresh --force   # or drop yours, re-take
```

Merging is yours to do. CLI never merge, never force.
