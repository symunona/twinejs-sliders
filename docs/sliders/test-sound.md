# Test: opening sound, boot screen, preload

Manual, headed browsers. Covers `18-player-loading.md`: autoplay detection, boot screen,
priority preload, click stop. Headless Chrome only proves the BLOCKED path.

## Pages (public, no login)

| id | url | first scene |
|---|---|---|
| M | https://twine-story-store.tmpx.space/pub/5d1e2c4a-0c1f-4b8e-9a4e-6d3f0a7b9c21 | DEMO music tracks. `music:` → boot screen when blocked |
| P | https://twine-story-store.tmpx.space/pub/f3097e55-4f94-4e7a-975f-48c21e6b7a6d | DEMO parallax hills. No sound → never a button |

- Snapshots. Stale after a format deploy: re-publish (story list → Copy Public URL, or
  `pubplayer.mjs`-style PUT `/api/v1/stories/{id}/player`).
- Format check: page source contains `sliders-boot__play`. Absent = old snapshot.

## Before each run

- FRESH profile per case. Chrome raises its media-engagement score per visit; an old
  profile can turn "blocked" into "allowed".
- Clear resume: Chapbook keeps `chapbook-*` in localStorage, a reload resumes mid-story.
- Debugger on (console of the page):
  ```js
  localStorage.setItem('sliders.preload.debug','1');location.reload()
  ```
- Verdict line: console `[preload] … autoplay allowed|blocked (<via>)`. Or
  `slidersPreload.loader.events.filter(e=>e.type==='autoplay')`.
- Sound out: speakers / headphones on, OS not muted, tab not muted.

## Matrix

`B` = blocked expected → `Loading…` button, then `▶ Play`, click, scene, music.
`A` = allowed expected → no button, scene after bar, music without any click.

| # | browser | launch | M | P |
|---|---|---|---|---|
| 1 | Chrome | `google-chrome --user-data-dir=$(mktemp -d) <url>` | B | no button |
| 2 | Chrome, flag | `google-chrome --user-data-dir=$(mktemp -d) --autoplay-policy=no-user-gesture-required <url>` | A | no button |
| 3 | Chrome kiosk | `google-chrome --user-data-dir=$(mktemp -d) --kiosk <url>` (Alt+F4 exits) | record (likely B) | no button |
| 4 | Chrome kiosk + flag | #3 plus `--autoplay-policy=no-user-gesture-required` | A | no button |
| 5 | Edge / Chromium | same flags as #1, #2 (`microsoft-edge`, `chromium`) | B / A | no button |
| 6 | Firefox | `firefox -no-remote -profile $(mktemp -d) <url>` | B (`getAutoplayPolicy allowed-muted`) | no button |
| 7 | Firefox, allow | fresh profile, `user.js`: `user_pref("media.autoplay.default", 0);` | A (`getAutoplayPolicy allowed`) | no button |
| 8 | Safari macOS | default (Stop Media with Sound) | B | no button |
| 9 | Safari macOS, allow | Settings → Websites → Auto-Play → site → Allow All Auto-Play | A | no button |
| 10 | iOS Safari | default | B | no button |
| 11 | Android Chrome | default | B | no button |
| 12 | any, after a click | open P, click a link, then `location.href = <M>` same tab | record | — |

Firefox `media.autoplay.default`: 0 allow, 1 block audible (default), 5 block all.

## What to check, per case

M blocked (B):
- Thin top bar fills. Centred button `Loading…`, disabled.
- Turns `▶ Play` when art is in. Nothing else visible yet.
- Click → scene shows, first `box:` beat on screen, music within ~1 s.
- First beat NOT already passed (beats wait for reveal).

M allowed (A):
- Bar, then scene. No button at any point.
- Music starts with no click.

P, every browser:
- Never a button. Scene after bar. No sound expected.

Fail signs:
- Button in an A case, or no button in a B case.
- No button AND silent → probe said allowed, deck still refused. Most important bug.
- Button never arms (stuck `Loading…`) → note last `[preload]` lines.
- Error box, console errors, beats ran before reveal.

## Click stop (once, any desktop browser)

```js
localStorage.setItem('sliders.preload.debug','1');localStorage.setItem('sliders.preload.delay','3000');Object.keys(localStorage).filter(k=>k.startsWith('chapbook')).forEach(k=>localStorage.removeItem(k));location.reload()
```

- On M: click Play, then at once click through the beats and the first link.
- Expect: link spinner, other links dimmed + dead, `nav-wait` → `nav-go` in the log, then
  the passage.
- Panel top right: tiers in order `t0` → `reveal` → `t1` → `t2`.
- Done: `localStorage.removeItem('sliders.preload.delay')`.

## Report

One row per case:

| # | browser + version | OS | expected | got | verdict line | sound heard | notes / screenshot |
|---|---|---|---|---|---|---|---|

