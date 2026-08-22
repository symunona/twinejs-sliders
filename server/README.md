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
| `REV_KEEP` | | `20` | snapshots kept per story |
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
| `DELETE` | `/stories/{id}` | tombstone; `?purge=1` erases the directory |
| `GET` | `/stories/{id}/revisions` | newest first, plus `current` |
| `GET` | `/stories/{id}/revisions/{rev}` | that body |
| `GET` | `/stories/{id}/revisions/{rev}/assets` | the manifest as of that rev |
| `POST` | `/stories/{id}/restore` | `{"rev":N}` → `{id,rev,restoredFrom,missingAssets}` |
| `GET`/`PUT` | `/stories/{id}/assets` | the manifest; own rev, own `If-Match` |
| `POST` | `/stories/{id}/assets/diff` | → `{missing,present,stale}` |
| `HEAD`/`GET`/`PUT`/`DELETE` | `/stories/{id}/assets/{assetId}` | bytes; `PUT` needs `X-Asset-Hash` |
| `GET` | `/events` | websocket: change bus, presence, soft locks |

Every request may carry `X-Client-Id` and `X-Client-Name`; the name is recorded as
`lastClient` and against every revision. Missing name is stored as `unknown`.

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
  a rev anyone is holding.
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
