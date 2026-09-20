# Bug: a client conflicts with itself (rev lag)

**FIXED 2026-09-20**, commit "sync: verify a conflict before parking one" (named, not
sha'd — it was cherry-picked onto `sliders`). Shape **3** (verify before declaring a
conflict) plus shape **2** (monotonic rev guard) as the backstop, as the Fix section
below called for. Found 2026-09-07, diagnosed and written up 2026-09-20. Feature:
[11-server-storage](../11-server-storage.md).

## Symptom

After a SUCCESSFUL push, the stored `rev` is one behind the server's. Next edit sends
`If-Match: 3` against rev 4 → `412` → story parks in `conflict` → nothing syncs again.
One browser, no second client.

Was invisible for an hour at a time: the editor toolbar read "Synced <time>" throughout.
Fixed 2026-09-19 (`722bae62`) — the editor now says **Sync: conflict** and opens the
resolve dialog. The lag itself is untouched.

## Mechanism

`rev` is the story version counter. Server bumps it on every write; client sends its last
known one as `If-Match`. ONE number, SEVERAL writers:

| Writer | Rev from |
|---|---|
| push success — `sync-queue.ts:254` | the PUT response |
| pull — `applyPull`, `use-server-sync.ts:503` | the fetched rev |
| socket `story` event — `use-server-sync.ts:979-1020` | the message rev; one branch KEEPS the old one |
| publish / checkout / resolve — `use-server-sync.ts:1227,1269,1350` | their own results |

## Verdict (2026-09-20)

**Not a race between writers. A write that lands and loses its receipt.**

### RULED OUT: the socket echo

The earlier suspicion — "the socket echo of your own push arriving after its response" —
**cannot happen**. `hub.broadcast(msg, exceptID)` (`server/hub/hub.go:193,251`) skips the
writer, and the id matches on both transports: `backendClientId` feeds the HTTP
`X-Client-Id` header (`client.ts:231`, read at `server/api/http.go:109`) AND the socket
`hello.client` (`use-server-sync.ts:456` vs `:1063`). One pref, one value. A client never
receives its own `story` event.

### CAUSE: the keepalive flush on tab hide

`visibilitychange → hidden` fires `queue.flushAll({keepalive: true})`
(`use-server-sync.ts:927-938`). `keepalive` lets the REQUEST outlive the document —
that is the point. The `.then` that records the result does not:

```
sync-queue.ts:250-262
  result = await putStory(...)     ← server already wrote, rev 3→4
  this.write(storyId, {rev: result.rev, pushedHash: hash, ...})   ← never runs
```

Page hidden, discarded or bfcached → `rev` AND `pushedHash` both stay stale. Next load:

| | value | |
|---|---|---|
| `record.rev` | 3 | never updated |
| `record.pushedHash` | old | never updated → **dirty = true** |
| `server.rev` | 4 | the write that landed |

`reconcileDecision(dirty, behind)` → **conflict**. One browser, no second client, exactly
one behind, and nobody watching a hidden tab.

Repro pinned: `__tests__/roundtrip.test.ts`, `describe('rev lag')`, whose `lagged()`
arranges exactly this. "leaves the record one rev behind, with nothing to conflict about"
states what is TRUE of it; "does not call it a conflict when one browser agrees with
itself" was the `it.failing` that the fix turned red.

### SECOND, smaller cause

`applyPull` (`use-server-sync.ts:503`) writes `fetched.rev` unconditionally. A pull in
flight when a push lands overwrites the newer rev with the older. Same one-behind
signature, needs two operations racing. Not reproduced in a browser; pinned by the
monotonic-guard tests instead.

### Ruled out earlier, still ruled out

Asset writes. The manifest has its own rev (`server/store/assets_test.go`, and
`fake-server.ts` models it), so an asset push cannot move the story's.

## Fix

Shape **3** from the list below, plus **2** as a cheap backstop. NOT shape 1 — the writers
never disagreed, so routing them through one place fixes nothing here.

1. ~~One writer.~~ Real refactor, fixes none of the above.
2. Monotonic guard. Never write a rev lower than the stored one. One line, hides the
   cause, worth having anyway for the `applyPull` race.
3. **Trust the server on 412: refetch, compare CONTENT, and only park if it genuinely
   diverged. A self-conflict is not a conflict.**

