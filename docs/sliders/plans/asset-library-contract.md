# Asset library — wire contract

Status: binding for server (`server/lib/`) and client (`packages/asset-library`).
Plans 1 + 2 explain why. This file says exactly what. Change here first, then code.

Deviations from plan 2, on purpose:
- Everything under `/api/v1/lib/`. Keeps old routes alive until removed.
- No `/blobs/similar`. Every client holds every record; similarity runs locally over
  `pixelHash` / `phash` stored on asset records.
- Usage and story → collection binding are their own record type `binding`. Story sync
  untouched.
- Every client syncs **all records** (small JSON). Blobs fetched lazily, prefetched for
  collections bound to a locally open story.

## Record envelope

Every record, every type:

```json
{
  "id": "uuid v4",
  "type": "collection | asset | character | binding",
  "rev": 7,
  "deleted": false,
  "by": "ana",
  "at": "2026-09-28T14:02:11Z",
  "...": "type fields"
}
```

- `rev`, `by`, `at` are server-assigned. Client values ignored.
- `by` = the existing client-identity header the server already reads for story writes.
- Unknown fields: stored and returned verbatim. Server never strips.

## Types

| type | path | server-validated fields | rest (opaque to server) |
|---|---|---|---|
| `collection` | `collections` | `name` (unique team-wide among non-deleted), `kind` ∈ `story \| shared` | `description`, `locked` |
| `asset` | `assets` | `collection` (exists, not deleted), `name` (unique in collection), `blob` (sha exists), `sidecars` (`{kind: sha}`, each exists) | `kind`, `tags`, `mime`, `w`, `h`, `bytes`, `pixelHash`, `phash`, `recipe`, `sourceAsset`, `animated`, `duration` … |
| `character` | `characters` | `collection` (exists), `charId` (unique in collection, shares namespace with asset `name`) | `poses`, … |
| `binding` | `bindings` | `id` = story id (not uuid). `own` (collection id) | `collections` (ordered ids), `refs` (asset ids used) |

Namespace rule: within one collection, the set of non-deleted asset `name` ∪ character
`charId` has no duplicates.

sha = lowercase hex sha256, 64 chars.

## Endpoints

Base `/api/v1/lib`. Bearer auth as all other routes.

| Method | Path | Request | Response |
|---|---|---|---|
| `POST` | `/blobs/has` | `{"hashes": [sha]}` | `{"missing": [sha]}` |
| `PUT` | `/blobs/{sha}` | raw bytes, `Content-Type` | `200 {"sha","bytes","mime"}`. Exists already → 200 same. Hash mismatch → 422. Over `MAX_ASSET_BYTES` → 413. |
| `GET` / `HEAD` | `/blobs/{sha}` | — | bytes. `ETag: "<sha>"`, `Cache-Control: private, max-age=31536000, immutable`, Range ok. 404 unknown. |
| `GET` | `/changes?since=N&limit=L` | L default 500, max 2000 | `{"seq": S, "items": [{"seq": n, "record": {...}}], "more": bool}`. Items `seq > N`, ascending. Only latest rev per record needed, but order must be by seq. `S` = highest seq in items, or current head if none. |
| `GET` | `/{type}/{id}` | — | record. 404 unknown. Deleted records return 200 with `deleted: true`. |
| `PUT` | `/{type}/{id}` | record body | create: header `If-None-Match: *`. update: `If-Match: "<rev>"`. Neither → 428. Response `200 {"record": {...}, "seq": n}`. |
| `DELETE` | `/{type}/{id}` | `If-Match: "<rev>"` | sets `deleted: true`, rev+1. Same response shape as PUT. |
| `GET` | `/{type}/{id}/revs` | — | `{"revs": [{"rev","by","at","record"}]}` newest first, max 50 |

### Errors

JSON body `{"error": code, ...}`.

| Status | code | Extra | When |
|---|---|---|---|
| 412 | `stale` | `current`: server record | If-Match rev ≠ current. Create on existing id. |
| 409 | `name-taken` | `holder`: `{type, id}` | namespace clash |
| 409 | `collection-name-taken` | `holder` | collection name clash |
| 409 | `blob-missing` | `missing`: [sha] | referenced blob not on server |
| 409 | `collection-missing` | — | asset/character collection unknown or deleted |
| 409 | `collection-not-empty` | `count` | delete collection holding non-deleted records, or bound by a non-deleted binding |
| 400 | `bad-record` | `detail` | shape/type/id mismatch |
| 428 | `precondition-required` | — | no If-Match / If-None-Match |

Restore after delete = PUT with `If-Match` of the tombstone rev and `deleted: false`.
Validation runs as for any update.

## Socket

Existing `/api/v1/events`. New message, sent to every connection, including the writer's
other tabs but not the writing connection itself:

```json
{"t": "lib", "seq": 881, "type": "asset", "id": "…", "rev": 13, "by": "ana"}
```

Advisory. Client always reads `/changes`, never trusts the message body for data.
Locks: reuse existing advisory lock messages with key `lib:<id>`.

## Storage (server, informative)

```
DATA_DIR/lib/blobs/ab/<sha>
DATA_DIR/lib/records/<type>/<id>.json
DATA_DIR/lib/revs/<type>/<id>/<rev>.json
DATA_DIR/lib/feed.jsonl        {seq, type, id, rev}
```

Atomic tmp + rename. One mutex for record writes. seq monotonic, survives restart.
Blob GC: live = any sha named by a current record or any kept rev.

## Client invariants the tests check

1. A record PUT is only sent after `/blobs/has` + blob PUTs for every sha it names.
2. Applying a pulled record never enqueues a write.
3. `base` (last agreed server copy) is persisted with the record. Reload does not reset it.
4. 412 → 3-way merge base/local/current. Never a blind retry with the local body.
5. Outbox persisted. Reload resumes it.
