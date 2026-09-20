# Bug: a client conflicts with itself (rev lag)

DIAGNOSED 2026-09-20, repro in a test, fix not landed. Found 2026-09-07, written up
2026-09-20. Feature: [11-server-storage](../11-server-storage.md).

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

Repro pinned: `__tests__/roundtrip.test.ts`, "parks in conflict when a keepalive push
loses its receipt".

### SECOND, smaller cause

`applyPull` (`use-server-sync.ts:503`) writes `fetched.rev` unconditionally. A pull in
flight when a push lands overwrites the newer rev with the older. Same one-behind
signature, needs two operations racing. Not yet reproduced.

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

## Related

The dirty-hash allowlist (`7e389cc8`) removes a DIFFERENT false conflict — `zoom` and
`snapToGrid` were hashed, so scrolling the map counted as an edit. Same symptom, different
cause; it does not touch this one.
