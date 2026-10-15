# 13 — Sound

Sounds are assets. Two keys: `music:` (state: keyed parallel tracks, carries across passages) and `sfx:` (event: one-shot).

## Why not Chapbook's audio

Chapbook ships `[ambient sound]` / `[sound effect]` and they work. Unusable here:

- `scene-only.ts` strips every non-scene block out of a scene passage, inserts included.
  Default on. So a scene passage cannot reach them at all.
- They are player-only. The editor preview could never play a sound, and a preview that
  cannot is the same as no preview — the author checks timing by publishing.
- They take a URL from a vars section. Assets live in the asset store.

`format/src/runtime/sound/` stays vendored and untouched. Prose passages still use it.

## Scene YAML

Grammar + key table: `docs/sliders/02-sliders-format.md` § Music. Parser = spec.

| Write | Means |
|---|---|
| `music: tavern-loop` | track `main`, loops, volume 1. Old form, old meaning. |
| `music: tavern-loop@0.4` | same, volume 0.4. `fx:` token. |
| `music: {id: rain, volume: 0.4, fade: 3s}` | single long form, track `main` |
| `music: {mellow: {id: x, loop: 3}, drums: y@0.3}` | keyed: parallel tracks |
| `music: {wind: {volume: 0.2}}` | no `id` = patch running `wind` |
| `music: {rain: ~}` / `music: ~` | stop one / stop all |
| `stop-other-tracks: all \| [a, b]` | map level: stop tracks not named here |
| `- music: …` / `- mira: {say: …, music: …}` | same `music:` on a beat |
| `- sfx: door-slam`, `{say: …, sfx: gasp}` | one-shot, any beat kind |

## Decisions

| Call | Why |
|---|---|
| `loop` default: single form `true`, keyed entry `false` | user wants `false`. Old `music: x` is a bed in every shipped story — flipping it would break them. Rule: old forms keep old meaning, new form gets new default. |
| `id` present = redefinition, absent = patch | one rule for "change that running track" (volume, fade, loop) without restating the id. |
| Key = identity | same key + same id = keeps playing. Same id under another key = new track. |
| `stop-other-tracks` kebab | user's spelling. Reserved inside a keyed map. |
| `restart: true` -> `take` | restart is an event in a state model. State carries a take (scene top 0, beat i = i+1). Deck restarts when take changes. `newScene()` forgets takes -> scene-top restart fires every passage entry. Scrub back past a restart beat to take-less state: no restart. |
| `fade` per track | old fixed 1.5s (`DEFAULT_DURATIONS.music`) is now the default (`MUSIC_DEFAULT_FADE`). Track fade governs in, out (old track's fade), volume ramp. Diff transition duration ignored. |
| Seconds `2s`/`500ms`/`2` | `asTime` in parser. Music keys only; `dur:`/`autoAdvance:` unchanged. |

## State vs event

| | `music:` | `sfx:` |
|---|---|---|
| Lives on | `Stage.music` (`StageMusic`, keyed) | `BeatBase.sfx` |
| Is | state | event |
| Applied by | `applyMusic` (scene-core), scene top + `runBeats` | `cue()` |
| Reaches renderer via | `apply()` | `cue()` |
| Scrub backwards | re-derived, untouched tracks keep playing | does not fire |
| Step onto beat again | — | fires again |

`applyMusic(current, spec, take)`: `undefined` = unchanged, `null` = silence, spec = named keys
set/patched/stopped, others untouched unless `stopOthers`. Same function scene top and beats.

## Across passages

- State is PER PASSAGE. Scene top starts from the `from:` stage (inherits) or empty. No
  `music:`, no `from:` = silence. Editor previews one passage and must not lie.
- Carry is PLAYBACK. One player deck (`format/src/runtime/sliders/player-deck.ts`) outlives
  every stage element. New stage diffs against what the deck holds -> same key + same id plays
  straight through. Old bug: deck per renderer, `destroy()` stopped it, nothing ever carried.
- Claim / release: stage claims deck before first `await`, releases on disconnect. No claim
  within `RELEASE_GRACE_MS` (120) -> fade out all (prose passage, story end). Either swap order works.
- `window.slidersPlayerDeck.held()` — key, id, take, done. For e2e.
- Two stages in one passage fight over the deck. Not handled.

## Playback

`packages/render-dom/src/sound-deck.ts`. Editor: one deck per renderer (owned, stopped on
destroy). Player: shared deck (`DomRenderer({deck})` — not owned, never stopped, never re-muted
by a renderer default).

`deck.music(tracks)` diffs by key:

| Case | Does |
|---|---|
| key gone | fade out over OLD track's fade, pause, drop src |
| key new | new `<audio>`, `currentTime = start`, fade in |
| same key, new id | crossfade, new track's fade |
| same id, new take | restart |
| same id otherwise | keep playing, ramp volume, loop mode live |

| `loop` | Does |
|---|---|
| `false` | once, stays ended. Re-applying same state does not restart. |
| N | counts `ended`, rewinds to `start`, N plays total |
| `{from, to}` | 25ms poll (`timeupdate` ~250ms too coarse), jump to `from` at `to` |
| `{from}` | jump to `from` on `ended` |

- `<audio>` elements, never appended. No AudioContext (suspended outside gesture, PCM decode cost).
- Fades hand-rolled, 30Hz. One ramp per element; newer cancels older.
- Slow URL lookup overtaken by newer state -> element dropped (held-track object = guard).
- `MAX_VOICES = 8` one-shots, oldest cut.
- `data-music` on renderer root = ids space-joined, key order. Single track = its id.
- Names resolve through the renderer's `AssetResolver`, same as art.

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

1. **Sounds tab** in asset manager. Drop an mp3. Tile ▶ auditions in place.
2. **Drag tile into passage text** -> `- sfx: name`. Second button copies `music:` line. Tile on
   stage = no-op (a sound has no position).
3. **Drop an audio FILE on the stage** -> uploaded as sound, scene `music: <name>` written
   (replaces existing value). No bg/object menu for audio.
4. **Ctrl+Space**: `music`/`sfx` keys, sound names as values (keyed entries, `id:`),
   `MUSIC_KEYS` inside a music map, `from`/`to` in `loop: {`, `all` for `stop-other-tracks`.
5. **`?` Scene Help**: Stage ▸ Music table. `Record<typeof KEYS[number], string>` = build fails
   until a new key is documented.
6. **Speaker button** in preview bar.
7. **Beat strip**: `♪` sfx beat, `♫` music beat.

## Bundle / lint

- `soundRefs` (`collect-asset-refs.ts`): every keyed track id, scene top AND beats. Patch/stop
  names no file.
- `story-map` `resolveSceneAssets` -> twine-cli lint: one row per track. Labels `music:`,
  `music/<track>:`, `beats/N music/<track>:`.
- `rename-scene-refs`: renames ids inside keyed maps + beats. Track names never touched.

## Not built

- No waveform, no trim, no sound in the visual editor beyond audition + drop.
- No per-sound loop on `sfx:`. One-shot is the definition.
- No ducking, no bus, no fade curve choice (linear).
- `loop: {from, to, times}` — section loop is forever.
- Track move between keys keeps playing — not done; key is identity.
- Nothing reads `AssetMeta.duration` except the tile label.
