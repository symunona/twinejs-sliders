# 2026-10-17 sounds and autoplay

Run: pandora, Ubuntu 24.04 Wayland. Details + shots: `test-sound.md` § Run 2026-10-17.

## Works

- Sound plays in every M case. Heard by ear (Chrome #1), sink monitor RMS ~5000 all others.
- Blocked → `▶ Play` → click → music. Chrome 148 default, kiosk. Firefox 158 default.
- Allowed → music, no click. Chrome `--autoplay-policy=no-user-gesture-required` (± kiosk).
  Firefox `media.autoplay.default=0`.
- Kiosk alone = blocked. Needs the flag.
- No sound scene (P) → never a button.
- Click stop: spinner, `nav-wait` → `nav-go`, tiers in order.

## Verdict sources

| browser | blocked via | allowed via |
|---|---|---|
| Chrome | `probe NotAllowedError` | `probe` |
| Firefox | `getAutoplayPolicy allowed-muted` | `getAutoplayPolicy allowed` |

## Off

- Allowed cases flash disabled `Loading…` ~100 ms. `preload.ts:397` mounts boot before verdict.
- Firefox allowed: 3× `Could not preload …/pub/blobs/… (Error in input stream)`. Played anyway.
- Noise: Chapbook `lookups: trail variable…`, Chrome 401 `favicon.ico`.

## Not covered

Chromium, Edge, Safari, iOS, Android, P→M after click.
