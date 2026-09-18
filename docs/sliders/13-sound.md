# 13 — Sound

Sounds are assets. Two keys: `music:` (bed, loops) and `sfx:` (one-shot).

## Why not Chapbook's audio

Chapbook ships `[ambient sound]` / `[sound effect]` and they work. Unusable here:

- `scene-only.ts` strips every non-scene block out of a scene passage, inserts included.
  Default on. So a scene passage cannot reach them at all.
- They are player-only. The editor preview could never play a sound, and a preview that
  cannot is the same as no preview — the author checks timing by publishing.
- They take a URL from a vars section. Assets live in the asset store.

`format/src/runtime/sound/` stays vendored and untouched. Prose passages still use it.

## Scene YAML

| Write | Means |
|---|---|
| `music: tavern-loop` | bed, loops, volume 1 |
| `music: tavern-loop@0.4` | same token `fx:` uses — volume 0.4 |
| `music: {id: rain, volume: 0.4}` | long form. `volume:`, NOT `amount:` (parser hints) |
| `music: ~` | silence, stated. Same shape as `bg: ~` |
| `- sfx: door-slam` | fire once, its own beat |
| `- mira: {say: "Oh!", sfx: gasp}` | fire under a line |
| `- mira: {at: 0.3, sfx: step}` | fire under a move |
| `- box: {text: "…", sfx: creak}` | fire under narration |

`sfx` sits on `BeatBase`, like `dur` — one key, every beat kind.

## The repetition is deliberate

`music:` is NOT inherited by a snapshot. Every scene that wants a bed says so.

Looks like repetition; is not. `diffStages` compares id AND volume, so re-declaring the
same track emits no transition and the bed plays straight through a passage change.

The alternative — music carrying over silently — cannot work. The editor previews ONE
passage and has no way to know what played before it. Preview would lie.

`from:` patches DO inherit, like everything else.

## State vs event

| | `music:` | `sfx:` |
|---|---|---|
| Lives on | `Stage.music` | `BeatBase.sfx` |
| Is | state | event |
| Reaches renderer via | `apply()` | `cue()` |
| Scrub backwards | re-derived, no restart | does not fire |
| Step onto beat again | — | fires again |

A stage after a door slams looks exactly like the stage before it. That is why `sfx` is
not stage state and `cue()` is not part of `apply()`.

## Playback

`packages/render-dom/src/sound-deck.ts`. One `SoundDeck` per renderer, built lazily.

- `<audio>` elements, never appended to the document. Detached plays fine; appended would
  put a node in the stage box that layout, `measure()` and hit-testing must all ignore.
- No AudioContext. Starts suspended outside a gesture, and decoding a 5-minute bed to PCM
  costs tens of MB for nothing this needs.
- Volume fades hand-rolled (`fadeTo`, 30Hz) — `<audio>` has no automation, and the graph
  that does would mean the context above.
- Names resolve through the renderer's own `AssetResolver`, same as art.
- `MAX_VOICES = 8`. One-shots overlap (two footsteps = two sounds), oldest cut past that.
- `musicGen` guards a crossfade overtaken by a newer one. Without it a slow URL lookup
  starts a bed nothing holds a reference to, and it plays forever.

Shared by editor and player on purpose. Same mix both places or the preview is useless.

## Muting

| Surface | Default | Control |
|---|---|---|
| Editor preview | MUTED | speaker button in the preview bar, `sliders.preview.sound` |
| Player | plays after first gesture | `sliders.mute: true` in a vars section |

Editor is silent by default because a passage opened to fix a typo must not start music.
Someone wearing headphones next to other people would mute the browser tab, and then every
sound the feature exists for is inaudible too.

Autoplay policy: a stage mounts muted and `setMuted(false)` is what actually starts the
bed, so the first sound begins on the reader's first tap instead of never.
`navigator.userActivation.hasBeenActive` short-circuits it — activation is sticky per
document, so a reader who clicked to get here has already paid. Listener is on `document`,
not the stage: the first passage is often not a scene.

## Asset store

- `AssetKind` gained `'sound'`.
- `sniff-audio.ts` — mp3 (ID3 or frame sync), ogg, wav, flac, m4a. Separate module from
  `sniff.ts`, which exists to answer "can canvas re-encode this" — a question sound never
  asks.
- `prepareUpload` checks audio BEFORE the image path. Otherwise `measure()` hands the file
  to `createImageBitmap`, which rejects slowly and logs a warning per file in a drop of 40.
- Stored verbatim. No transcode — no canvas equivalent, and re-encoding audio in the
  browser is a different project.
- `AssetMeta.duration?` (seconds), measured with a `preload="metadata"` `<audio>`, 5s
  timeout. A label only. Absent when undecodable; never timing anything depends on.
- `putAsset` forces `kind: 'sound'` from the BYTES. A sound dropped on Backgrounds is a
  mis-aim, and `kind ?? 'bg'` fallthrough is how frames once became backgrounds in silence.
- `w`/`h` are 0. `isVisualKind()` exists for readers that care.

## Learnability chain

Author never reads this file. Each step hands them the next.

1. **Sounds tab** in the asset manager. Drop an mp3. Tile has ▶ — audition in place.
   `rain-heavy` vs `rain-heavy-2` is indistinguishable in a list, obvious when played.
2. **Drag the tile into the passage text** → pastes `- sfx: name`. Never typed from
   memory. Same gesture that taught them `bg:`. Second button copies the `music:` line.
   No stage drop: a sound has no position (same call as `fx:`, spec 10:291).
3. **Ctrl+Space** offers `music:`/`sfx:` among the keys, then sound names as values.
   Sounds ONLY for that slot — a backdrop's name in `sfx:` is not an unusual choice, it is
   a mistake with nothing to play.
4. **`?` Scene Help** documents both. `Record<typeof KEYS[number], string>` means the
   build FAILS until a new key is documented.
5. **Speaker button** in the preview bar. Sound is off until asked for; the click that
   turns it on is also the gesture the browser wants.
6. **Beat strip** shows `♪` in the speaker slot for an sfx beat.

## Bundle

`soundRefs` in `collect-asset-refs.ts`, its own bucket. Unresolved means something
different from a missing picture: no `? bg` appears on stage, it is simply inaudible, so
the export report is the only place it can be mentioned. Resolved by name only — no
`entityKey` mangle to undo, because no fragment ever slugified one.

## Not built

- No sound in the visual editor beyond audition. No waveform, no trim.
- No `music:` change on a beat. Use `from:`/a new scene. `- music:` would need a beat kind
  and a rule for what a scrubber does with it.
- No per-sound loop control on `sfx:`. One-shot is the definition.
- No ducking, no bus, no crossfade curve choice. `DEFAULT_DURATIONS.music = 1.5s` for all.
- Nothing reads `AssetMeta.duration` except the tile label.
