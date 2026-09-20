# Bug: a client conflicts with itself (rev lag)

OPEN. Found 2026-09-07, written up 2026-09-20. Feature: [11-server-storage](../11-server-storage.md).

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

Out-of-order landing leaves the record behind by exactly one — e.g. the socket echo of
your own push arriving after its response, or a pull writing a stale value.

## Status

- Push path reads CORRECT today: it stores `result.rev`.
- So the lag most likely comes from one of the other writers racing it. **Suspicion, not
  verified.**
- Ruled out: asset writes. The manifest has its own rev (`server/store/assets_test.go`),
  so an asset push cannot move the story's.

## To pin it

Race a push against the socket echo — two writes in flight, assert the stored rev equals
the server's after both settle. No e2e covers this; `e2e/server-sync.spec.ts` is the place.

## Fix shapes, if it reproduces

1. One writer. Every path routes its rev through the sync queue rather than writing the
   record directly.
2. Monotonic guard. Never write a rev lower than the stored one — cheap, hides the cause.
3. Trust the server on 412: refetch the rev and retry once before parking in `conflict`.
   A self-conflict is not a conflict.
