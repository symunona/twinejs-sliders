# Deployment

Two independent targets.

| URL | What it serves | Mechanism |
| --- | --- | --- |
| https://twine.tmpx.space | The built static site (`dist/web`) | Cloudflare Pages, project `twine-sliders` |
| https://twine-dev-xayah.tmpx.space | The live vite dev server on `xayah` | `cloudflared` tunnel to `127.0.0.1:5173` |

## Production: Cloudflare Pages

```sh
npm run deploy-cloudflare
```

This builds (`npm run build:web`), checks that `dist/web/index.html` exists, and
uploads `dist/web` with:

```
npx wrangler@4 pages deploy dist/web --project-name twine-sliders --branch main --commit-dirty=true
```

### API token

The script needs `CLOUDFLARE_API_TOKEN`. It is read from:

```
~/.config/cloudflare.env
```

which is outside the repo and never committed. A template lives next to it at
`cloudflare.env.example` — copy it and fill in the token:

```sh
cp ~/.config/cloudflare.env.example ~/.config/cloudflare.env
```

The token needs **Account > Cloudflare Pages > Edit**; create one at
https://dash.cloudflare.com/profile/api-tokens

If the variable is already exported in your shell, that works too — the file is
just a convenience so it does not have to be.

## Dev tunnel

Exposes the *running* local dev server to the public internet. It does not start
the dev server, so `npm start` has to be running separately in this repo.

```sh
npm run deploy-tunnel-dev -- start     # note the --
npm run deploy-tunnel-dev -- stop
npm run deploy-tunnel-dev -- restart
npm run deploy-tunnel-dev -- status
npm run deploy-tunnel-dev -- logs
```

The `--` is required so npm passes the action through to the script rather than
consuming it. Running it bare prints usage.

Under the hood these drive the systemd system unit `cloudflared-twine-dev`
(`sudo systemctl <action> cloudflared-twine-dev`).

- `status` also reports whether anything is actually listening on
  `127.0.0.1:5173`, and warns if not — a live tunnel with a dead dev server just
  serves errors.
- `logs` follows the journal: `sudo journalctl -u cloudflared-twine-dev -f -n 50`

You can equally call the script directly: `./scripts/tunnel-dev.sh status`