Plus: anything in the console that is not `[preload]`.

### Run 2026-10-17, pandora

Host: pandora, Ubuntu 24.04, GNOME Wayland, PipeWire, built-in speakers 60%. Pages M + P
snapshots have `sliders-boot__play`. Harness: fresh profile per case, CDP (Chrome) / WebDriver
BiDi (Firefox), debug on, `chapbook-*` cleared, Play clicked as a trusted input event.
Sound = RMS of the default sink monitor (`parecord`) + hooked `<audio>` elements (`paused`,
`currentTime`). Silence RMS 0. User confirmed hearing music by ear on #1 M.

| # | browser + version | OS | expected | got | verdict line | sound heard | notes / screenshot |
|---|---|---|---|---|---|---|---|
| 1 M | Chrome 148.0.7778.215 | Ubuntu 24.04 Wayland | B | B. `Loading…` → `▶ Play` → click → scene | `autoplay — blocked (probe NotAllowedError)` | yes, by ear. Sink RMS 0 before click, 5240 after. Track playing, t 0.5→4.7 s | `test-sound-results/1-M-boot-loading.png`, `1-M-boot-armed.png` |
| 1 P | Chrome 148 | same | no button | no button | none (no sound scene) | silent, as expected | — |
| 2 M | Chrome 148, `--autoplay-policy=no-user-gesture-required` | same | A | **A, but disabled `Loading…` button flashed** during tier 0 (~100 ms) | `autoplay — allowed (probe)` | yes, no click. RMS 2390 pre, 5555 later | `2-M-boot-loading.png`. See mismatch 1 |
| 2 P | Chrome 148, flag | same | no button | no button | none | silent | — |
| 3 M | Chrome 148, `--kiosk` | same | record (likely B) | B | `autoplay — blocked (probe NotAllowedError)` | yes after click. RMS 0 → 5094 | `3-M-boot-armed.png` |
| 3 P | Chrome 148, kiosk | same | no button | no button | none | silent | — |
| 4 M | Chrome 148, kiosk + flag | same | A | **A, `Loading…` flashed** (same as 2 M) | `autoplay — allowed (probe)` | yes, no click. RMS 1370 pre, 5554 later | `4-M-boot-loading.png` |
| 4 P | Chrome 148, kiosk + flag | same | no button | no button | none | silent | — |
| 5 | Edge / Chromium | — | B / A | not run | — | — | Edge not installed. Chromium is a snap, snapd inactive on pandora → won't start |
| 6 M | Firefox 158.0 (mozilla.org tarball) | same | B, `getAutoplayPolicy allowed-muted` | B. Button already `▶ Play` at first poll (tier 0 in <100 ms) | `autoplay — blocked (getAutoplayPolicy allowed-muted)` | yes after click. RMS 27 → 4718 | `6-M-boot-armed.png` |
| 6 P | Firefox 158 | same | no button | no button | none | silent | — |
| 7 M | Firefox 158, `media.autoplay.default=0` | same | A, `getAutoplayPolicy allowed` | A. No button seen | `autoplay — allowed (getAutoplayPolicy allowed)` | yes, no click. RMS 445 pre, 5200 later | 3× `scene: Could not preload …/pub/blobs/… (Error in input stream)` warn |
| 7 P | Firefox 158, allow | same | no button | no button | none | silent | — |
| 8–11 | Safari, iOS, Android | — | — | not run | — | — | Linux box |
| 12 | P → M after click | — | record | not run | — | — | — |

Firefox: snap dead (snapd inactive), used official tarball. Firefox not seen with a
`Loading…` flash in 7 M; 0.25 s poll may miss it.

Click stop (Chrome 148, M, `sliders.preload.delay=3000`): **pass**.
- Play, beats clicked through, link `Out to the street` clicked at +7.0 s.
- `html.sliders-nav-wait` on, spinner on the link, `aria-busy` 1. Shot: `CS-M-clickstop.png`.
- `nav-wait — Street: 5 assets pending` +7003 → `tier-done t1` +9611 → `nav-go — Street` +9611.
- Tiers: `t0` done +3042 → `reveal` +6064 → `t1` +9611. `t2` has 0 assets.
- Music kept playing (RMS 5067).

Console, not `[preload]`, every run:
- `lookups: The trail variable has been set to a undefined, not an array.` (Chapbook, several per load).
- Chrome: `401` on `https://twine-story-store.tmpx.space/favicon.ico`.
- No exceptions, no error box, no beat ran before reveal.

Mismatches vs doc:
1. A cases (2 M, 4 M): doc says "No button at any point". Disabled `Loading…` button shows
   while tier 0 loads, removed at reveal. Cause: `preload.ts:397` mounts boot when the first
   scene has sound, before the autoplay verdict. Music still autoplays.
2. No "no button AND silent" case. Every blocked case armed. Every allowed case made sound.
