TwineJS modded repo.

Extensions:
- Sliders format
- scene editor in YAML
- character editor

After each larger unit of work, commit, push, auto deploy with `npm run deploy-cloudflare`

Commit struct:
```
short keyword summary title

- changes in list or short prose, caveman style

```

Always communicate caveman, be to the point, short, conscise sentences.

Use tmp for anything temporary, like agent browser, puppeteer screenshots, testing, temporary files.

## Shared working tree

Several sessions edit this checkout at once. Assume a peer is mid-edit in every file
you did not just write.

- **One `git worktree` per session** is the default. `git worktree add /cache/tmp/<name>
  <branch>`, symlink `node_modules`. Only then are your files yours.
- **Never `git add -A`.** Stage by path. `git commit -- <paths>` too, so a peer's staged
  entries survive.
- **`git diff --cached` before every commit.** Staging by name is not enough — `git add
  <path>` takes the whole file, peer's half-written lines included. For a file everyone
  touches (`en-US.json` always): `git diff -U0 -- <file>`, drop the hunks that are not
  yours, `git apply --cached --unidiff-zero`. `-U3` is too coarse.
- The **git index is shared too**. A peer may have things staged. Build the commit in a
  private index if so: `GIT_INDEX_FILE=… git read-tree HEAD`, add your paths, then
  `write-tree` + `commit-tree` + `update-ref`.
- **Never `npx prettier --write` a file you did not create.** ~53 src files were never
  formatted at all, so a `--write` reflows lines nobody wrote and buries your diff.
  Prettier is pinned (2.8.8) so at least the version cannot drift under you.
- **Deploy only from a clean `git worktree` at the pushed head.** The deploy script builds
  the WORKING TREE, so deploying from here ships everyone's half-finished work. Same for
  `npm run build:format` — a bundle built in a dirty tree carries a peer's uncommitted
  code.
- **One jest at a time on this box.** `pgrep -af 'bin/jest'` first, then
  `flock /cache/tmp/jest.lock npx jest --maxWorkers=2 --watchAll=false <paths>`.
  Never `npm test` (it is `--watch`).

## Changing the story format

`format/` is Chapbook vendored plus the Sliders layer. **Before you finish a change under
`format/`, check the previous functionality is still there — the CodeMirror ones above
all** (scene toolbar menu, scene syntax highlighting, scene commands, story-map arrows
from a scene's `links:`). They are silent when lost: the format still builds, loads and
plays; the passage editor just turns back into Chapbook's.

0.2.0 shipped exactly that way — the re-vendor took the editor extensions with it. Read
`format/README.md`, "Do not lose the Sliders half", before touching that directory, and
run `npm run build:format` plus `npx jest format/src/twine-extensions`.
