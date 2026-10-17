# 18 — Player loading

Player downloads art in priority order. Reader never outruns it.

Code: `format/src/runtime/sliders/` — `preload-plan.ts` (tree), `asset-loader.ts` (queue),
`preload.ts` (glue, bar, boot, nav stop), `autoplay.ts`, `preload-debug.ts`.
Tests: `__tests__/preload*.test.ts`, `asset-loader.test.ts`.

## Priority tree

| tier | holds |
|---|---|
| 0 | art of the passage the reader opens on (start, or restored save) |
| n | art first needed by passages n clicks away (BFS over `linksOf`: `links:`, entity `link:`, `[[…]]`) |
| last, `unreached` | passages no link reaches, then manifest art no scene names |

- Each url in exactly one tier, lowest wins. `from:` art counts for the inheriting passage.
- Per-scene art = `resolveSceneAssets` (`@sliders/story-map`), same walk as `twine-cli`.
- Conditional links (`if:`) included. Speculative is fine.

## Queue

- 6 at a time. Order: urgent (oldest wait first) → tier → plan order.
- Tiers > 0 CLOSED until reveal. First scene does not share the wire.
- `url()` from a stage = urgent, jumps queue, closed tier or not.
- Failed download → answers remote url. Late picture beats none.
- Held as object urls for the page's life.

## Reveal

1. Page hidden under top bar. Bar = tier 0 + urgent bytes.
2. Tier 0 settled → first stage drawn + imgs decoded (5 s cap).
3. Opening scene has `music:`/`sfx:` (incl. `from:`) → boot screen, see below.
4. Bar gone, all tiers open. Stage starts beats only now (`whenRevealed`) — a timed beat
   never runs out unseen.

## Boot screen (sound on first scene)

Browsers block audible autoplay until a gesture. Chrome/Edge (unless high media
engagement, PWA, `--autoplay-policy=no-user-gesture-required` kiosk), Firefox (Block
Audio default), Safari macOS/iOS. Electron, kiosk shells: allowed.

Detect, in order, every step try/catch:

| step | answers |
|---|---|
| `navigator.userActivation.hasBeenActive` | true → allowed |
| `navigator.getAutoplayPolicy('mediaelement')` | Firefox 112+ only. `allowed` → allowed, `allowed-muted`/`disallowed` → blocked |
| silent WAV through unmuted `<audio>` | resolves → allowed. `NotAllowedError`, other throw, no promise + paused, 1.5 s no answer → blocked |

- Allowed → no button, auto reveal, stages unmute without a gesture.
- Blocked → centred `▶ Play` (disabled `Loading…` until ready). Click = gesture, deck unmutes.
- Sound deck still catches a late `play()` refusal (`13-sound.md`).

## Navigation stop

Click toward a passage whose art is not down:

- Every link blocked (document capture `click`), `html.sliders-nav-wait`, links dimmed.
- Clicked element: `.sliders-link-loading` spinner, `aria-busy`.
- Its art made urgent. Down (or 20 s cap) → click goes through.
- Covers Chapbook `<passage-link>` (capture + re-click) and stage links
  (`followLink` → `navigateWhenReady`).
- No plan / prose passage → no wait.

## Debugger

```js
localStorage.getItem('sliders.preload.debug')?localStorage.removeItem('sliders.preload.debug'):localStorage.setItem('sliders.preload.debug','1');location.reload()
```

- Console: `[preload] +123ms start t1 forest — …` per event.
- Panel bottom right: per asset `✓/…/·/✗ tier label size @start dur ⚡urgent-by [passages]`,
  event log under. `–` collapses.
- Events: `plan queue urgent start done fail tier-done autoplay boot-wait boot-click reveal
  open nav-wait nav-go nav-blocked`.
- Fake slow net: `localStorage.setItem('sliders.preload.delay','800')` (ms per download,
  debug on only). Makes the nav stop reachable.
- Always on: `window.slidersPreload.{loader,plan}` — `loader.events`, `loader.entries`.
