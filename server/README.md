# twine-story-store

The backup and shared-library server for the sliders fork of Twine.
Design: [`docs/sliders/11-server-storage.md`](../docs/sliders/11-server-storage.md).

Stories, asset manifests and asset bytes on disk; the last N revisions of every story; a
small JSON API over HTTP, plus a websocket carrying change notifications, presence and
soft locks. No database, no framework; `gorilla/websocket` is the only dependency.

## Run it

```sh
cp .env.example .env
# put a token in it: openssl rand -hex 24
go run .                                    # 127.0.0.1:8080, ./data
go run . --addr 127.0.0.1:0 --data /tmp/x   # any free port, throwaway data
go build -o twine-story-store .             # for deployment
```

The first line on stdout is always `listening on 127.0.0.1:<port>` — the Playwright
fixture spawns the binary with `--addr 127.0.0.1:0` and reads the port from it, so nothing
else may print to stdout before it. Everything else logs to stderr.

```sh
go test ./...
go vet ./...
```

## Configuration

Flags override the environment, which overrides `.env`, which overrides the defaults.

| Env | Flag | Default | What |
|---|---|---|---|
| `AUTH_TOKEN` | | **required**, ≥16 chars | the one shared bearer token |
| `ADDR` | `--addr` | `127.0.0.1:8080` | listen address; port `0` picks a free one |
| `DATA_DIR` | `--data` | `./data` | state directory |
| `CORS_ORIGINS` | | *(none)* | comma list of editor origins; `*` allows any |
| `MAX_ASSET_BYTES` | | `67108864` (64 MB) | per-asset upload cap |
| `MAX_STORY_BYTES` | | `33554432` (32 MB) | per-story body cap |
| `REV_KEEP` | | `20` | **unpinned** snapshots kept per story |
| `PINNED_MAX` | | `50` | pinned revisions allowed per story; pins are never pruned |
| `ORPHAN_TTL` | | `168h` | grace period for unreferenced asset blobs |
| `TOMBSTONE_TTL` | | `2160h` | how long deleted stories keep their history |
| | `--env` | `.env` | path to the env file; missing is not an error |

## API

