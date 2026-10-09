# DEMO parallax hills

`motion:` on entities. Four tiling layers as `fit: cover` planes, each scrolling at its own
speed, over a still sky. Nearer = faster = parallax.

## Art

`e2e/fixtures/make-parallax.py` (needs Pillow). 1280x720 each, every ridge a sum of sines
whose periods divide the width — tiles horizontally, no seam.

| asset | what |
|---|---|
| `parallax-sky` | gradient + sun. Backdrop, still. |
| `parallax-clouds` | puffs, transparent. |
| `parallax-far` / `-mid` / `-near` | three ridges, transparent above. |

## Scene

```
[scene]
bg: parallax-sky
props:
  clouds: {ref: parallax-clouds, fit: cover, z: -5, motion: {id: scroll_infinite_left, speed: 80}}
  far:    {ref: parallax-far, fit: cover, z: -4, motion: {id: scroll_infinite_left, speed: 40}}
  mid:    {ref: parallax-mid, fit: cover, z: -3, motion: {id: scroll_infinite_left, speed: 20}}
  near:   {ref: parallax-near, fit: cover, z: -2, motion: {id: scroll_infinite_left, speed: 8}, locked: true}
beats:
  - box: "Four layers, four speeds. The nearer, the faster."
```

- `locked: true` on the front layer: stage clicks fall through to the cast in front.
- Stop a layer on a beat: `- near: {motion: ~}`.

## Rebuild

`e2e/sliders-parallax-demo.spec.ts` builds it through the UI, checks each layer moves
further than the one behind it, and exports `Parallax Hills.sliders.zip` into
`$SLIDERS_E2E_SCRATCH`. Library → Import → the zip, in any browser.
