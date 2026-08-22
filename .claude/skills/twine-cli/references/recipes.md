# Recipes

Each one is a full loop: find, read the minimum, change, verify. Working files go in `tmp/`.

## 1 — Audit an episode without reading it

```sh
twine-cli use ep3
twine-cli story show .                       # counts + lint tally
twine-cli lint .                             # exit 5 = broken; the refs tell you where
twine-cli scene ls . --limit 40              # every scene, one line
twine-cli graph . --format tree --depth 3    # the shape
twine-cli passage ls . --orphans             # unreachable
twine-cli asset ls . --missing               # art the store does not have
```

Only now open something, and open it by ref. Three summaries beat one download.

## 2 — Walk it node by node

```sh
twine-cli walk . --from Start
twine-cli next          # one passage per call: summary, beats, assets, outgoing links
twine-cli next
twine-cli goto '.#tavern-night'
```

Use this when the task is "go through the episode and check X". The cursor persists between
calls, so nothing accumulates in context. `twine-cli walk --list` first if you want the
itinerary before committing to it.

## 3 — Move a character, change a line

```sh
twine-cli scene show '.#tavern-night'                 # summary first — who is on stage
twine-cli get '.#tavern-night/cast/mira'              # {at: -0.4, frame: arms-crossed}
twine-cli set '.#tavern-night/cast/mira/at' -- -0.25
twine-cli scene beats '.#tavern-night'                # numbered
twine-cli set '.#tavern-night/beats/2' --json '{"mira":"Get out. Now."}'
twine-cli lint .                                      # ALWAYS
```

Never edit a beat by index without re-listing beats first if you already added or removed
one — indices shift.

## 4 — Retheme a scene's art

```sh
twine-cli asset ls --scene '.#tavern-night' --paths   # what it uses, on disk
# Read the printed paths to actually look at them
twine-cli asset put . tmp/tavern-dawn.webp --kind bg --name tavern-dawn
twine-cli set '.#tavern-night/bg' tavern-dawn
twine-cli asset where .:a_8f21                        # is the old bg used anywhere else?
twine-cli asset gc . --dry-run                        # what would be reaped
twine-cli lint .
```

## 5 — Copy an episode and strip it to a skeleton

```sh
twine-cli story copy ep3 --name "Episode 4" --reid ep4- --assets copy
twine-cli use "Episode 4"
twine-cli story show .                    # confirm counts and the new refs
twine-cli scene ls .                      # ids should all carry the ep4- prefix
twine-cli lint .                          # catches anything the reid failed to rewrite
```

`--assets link` shares blobs with the source and the janitor may reap them. Use `copy`
unless someone explicitly asked otherwise.

## 6 — Many edits at once

```sh
twine-cli checkout . tmp/ep3
rg 'frame: angry' tmp/ep3/scenes/         # normal tools on normal files
# edit tmp/ep3/passages/*.md or tmp/ep3/scenes/*.yaml — not both for the same scene
twine-cli status tmp/ep3
twine-cli push tmp/ep3
```

Exit 3 on push = someone else wrote while you worked. `twine-cli pull --force` throws your
copy away, so first: `twine-cli story diff .@<your rev> .` to see what you would lose.

## 7 — Rescue an old revision

```sh
twine-cli story revs .                          # newest first
twine-cli story diff .@37 .                     # what changed since
twine-cli story get .@37 -o tmp/ep3-r37.json    # a path, not a dump
twine-cli story restore . --rev 37              # prints the new rev and missingAssets
```

Restoring makes a new revision; it never rewrites history. If `missingAssets` is non-empty,
the art from that era is gone — `twine-cli asset diff .` confirms.
