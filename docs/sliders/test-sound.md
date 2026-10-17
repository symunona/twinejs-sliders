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
