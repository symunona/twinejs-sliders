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
twine-cli map ep3 | rg tavern-night              # which passage, which line
twine-cli cat ep3#tavern-night -o tmp/p.md       # passage holding that scene
# Edit tmp/p.md: cast.mira.at -0.4 -> -0.25, beats[2] text
twine-cli lint tmp/p.md
twine-cli put ep3#tavern-night tmp/p.md
```

Scene block is plain YAML in the file — normal `Edit`. Keep author formatting and comments.
Leave `story`, `rev`, `hash` in front matter alone.

## 3 — Long edit, stay current

```sh
twine-cli check tmp/p.md          # fresh / stale-elsewhere / conflict
twine-cli cat ep3#tavern-night -o tmp/p.md --refresh   # re-take; refuse if you edited
```

`put` do the same test anyway. `check` just let you find out before you write more.

## 4 — Look at art a scene uses

```sh
twine-cli assets ep3 --scene tavern-night
```

Every row a real path. Read them. `--missing` = scene name it, store lack blob. `--unused` =
manifest entry nothing reference.

## 5 — Generate missing background

```sh
twine-cli assets ep3 --scene tavern-night --missing    # the gap
# read a sibling bg for style, generate, write tmp/tavern-dawn.webp
twine-cli put ep3:tavern-dawn tmp/tavern-dawn.webp --kind bg
twine-cli cat ep3#tavern-night -o tmp/p.md
# set: bg: tavern-dawn
twine-cli lint tmp/p.md && twine-cli put ep3#tavern-night tmp/p.md
```

## 6 — Copy episode

```sh
twine-cli copy ep3 --name "Episode 4" --reid ep4-
twine-cli map "Episode 4"
twine-cli lint "Episode 4"        # catch anything --reid failed to rewrite
```

New story id, new IFID, new passage ids. `--reid` also rewrite every `from:` and `@mark`.

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
twine-cli cat ep3#tavern-night -o tmp/theirs.md      # what is there now
diff tmp/theirs.md tmp/p.md                          # merge by hand into tmp/p.md
twine-cli cat ep3#tavern-night -o tmp/p.md --refresh --force   # or drop yours, re-take
```

Merging is yours to do. CLI never merge, never force.
