# History enrichment — labelled revisions

Status: planned. 2026-09-22. Separate ticket from voice mode.

Today **History…** lists `when / who / passages / bytes`. Every row looks alike. Finding
"the one before I broke the tavern" means restoring and reading.

Two parts, independent. Ship 1 alone if 2 slips.

## 1 — Manual labels + pinning

| Field | On | Is |
|---|---|---|
| `label` | `revs/index.json` entry | free text, ≤120 chars |
| `pinned` | same | prune skips it |

- `POST /stories/{id}/revisions/{rev}/label` → `{label?, pinned?}`. Not a write of the
  story: no rev bump, no snapshot, no broadcast of `story`. Broadcast `revmeta` so open
  History dialogs update.
- Prune (`server/store/story.go`, `REV_KEEP` default 20, `server/config.go:132`) counts
  **unpinned** revs only. Pinned live forever. Cap pinned per story (say 50) so a bad
  script cannot fill the disk.
- UI: pencil on each History row, pin toggle. Pinned rows sort in place, marked.
- Voice mode's `checkpoint(label)` tool is exactly this endpoint.

## 2 — Autosave labels, derived

Autosave has no words for what it did. Derive them from the patch — the client already
computes one.

`src/store/persistence/server/story-diff.ts` → `diffFromSnapshot()` gives `StoryPatch`:
changed passages whole, plus deletions. That is enough for a sentence.

```
"Tavern Night"                       one passage's text changed
"Tavern Night +2 more"               three
"+ Street Dawn"                      created
"− Old Intro"                        deleted
"Tavern Night renamed → Tavern Dusk" name field only
"moved 4 passages"                   only position changed
"story settings"                     no passage changed
```

### Where it is computed

**Client, sent with the PUT/PATCH.** Not the server.

- Client already has both sides (snapshot + current). Server has only the incoming body
  and would have to diff a 100 KB story on every autosave to say the same thing.
- Client knows *intent* the bytes do not: a drag is `moved`, a find-replace is
  `find & replace`, a voice tool call is its own tool name. Pass it in.

Wire: `summary` field beside `client` in the PUT/PATCH body. Server stores it on the rev
entry as `summary`, separate from user `label`. Never trusted for anything but display —
clamp length, strip control chars.

```ts
// new, beside story-diff.ts
export function patchSummary(patch: StoryPatch, base: Story): string
```

Pure over the patch the client is already sending. Testable with no network. The three
existing patch callers stay untouched.

### Intent override

`SyncQueue` gains an optional `reason` set by the action that dirtied the story —
`'find-replace'`, `'import'`, `'voice:patch_scene'`, `'restore'`. Present → used instead
of the derived text. Absent → derive. Plain typing derives, and that is the common case.

### Display

History row: `10:12  mira  Tavern Night +2 more   14 passages  82 KB`. Label, when a human
wrote one, replaces the derived summary and shows a pencil.

## Not doing

- Diffing between two revs in the UI. Wanted, bigger, own ticket.
- Branches.
- Per-passage history. `revs/` holds whole bodies; per-passage means a different store.
