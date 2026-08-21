# 11 — Server storage (autosave backend)

**Status: design only. Nothing built. This file is the review artifact for
`~/twine-server-storage.md`.**

Go backend in `server/`, token auth, throttled autosave of story text and assets from the
browser fork.

## Why

Everything the fork writes lives in the browser: story text in `localStorage`, assets in
OPFS/IndexedDB, both bound to one origin (spec 03, spec 08). Clearing site data loses the
lot. `.sliders.zip` (spec 08) is a manual, whole-library, user-initiated round trip — it is
a backup you have to remember to make.

This is the unattended version: while you edit, the current story and the assets it uses
land on a server you control.

**In scope:** push. Browser is the source of truth, server is the copy.
**Out of scope for v1:** pull-on-open, multi-device merge, prefs sync, multi-user. The API
is shaped so pull can be added without a version bump — see "Pull, later".

## Shape of the thing

```
server/                  Go module, no framework, net/http + stdlib
  main.go
  config.go              .env → Config (AUTH_TOKEN, ADDR, DATA_DIR, CORS_ORIGINS)
  auth.go                bearer middleware, constant-time compare
  api/                   handlers, one file per resource
  store/                 filesystem store, atomic writes
  data/                  DATA_DIR default, gitignored
```

Disk layout — one directory per story, no database:

```
data/
  stories/
    <storyId>/
      story.json         the Story object, verbatim (same bytes spec 08 puts in the zip)
      assets.json        the asset manifest: AssetMeta[] + Character[]
      meta.json          server bookkeeping: rev, updatedAt, client name
      assets/
        a_8f21.webp      raw stored bytes, filename = <assetId><ext from mime>
        a_3c07.gif
```

Why no zip (the brief says so, and it is right): autosave writes every few seconds, a zip
would have to be rebuilt whole each time, and the 95% case is "one passage changed, no
asset changed". Separate files mean the story PUT is a few hundred KB and the asset PUTs
almost never happen.

Why `story.json` and not published HTML: `publishStory()` is lossy — it drops passage ids,
`lastUpdate`, `snapToGrid`, `ifid` (spec 08, "Why both"). A backup that loses ids is not a
backup. HTML is a publish artifact; ask for it with `?format=html` if you ever want it.

## Auth

`Authorization: Bearer <token>`, compared against `AUTH_TOKEN` from `.env` with
`crypto/subtle.ConstantTimeCompare`. No users, no sessions, no cookies — one token, one
owner. Server refuses to start if `AUTH_TOKEN` is empty or shorter than 16 chars, rather
than coming up wide open.

Every route needs it except `GET /api/v1/health`.

## CORS, and the thing that will actually bite

The editor is a page on `https://twine-ig.tmpx.space` (or `http://127.0.0.1:5173` in dev)
talking to a server on some other host. Two consequences:

1. **Preflight.** Every request carries `Authorization` and `Content-Type: application/json`,
   so every request is preflighted. Server answers `OPTIONS` with
   `Access-Control-Allow-Origin: <echo of an allowed origin>`,
   `-Allow-Headers: authorization, content-type, if-match`,
   `-Allow-Methods: GET, PUT, POST, DELETE, OPTIONS`,
   `-Expose-Headers: etag`, `-Max-Age: 86400`.
   Allowed origins come from `CORS_ORIGINS` in `.env` (comma list, `*` permitted but then
   the token is the only gate). Never `Allow-Credentials` — there are no cookies.
2. **Mixed content.** A page served over HTTPS *cannot* fetch `http://192.168.1.10:8080`.
   Chrome and Firefox block it outright, and no server-side header fixes it. So a bare
   "Backend IP" field only works from a `http://localhost` dev server (browsers exempt
   loopback) — for the deployed Cloudflare build the backend **must** be HTTPS. The prefs
   UI has to say this, and the Test button has to name it as the failure. Practical
   answers, in order of effort: Cloudflare Tunnel to the box, Caddy with a real cert, or
   `http://localhost:8080` and only autosave while on the dev server.

## API

Base path `/api/v1`. JSON in, JSON out, UTF-8. Errors are
`{"error": {"code": "...", "message": "..."}}` with codes
`unauthorized`, `not_found`, `conflict`, `too_large`, `bad_request`, `hash_mismatch`,
`internal`.

### Probe

| | |
|---|---|
| `GET /api/v1/health` | **no auth.** `{"ok":true,"service":"twine-sliders-server","apiVersion":1}` |
| `GET /api/v1/ping` | auth. `{"ok":true,"apiVersion":1,"version":"0.1.0","storyCount":3,"bytesUsed":48213911,"time":"2026-08-21T10:12:00Z","maxAssetBytes":67108864,"maxStoryBytes":33554432}` |

