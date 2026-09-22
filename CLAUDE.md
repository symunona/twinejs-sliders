# twinejs-sliders

TwineJS fork. Adds the **Sliders** story format, a YAML scene editor, a character editor,
an asset store and a sync server.

Always communicate caveman: short, concise, to the point. Docs too.

## Read before you work

| File | When |
|---|---|
| `.claude/ARCHITECTURE.md` | Always. Cross-cutting invariants and the reasons behind them. |
| `.claude/TRAPS.md` | Before debugging anything that "should work". Counted, recurring. |
| `.claude/ENVIRONMENT.md` | Run, test, deploy, `twine-cli`, e2e. |
| `format/README.md` | Before touching `format/`. Non-negotiable. |
| `docs/sliders/02-sliders-format.md` + `packages/scene-schema/src/parse-scene.ts` | Scene YAML keys and grammar. The parser is the spec. |
| `docs/sliders/` | Per-feature specs, 01..15. |
| `docs/sliders/archive/2026-log.md` | Only when digging for why something is the way it is. Not loaded. |

Do not restate in CLAUDE.md what the code, a spec or a test already says.

## Shared working tree

Several sessions edit this checkout at once. Assume a peer is mid-edit in every file you
did not just write.

- **One `git worktree` per session** is the default. `git worktree add /cache/tmp/<name>
  <branch>`, symlink `node_modules`. Only then are your files yours.
- **Never `git add -A`.** Stage by path. `git commit -- <paths>` too.
- **`git diff --cached` before every commit.** See `.claude/TRAPS.md` § Shared working tree
  for unpicking a peer's lines and for the private-index recipe.
- **Never `npx prettier --write` a file you did not create.**
- **Deploy and `build:format` only from a clean worktree at the pushed head.**
- Check feature branches after each work session, warn if there are left behind!

## Loop

After each larger unit: commit, push, `npm run deploy-cloudflare`.

```
short keyword summary title

- changes in list or short prose, caveman style
```

## Tests

One jest at a time on this box — `pgrep -af 'bin/jest'`, then the flock. Never `npm test`.
Details in `.claude/ENVIRONMENT.md`.

## Changing the story format

`format/` is Chapbook vendored plus the Sliders layer. The editor half is **silent when
lost** — the format still builds, loads and plays, the passage editor just turns back into
Chapbook's. 0.2.0 shipped that way for a day.

Read `format/README.md`. Then `npm run build:format` and
`npx jest format/src/twine-extensions`.

## Temp files

`/root/tmp` for screenshots, agent-browser output, scratch.