Base path `/api/v1`. Everything needs `Authorization: Bearer <AUTH_TOKEN>` except
`/health`. Errors are always `{"error":{"code":"…","message":"…"}}` with the codes from
`src/store/persistence/server/server.types.ts`.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/health` | no auth — the probe that separates "down" from "token rejected" |
| `GET` | `/ping` | version, counts, limits, `events`, `clients` |
| `GET` | `/stories` | index; tombstones included and flagged |
| `GET` | `/stories/{id}` | `ETag: "<rev>"`, honours `If-None-Match`; `?format=html` → 501 |
| `PUT` | `/stories/{id}` | `{"story":{…},"client":"…"}`; `If-Match`; `?revive=1` |
| `PATCH` | `/stories/{id}` | `{"patch":{…},"client":"…"}`; **`If-Match` required** |
| `DELETE` | `/stories/{id}` | tombstone; `?purge=1` erases the directory |
| `GET` | `/stories/{id}/revisions` | newest first, plus `current` |
| `GET` | `/stories/{id}/revisions/{rev}` | that body |
| `GET` | `/stories/{id}/revisions/{rev}/assets` | the manifest as of that rev |
| `POST` | `/stories/{id}/revisions/{rev}/label` | `{label?,pinned?}` → the row; not a story write |
| `POST` | `/stories/{id}/restore` | `{"rev":N}` → `{id,rev,restoredFrom,missingAssets}` |
| `GET`/`PUT` | `/stories/{id}/assets` | the manifest; own rev, own `If-Match` |
| `POST` | `/stories/{id}/assets/diff` | → `{missing,present,stale}` |
| `HEAD`/`GET`/`PUT`/`DELETE` | `/stories/{id}/assets/{assetId}` | bytes; `PUT` needs `X-Asset-Hash` |
| `GET` | `/events` | websocket: change bus, presence, soft locks |

Every request may carry `X-Client-Id` and `X-Client-Name`; the name is recorded as
`lastClient` and against every revision. Missing name is stored as `unknown`.

### `PATCH /stories/{id}` — per-passage upload

Autosave PUTs the whole story every 5 s. Stories are 1-14 KB today and heading for
20-100 KB of passage text, so one typed sentence costs 100 KB of upload on whatever the
phone has. `PATCH` sends what changed instead.

```json
{
  "client": "twine-sliders 2.10.0-sliders",
  "patch": {
    "passages": {
      "changed": [ {"id": "p7", "name": "Cellar", "text": "…"} ],
      "removed": ["p3"]
    },
    "story": {"name": "Lighthouse", "startPassage": "p1"}
  }
}
```

Answers the same `{"id","rev","updatedAt","bytes"}` a `PUT` answers, with the same
`ETag`. Shapes are `StoryPatch` / `PatchStoryRequest` in
`src/store/persistence/server/server.types.ts`.

- **`If-Match` is required**, unlike on `PUT`. A `PUT` states the whole story, so
  last-write-wins is a coherent answer; a patch is only meaningful against the base it was
  computed from. Missing, `*`, or stale → `412` with the same body a stale `PUT` gets, so
  the client has one recovery branch: re-read, re-diff, retry.
- **Passages are whole objects, matched on `id`.** Present → replaced where it stands;
  absent → appended. Never text-diffed: sending one 8 KB passage instead of a 100 KB story
  is already the win, and a text diff would mean client and server agreeing on a diff
  algorithm forever.
- **Removing a passage that is already gone is not an error.** Two clients deleting the
  same passage is an ordinary race, and the end state both asked for is the one that
  happens.
- **`patch.story` is top-level scalars only.** `passages` there is a `400`: it has its own
  half of the request, and accepting both would be two answers to one question.
- **Same write path as `PUT`** — `writeStoryLocked`, so the rev bump, the `revs/` snapshot,
  the keep-N prune, `normalizeStory` and the `meta.json` ordering are not reimplemented. A
  patch that skipped the snapshot would leave holes in the history exactly where the
  ordinary autosaves were.
- **No `?revive=1`.** A tombstone has no body to patch; reviving means stating the whole
  story, which is a `PUT`. → `409 deleted`, as `PUT` gives.
- **It also unsticks the tab-close save.** That one goes out with `fetch(…, {keepalive:
  true})`, which the Fetch spec caps at 64 KB of request body. Measured: an 89 KB story is
  a 90,550-byte `PUT` — over the cap, so it silently does not happen — against a
  1,219-byte `PATCH`.

### `POST /stories/{id}/revisions/{rev}/label` — names and pins

```json
{"label": "before I broke the tavern", "pinned": true}
```

→ `{"id","rev","label","pinned","summary","pins","pinnedMax"}`, `200`.

- **Not a story write.** No rev bump, no snapshot, no `story` broadcast, no `ETag` on the
  response. Naming a version you already have does not make it a different version, and a
  rev bump would send every other editor off to re-pull a body that did not move. What it
  does broadcast is `{"t":"revmeta","id","rev"}`, which an open History dialog re-lists on.
- **Omitted or `null` → unchanged. `"label":""` clears, `"pinned":false` unpins.** A body
  with neither field is a `400`: it asks for nothing.
- **The current rev can be labelled too.** It has no row in `revs/index.json` — it is
  `story.json` — so its label and pin wait on `meta.json` and move onto the index row when
  that version is eventually replaced. This is what a voice-mode `checkpoint(label)` uses.
- **`label` is clamped to 120 runes, control characters stripped.** It is display text,
  not data.
- **Pinned revisions are never pruned**; `REV_KEEP` counts unpinned ones only. `PINNED_MAX`
  (50) is the bound on disk instead — the pin past it is a `400` naming the limit, not a
  `412`, which the client reads as a lost `If-Match` race.

### `summary` on `PUT` and `PATCH`

Optional, beside `client`. The client's one-line description of the write ("Tavern Night
+2 more", "find & replace"), stored on the rev that write creates and shown on its History
row.

The **client** computes it because only the client has both sides of the diff and the
author's intent: a drag is "moved", a find-replace says so, a voice tool call is its own
tool name. The server would have to diff a 100 KB story on every autosave to say something
worse. It is therefore never trusted for anything but display — clamped to 200 bytes on a
rune boundary, control characters stripped, not validated further.

### Compression

Responses are gzipped when the client sends `Accept-Encoding: gzip`. `server/api/gzip.go`,
hand-rolled — the stdlib ships no gzip middleware and `gorilla/websocket` is meant to stay
the only dependency.

Policy is **by content type, decided at `WriteHeader`, not by route**: `application/json`
and nothing else. Asset blobs are webp/mp3/png, already compressed, and gzipping them would
burn CPU on both ends, throw away `Content-Length` and break the `Range` requests
`http.ServeContent` serves them with.

Measured on real bodies from the live store, through the real handler:

| Body | plain | gzip | |
|---|---|---|---|
| story GET, "Sliders Feature Lab" | 14,217 | 4,866 | 2.92x |
| story GET, "Trip to my Desert" | 8,388 | 1,873 | 4.48x |
| story index | 547 | 321 | 1.70x |

- Bodies under 512 bytes are left alone: the gzip header and trailer are 18 of them, and a
  `PutStoryResponse` is barely more. Writes are buffered until the threshold or until the
  handler finishes, so the decision is made on the real size rather than a
  `Content-Length` nobody sets.
- `304` and `204` never grow a `Content-Encoding`.
- `Vary: Accept-Encoding` is always added, whatever this particular body did — a shared
  cache has to know the body depends on the header.
- `ETag` is the rev, so it does not change with the encoding, and must not.
- The wrapper forwards `Hijack` and `Flush`. Without `Hijack`, `GET /api/v1/events` — the
  websocket — would be a 500.
- **Caddy already does `encode zstd gzip` in front of this in production** (see the
  Caddyfile below), and it skips a response that already declares a `Content-Encoding`, so
  the two do not stack. This is for everything that is not behind Caddy: the local dev
  store on `127.0.0.1:27100`, the Playwright fixture, curl, and any future deployment
  without a compressing proxy.
- Request bodies are **not** decompressed. Uploads go through
  `http.MaxBytesReader`, and a cap that a client could dodge by gzipping its body is not a
  cap. `PATCH` is the answer to upload size.

### The websocket

`GET /api/v1/events`, upgraded. The message shapes are the `ClientMessage` /
`ServerMessage` unions in `src/store/persistence/server/server.types.ts`; that file is the
contract.

- **Auth rides the subprotocol.** A browser cannot put a header on a handshake, so the
  client offers `Sec-WebSocket-Protocol: bearer, <AUTH_TOKEN>` and the server echoes back
  `bearer` alone. `Authorization: Bearer` also works, for curl and tests. A bad or missing
  token is a plain `401` before the upgrade, so the Test button sees a status code rather
  than a close frame.
- **The socket takes no writes.** `hello`, `focus`, `blur`, `steal`, `ping` — anything
  else is ignored. Story and asset writes stay on HTTP, where auth, limits, atomic writes
  and revisions already live; a second write path would have to reimplement all four.
- **The bus never echoes.** A change is announced to everyone except the `X-Client-Id`
  that made it, which is why every request should carry that header.
- **Presence is memory only**, empty after a restart, and an entry whose connection has
  not spoken for 60 s is dropped so a closed laptop releases its locks.
- **A lock is just someone else's presence entry naming a passage.** No lock table, no
  enforcement. `steal` tells everyone and kicks nobody.

Losing the socket costs nothing but latency: clients fall back to polling `GET /stories`,
and `/ping` reports `events` so they know which mode they are in.

### Things worth knowing

- **`rev` is a write counter, per story, never reused.** It is the ETag, the `If-Match`
  token and the broadcast payload. It bumps on every accepted story write, including one
  whose body turns out to be identical. The asset manifest has its own separate rev, so
  pushing passage text and pushing art never invalidate each other.
- **A tombstone does not bump the rev.** There is no new body, so there is nothing to
  snapshot and nothing a client missed — and leaving the rev alone means an editor still
  holding rev 42 can republish with `If-Match: "42"` and be right.
- **`sync` is stripped on write and never returned.** Whether a story pushes itself is
  each editor's local decision.
- **Snapshots are storage policy, not concurrency.** Pruning past `REV_KEEP` cannot affect
  a rev anyone is holding. `REV_KEEP` counts and deletes **unpinned** snapshots only: a
  pin is the author overriding the policy, and `PINNED_MAX` is what bounds the disk.
- **Every write is temp-file + rename**, and every request touching one story is
  serialised behind that story's mutex.

## Deployment

Runs on taskbot behind Caddy; the Go process binds loopback and Caddy terminates TLS.

`/etc/caddy/Caddyfile`:

```caddy
twine-story-store.tmpx.space {
  encode zstd gzip
  request_body { max_size 80MB }   # >= MAX_ASSET_BYTES, or Caddy 413s before Go sees it
  reverse_proxy 127.0.0.1:8080
}
```

Websockets need nothing extra — modern Caddy passes `Upgrade` through.

`/etc/systemd/system/twine-story-store.service`:

```ini
[Unit]
Description=Twine sliders story store
After=network-online.target

[Service]
User=twine
WorkingDirectory=/srv/twine-story-store
EnvironmentFile=/srv/twine-story-store/.env
ExecStart=/srv/twine-story-store/twine-story-store
Restart=always
RestartSec=2
# The data directory is the only thing it needs to write.
ProtectSystem=strict
ReadWritePaths=/srv/twine-story-store/data
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

```sh
systemctl enable --now twine-story-store
journalctl -u twine-story-store -f
```

## Layout

```
main.go        flags, config, listener, graceful shutdown, janitor loop
config.go      .env parser and defaults
api/           routes, handlers, auth and CORS middleware, the Notifier seam
hub/           the websocket: change bus, presence, soft locks, all in memory
store/         the filesystem: stories, revisions, assets, janitor
```

`api.Notifier` is where `hub.Hub` plugs in: handlers announce every accepted change
through it, and it defaults to a no-op, so the socket stays an optional layer rather than
a dependency. The hub also satisfies `api.PresenceSource` (for `/ping`) and `http.Handler`
(for the route). Nothing in `api` imports `hub`.
