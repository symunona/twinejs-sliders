# DEMO text-bubble styles

Six passages. Built in the editor, art generated locally (a flat SVG figure `mira/idle`
and a gradient backdrop `bg`), story defaults in the Start passage vars.
Kept here so the demo can be rebuilt anywhere — the story itself lives in an editor
library, not on the store.

Headings ARE the passage names. Every `links:` target spells one exactly — a case-only
miss still plays, but the editor and `twine-cli lint` call it out as `passage-case`.

## Start

```
sliders.bubble.as: 'comic'
sliders.bubble.font: 'Bangers, cursive'
sliders.autoAdvance: 0
--
[scene]
id: demo-start
bg: bg
cast:
  mira: {at: -0.2, scale: 0.9}
beats:
  - box: "DEMO — text bubble styles. Click to advance."
  - mira: "Every bubble here is DRAWN — an SVG built from numbers, not a rounded div."
  - mira: "This story sets as: comic and a font once, in its vars. A scene or a line can still override either."
  - box: "Pick a room. Each one ends with a PASS / FAIL check you can read off the screen."
links:
  Comic: Comic
  Shard and impact: Impact
  Thought: Thought
  Fixed size: Fixed
  Detached: Detached
```

## Comic

```
[scene]
id: demo-comic
bg: bg
cast:
  mira: {at: -0.3, scale: 0.9}
beats:
  - box: "COMIC — a squircle balloon with a straight spike, drawn as ONE path."
  - mira: {say: "The tail is spliced into the outline, so nothing is drawn across its base.", bubble: {as: comic}}
  - mira: {say: "bg: fills me, accent: inks me.", bubble: {as: comic, bg: "#ffe9a8", accent: "#7a2f10", color: "#301505"}}
  - mira: {at: 0.35, dur: 0.6, say: "Move me and the spike follows: the shape is redrawn on every reposition.", bubble: {as: comic}}
  - box: {text: "PASS: one balloon, one spike pointing at mira, no seam across the spike, amber balloon inked brown. FAIL: floating tail, line across the tail base, or colours ignored.", as: bold}
links:
  Back: Start
```

## Impact

```
[scene]
id: demo-impact
bg: bg
cast:
  mira: {at: -0.35, scale: 0.9}
beats:
  - box: "SHARD and IMPACT — hard panel, offset plate, lightning-bolt tail."
  - mira: {say: "SHARD. The plate leans away from the tail so the bolt stays readable.", bubble: {as: shard, w: 0.4}}
  - mira: {say: "IMPACT adds the mark, always at the corner opposite the tail.", bubble: {as: impact, w: 0.4}}
  - mira: {at: 0.4, dur: 0.6, say: "Cross the stage and the bolt swaps sides with me.", bubble: {as: impact, w: 0.4}}
  - mira: {say: "accent: recolours plate, outline and mark together.", bubble: {as: impact, w: 0.4, accent: "#ff3b6b"}}
  - box: {text: "PASS: white panel on a cyan plate, jagged bolt reaching mira, mark opposite the bolt, last panel pink. FAIL: square corners, no plate, or mark sitting over the text.", as: bold}
links:
  Back: Start
```

## Thought

```
[scene]
id: demo-thought
bg: bg
cast:
  mira: {at: 0.3, scale: 0.9}
beats:
  - box: "THOUGHT — a cloud, and a trail of puffs instead of a tail."
  - mira: {say: "…was the door ever locked?", bubble: {as: thought, w: 0.3}}
  - mira: {say: "The puffs shrink towards whoever is thinking.", bubble: {as: thought, w: 0.3}}
  - box: {text: "PASS: scalloped cloud, three shrinking puffs aimed at mira, text clear of the scallops. FAIL: smooth oval, a spike, or text touching the edge.", as: bold}
links:
  Back: Start
```

## Fixed

```
[scene]
id: demo-fixed
bg: bg
bubble: {sizing: absolute, w: 0.42, h: 0.22, as: shard}
cast:
  mira: {at: -0.35, scale: 0.9}
beats:
  - box: "FIXED — the scene sets sizing: absolute, so the box is 42% x 22% of the slide and the TEXT is fitted to it."
  - mira: "Short."
  - mira: "Same rectangle, many more words in it: the type shrinks until the words fit, rather than the box growing until the words do. That is the whole of sizing: absolute, and it is why a panel composed at one size stays composed at every window size."
  - mira: {say: "And this one opts back out, so the box snaps to the words again.", bubble: {sizing: auto, w: 0.35}}
  - box: {text: "PASS: the first two panels are the SAME size with different type sizes; the last is a small panel with normal type. FAIL: panel 2 taller than panel 1, or text spilling out of it.", as: bold}
links:
  Back: Start
```

## Detached

```
[scene]
id: demo-detached
bg: bg
bubble: {as: comic}
cast:
  mira: {at: -0.4, scale: 0.9}
beats:
  - box: "DETACHED — anchor: scene takes a bubble off its speaker."
  - mira: {say: "Normal: I am hung off mira's shoulder.", bubble: {w: 0.32}}
  - mira: {say: "anchor: scene — no tail, parked where at: says, whoever is speaking.", bubble: {anchor: scene, at: [0.3, 0.22], w: 0.32}}
  - mira: {at: 0.45, dur: 0.8, say: "She walks. The caption does not.", bubble: {anchor: scene, at: [0.3, 0.22], w: 0.32}}
  - mira: {say: "A thought can be detached too.", bubble: {anchor: scene, as: thought, at: [0.72, 0.72], w: 0.28}}
  - box: {text: "PASS: beat 2 has a tail, beats 3-5 have none and hold their spot while mira crosses the stage. FAIL: a tail on a detached bubble, or one that follows her.", as: bold}
links:
  Back: Start
```