Two endpoints, not one, so the Test button can tell the three failures apart:

| What happened | What Test says |
|---|---|
| `/health` unreachable, or a `TypeError` from `fetch` | "No answer. Wrong address, server down — or the page is HTTPS and the backend is HTTP." |
| `/health` fine, `/ping` 401 | "Server is there. Token rejected." |
| both fine | "Connected — twine-sliders-server 0.1.0, 3 stories, 46 MB." |

### Stories

| Method | Path | Does |
|---|---|---|
| `GET` | `/stories` | index — `{"stories":[{id, name, ifid, lastUpdate, rev, updatedAt, assetCount, bytes}]}`. No passage text. |
| `GET` | `/stories/{id}` | the `Story` object. `ETag: "<rev>"`. `?format=html` returns published HTML instead. |
| `PUT` | `/stories/{id}` | write. Body is the `Story` object. This is autosave's one hot path. |
| `DELETE` | `/stories/{id}` | remove story, manifest and all its asset bytes. |

`PUT /stories/{id}` request:

```json
{
  "story": { "id": "…", "ifid": "…", "name": "…", "passages": [ … ], "lastUpdate": "2026-08-21T10:11:58.220Z", … },
  "client": "twine-sliders 2.10.0-sliders"
}
```

Response `200`:

```json
{"id": "…", "rev": 42, "updatedAt": "2026-08-21T10:12:00Z", "bytes": 214880}
```

`rev` is a server-side counter, bumped on every accepted write. It is not `lastUpdate` —
`lastUpdate` comes from the client's clock and two machines' clocks disagree.

**Optimistic concurrency, opt-in.** If the client sends `If-Match: "<rev>"` and the stored
rev differs, the server answers `412` with
`{"error":{"code":"conflict"}, "rev": 44, "updatedAt": "…", "name": "…"}` and writes
nothing. No `If-Match` means last-write-wins. v1 autosave sends `If-Match` with the rev it
last saw and, on 412, stops autosaving that story and raises a notification — silently
clobbering the other device is the one behaviour a backup must never have.

`Story.lastUpdate` is a `Date`; over the wire it is an ISO 8601 string, which is what
`JSON.stringify` already produces. The server stores it as given, opaque.

### Asset manifest

One document per story, mirroring what `sliders.json` carries in a bundle (spec 08) minus
the zip paths.

| Method | Path | Does |
|---|---|---|
| `GET` | `/stories/{id}/assets` | `{"version":1,"assets":[AssetMeta…],"characters":[Character…],"rev":7,"missing":["a_9f11"]}` |
| `PUT` | `/stories/{id}/assets` | replace the manifest wholesale |
| `POST` | `/stories/{id}/assets/diff` | what to upload — see below |

`missing` on GET lists manifest entries whose bytes are not on disk, so a restore knows it
is incomplete before it starts.

`PUT` body is `{"version":1,"assets":[…],"characters":[…]}` — `AssetMeta` and `Character`
verbatim from `@sliders/scene-types`, no reshaping. Same `If-Match` rule, on the manifest's
own rev.

The manifest is written **after** the blobs it names. Half-uploaded assets then show as
manifest entries the server does not have yet, never as bytes nothing points at.

### Asset bytes

| Method | Path | Does |
|---|---|---|
| `POST` | `/stories/{id}/assets/diff` | body `{"assets":[{"id":"a_8f21","hash":"…","bytes":12044}]}` → `{"missing":["a_3c07"],"present":["a_8f21"],"stale":["a_44b1"]}` |
| `HEAD` | `/stories/{id}/assets/{assetId}` | `Content-Length`, `ETag: "<hash>"`, 404 if absent |
| `GET` | `/stories/{id}/assets/{assetId}` | the bytes, `Content-Type` from the manifest |
| `PUT` | `/stories/{id}/assets/{assetId}` | upload. Raw body, `Content-Type` the asset's mime, `X-Asset-Hash: <hash>` required |
| `DELETE` | `/stories/{id}/assets/{assetId}` | remove bytes; manifest untouched |

`diff` exists so autosave never uploads a 4 MB background twice. `stale` = present but
stored under a different hash than the client claims, i.e. re-upload.

`PUT` verifies `X-Asset-Hash` against the bytes it received and answers `422 hash_mismatch`
if they disagree, refusing the write. The hash algorithm is whatever `packages/asset-store`
already computes for `AssetMeta.hash` — the client never computes a second one. Bytes go to
a temp file and get `rename`d into place, so a dropped connection cannot leave a truncated
asset that then passes `HEAD`.

Bytes are **not** deduped across stories. Per-story directories mean deleting a story is
`os.RemoveAll` and nothing else, which is worth more than the disk a shared background
costs.

