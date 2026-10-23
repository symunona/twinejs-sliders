# DEMO particles

Live store, story id `9a7c1e00-5f1d-4c2b-8e6a-0b1e5c0ffee1`. Spec: [19](../19-particles.md).

| Passage | Shows |
|---|---|
| Campfire | `fire` `smoke` `sparks` stacked. Beats: blue flame (`emit: {color…}`), `rate: 0` out, `emit: ~` back. |
| Snow | `snow` (origin top, wide box), `magic` (origin middle). `emit: {rate: 120}` heavier. |

Art: shared collection `particles` (`scripts/particle-pack.mjs`) + `parallax-sky` from the
parallax demo's collection. Binding attaches both.