Shape 3 is the same change as the false-conflict fix for view state and for a cleared
`localStorage`: stop deciding `conflict` on a proxy (my hash ≠ my last push) and decide it
on evidence (my content ≠ the server's content). It also gives per-passage merge for free,
since verifying means holding both sides.

## As built (2026-09-20)

### New module `src/store/persistence/server/reconcile.ts`

`reconcileDecision` MOVED here from `use-server-sync.ts` — the hook and the push queue
both need the verification and neither may import the other. `use-server-sync.ts`
re-exports it, so no reader changed.

| export | does |
|---|---|
| `reconcileDecision` | the pure table, unchanged. `conflict` out of it now means SUSPECTED |
| `verifyConflict` | GET the story, compare `storyHash`. Equal → repair the record, `resolved`. Else `conflict` |
| `reconcileVerified` | table + verification. One answer, one code path, two callers |

`verifyConflict` on a match writes `rev`, `pushedHash`, clears `conflictRev`/
`conflictClient`/`lastError`, `state: 'idle'` — the receipt the keepalive push never got,
written down late. `pushedHash` comes from the story that was COMPARED, not from the
store, so an edit landing mid-fetch still reads dirty and still goes up.

### Two call sites

| path | where | when |
|---|---|---|
| next page load | `reconcileStory` (`use-server-sync.ts`) | poll or socket says `conflict` |
| next edit | `SyncQueue.fail()` on a 412 (`sync-queue.ts`) | PUT refused |

`fail()` is `async` now and takes the story + hash that were SENT — `entry.story` can have
moved on mid-flight, and a 412 must be checked against the body the server refused.
Resolved there, the entry is dropped and a superseded edit re-queued, so nothing typed
during the push is lost.

Only on a suspected `conflict`, never on every reconcile. One extra GET on a path that
already costs the author a dialog.

### EVERY failure path parks

Fetch throws, 304, or a body that is not a story → `conflict`. A check that could not be
carried out is not evidence of agreement, and swallowing a real conflict because the wifi
died loses work. Logged as `conflict: unverified`.

### Monotonic rev guard

`merge()` in `sync-record.ts`, so every writer gets it — module functions, `localStorage`
store, memory store. `changes.rev < previous.rev` → kept, and `logSync('record', 'rev not
lowered')`. An absent `rev` in the changes is untouched.

**The escape is `remove()` then write, never a silent exception.** Two callers legitimately
throw the bookkeeping away and both now say so:

| caller | why |
|---|---|
| `publish()` | PUT carries no `If-Match`; it overwrites whatever is there, so `rev: 0` is honest |
| `checkoutStory()` | takes the server's copy wholesale, possibly from a different backend |

Everything else only ever moves a rev up: push receipt, `applyPull`, revive, resolve,
socket. `applyPull` is the one the guard exists for — a pull in flight when a push lands.

### Log

`logSync` notes, all `reconcile` unless marked: `conflict: confirmed`, `conflict:
unverified`, `conflict` (parked), and `record` / `conflict: resolved, same content`,
`record` / `rev not lowered`. `installSyncLogDebugHook(window)` is now actually CALLED, in
`useServerSync`, so `window.__slidersSyncLog.enable()` works in a live session.

### Tests

`__tests__/roundtrip.test.ts`. The `it.failing` acceptance test went RED ("Failing test
passed even though it was supposed to fail") and was flipped to `it`; its assertion is
untouched. Its helper `decisionFor` now calls `reconcileVerified` — it always claimed to
be what the hook decides, and after this it has to go through the same function or it is a
second opinion. Verified both ways: `it.failing` red against the fix, `it` red against the
fix stubbed out.

Added: record repaired + next edit pushes; 412 path resolving; verification fetch failing
→ parks, then clears when the network returns; **a genuine two-browser conflict still
parking, with nothing overwritten**; a 412 that could not be checked parking;
`verifyConflict` directly (resolved / differ / story absent / wrong hash); four guard
cases including the `remove()` escape. 164 green in the directory, `tsc --noEmit` clean.

### Left alone, worth knowing

- The side table is NEVER cleared when `backendUrl` changes, so revs from two different
  servers share one record. Pre-existing. The guard makes it slightly stickier, and
  `checkoutStory`'s escape plus `verifyConflict` repair the usual way in.
- `verifyConflict` deliberately does NOT resolve on `lastClient === me`. `backendClientId`
  is one pref shared by every tab of a browser, so "I wrote it last" is not "this tab
  wrote it last". Content is the only thing that settles it.
- Residual, narrow: tab hidden, keepalive push lands, tab comes BACK without a reload, and
  the author edits again before any poll. Local is then genuinely ahead of the server, so
  the 412 verification confirms a conflict. The reload path (call site 1) covers the
  reported symptom; this one needs a real three-way merge, not a hash compare.
- The editor still has no conflict UI of its own — `ResolveConflictButton` is story-list
  only. Unchanged by this.

## Related

The dirty-hash allowlist (`7e389cc8`) removes a DIFFERENT false conflict — `zoom` and
`snapToGrid` were hashed, so scrolling the map counted as an edit. Same symptom, different
cause; it does not touch this one.