**Orphans.** `PUT /assets` (manifest) does not delete anything. A blob whose id has not
been in the manifest for `ORPHAN_TTL` (default 7 days) is swept by a janitor on startup and
daily. Delayed, because "asset removed from the manifest" and "asset the author is about to
re-add" look identical for the first minute.

### Limits

`MAX_ASSET_BYTES` (default 64 MB) and `MAX_STORY_BYTES` (default 32 MB), both from `.env`
and both reported by `/ping` so the client can complain *before* uploading. Over the limit
is `413 too_large`. `http.MaxBytesReader` on every body — an unauthenticated `OPTIONS` must
not be able to fill the disk.

## Client side

### Prefs

Three new keys in `PrefsState` (`src/store/prefs/prefs.types.ts` + `defaults.ts`):

| Key | Type | Default |
|---|---|---|
| `backendUrl` | `string` | `''` — empty disables everything below |
| `backendToken` | `string` | `''` |
| `backendAutosave` | `boolean` | `true` |

The token sits in `localStorage` in the clear, exactly like `geminiApiKey` and
`openAiApiKey` do today. Same note in the same words next to the field.

New section in `src/dialogs/app-prefs.tsx`, after the existing ones: **Story backup
server** — URL field (placeholder `https://twine.example.com`), token field
(`type="password"`, reveal toggle), autosave checkbox, **Test** button, and a result line
that stays put until the next test. The HTTPS/mixed-content warning shows when the app is
on `https:` and the URL is `http:` with a non-loopback host — checked in the field, not
after a failed request.

### Autosave

New `src/store/persistence/server/`, wired **alongside** the existing persistence, not
inside `usePersistence()`. `usePersistence` picks *one* of electron/localStorage as the
store of record; the server is a second, failure-tolerant sink and must not be able to
break the local save path.

```
use-server-sync.ts     hook mounted next to <StateLoader>; watches stories state
sync-queue.ts          per-story debounce + retry/backoff, survives remounts
client.ts              typed fetch wrapper: bearer, ETag, error mapping
asset-sync.ts          diff → upload missing → PUT manifest
```

Throttle: **debounce 5 s** after the last change to a story, **max wait 30 s** so a long
typing run still checkpoints, per story id. Flush on `visibilitychange → hidden` via
`sendBeacon`-shaped `fetch(…, {keepalive: true})` when the body fits. Trivial changes are
filtered through the existing `isPersistableStoryChange` / `isPersistablePassageChange`
(`persistable-changes.ts`) so selecting a passage never hits the network.

Assets sync after the story write that referenced them: collect refs the way spec 08's
`collectAssetRefs` does, `POST /assets/diff`, upload what is missing one at a time (not in
parallel — a phone tethering uplink and eight 4 MB WebPs is a bad combination), then `PUT`
the manifest.

Failure is quiet and visible: retry with backoff 5 s → 15 s → 60 s, cap 3 tries, then park
the story until its next edit. Sync state lives in one place — a small indicator in the
story-list toolbar and story editor: idle / saving / saved *hh:mm* / error with tooltip.
No toast per save.

### Pull, later

Everything above is push. Restore already works read-only with what is specified:
`GET /stories` lists, `GET /stories/{id}` returns a whole `Story`, `GET /assets` plus
`GET /assets/{id}` return manifest and bytes, which is exactly what
`importBundle`/`applyBundle` (spec 08) already consume once the zip is unpacked. So v2's
"Restore from server" is a UI over existing endpoints plus a reuse of the bundle importer's
`AssetPlanItem` logic — no new API surface, no version bump.

## Open questions for review

1. **Scope: this story, or all of them?** Written above as "every story with a `backendUrl`
   set autosaves". The alternative is a per-story opt-in toggle in story details. Cheaper
   to decide now than to migrate later.
2. **HTTPS.** Is the backend going behind Cloudflare Tunnel / Caddy, or is autosave a
   dev-server-only feature for now? This decides whether the prefs field is a warning or a
   hard block.
3. **Asset scope.** `AssetStore.scope` is per-story for new libraries but empty for the
   legacy shared one. For a shared-library story, "the assets this story uses" is the
   `collectAssetRefs` set — same as the bundle. Confirm that is the intent rather than
   pushing the whole library.
4. **Retention.** Server keeps one copy per story. Worth keeping the previous N revisions
   (`story.json` → `revs/42.json`, cheap, text-only) so a bad autosave is recoverable? I'd
   say yes, 20 revisions, but it is scope.
5. **Deletion.** If a story is deleted locally, does the server copy go too? Default here:
   **no** — autosave never issues `DELETE`. Deleting on the server is a deliberate act in
   the prefs/restore UI. A backup that follows you off a cliff is not a backup.
