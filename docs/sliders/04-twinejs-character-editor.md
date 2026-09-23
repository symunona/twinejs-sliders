# 04 — Character editor (twinejs fork)

Opened by clicking a character in the [asset manager](03-twinejs-asset-manager.md). Tab per
character (D8). Output = the character manifest in [02](02-sliders-format.md).

## Why it's separate

Anchors are **the one thing authors cannot sanely type by hand.** Everything else in the
scene format is typeable. This editor exists mainly to drag two dots onto a sprite.

## Vocabulary

| term | means |
|---|---|
| **pose** | named thing a character shows: a still, an animated file, or steps |
| **step** | one timed image inside a pose |
| **pose image** | the asset a pose or step points at. Stored `kind: 'frame'` (wire compat). |

`frame` is retired in UI, types, docs. Only the stored asset kind keeps it.

## Layout

```
┌─ Characters ──────────────────────────────────────────────┐
│ [Mira] [Joren] [+]                                        │
├──────────────┬────────────────────────────────────────────┤
│  POSES       │                                            │
│  ▸ idle    ⟳ │            ┌──────────────┐                │
│  ▸ arms      │            │              │                │
│  ▸ angry     │            │   ● bubble   │  ← drag        │
│  ▸ wave    ⟳ │            │              │                │
│  [+ drop]    │            │   ● mouth    │  ← drag        │
│              │            │              │                │
│              │            └──────┬───────┘                │
│              │                   ✛ origin  ← drag         │
├──────────────┴────────────────────────────────────────────┤
│ size 512×1024   tags: tavern, main-cast                   │
└───────────────────────────────────────────────────────────┘
```

## Poses (D5/D6)

| Action | Result |
|---|---|
| Drop files onto the pose list | uploads via asset manager, `kind: 'frame'`, `ownerCharacter` set. One pose per file. First one is `idle`. |
| Pose name | derived from filename, editable. This is what `pose:` refers to in scene YAML. |
| `⟳` badge | pose plays by itself: animated file OR steps. |
| `loop: false` | per-pose toggle, for one-shots like `wave`. Honoured for steps. |
| Edit image | asset editor on the pose image. Disabled for animated files and step poses. |
| Delete a pose | warn if any passage references it (needs the scene index) |

Animation = baked images: an animated file, or steps. No skeletal runtime. (D5)
Step strip, Import set…, sprite sheet slicing, align feet: planned,
[character-poses.md](../2026-09-23-point-and-click/character-poses.md).

## Anchors

Draggable dots on the sprite preview. Stored as **fractions of the character box**, never
pixels.

| Anchor | Used for |
|---|---|
| `bubble` | where speech bubbles attach (D2) |
| `mouth` | reserved — lipsync/effects later |
| *(custom)* | add by name; the renderer just reports positions |

Why fractions: uniform sizes today → per-pose sizes tomorrow → 3D sockets after that, and
the scene YAML never changes.

**Anchors are per pose**, not per character, not per step. A character who turns away has
their mouth elsewhere; a bubble that jitters every step is worse than one slightly off.
Adding/removing an anchor applies to every pose; dragging moves it on the selected pose.

## Pose fit

Per pose `fit: {offset, scale}`, fractions of the box. Registration, not expression: nudges
the art, never the rig. A step's own `fit` wins over its pose's.

## Origin

One draggable cross. Defaults to `{x: 0.5, y: 1.0}` — bottom centre = feet.

This is why `at: 0` means "standing centre" rather than "floating centre".

## Preview

Shows the selected pose at real aspect ratio, with:

- anchor dots and origin cross, draggable
- a centre line and floor line, so the origin makes visual sense
- ghost poses: other poses drawn faint, to check registration between them

## Fields

| Field | Notes |
|---|---|
| `id` | slug. Unique. This is what scene YAML writes. Renaming = rewrite refs (needs scene index). |
| `name` | display name |
| `size` | `{w, h}`, uniform across poses |
| `origin` | fraction |
| `poses` | map of name → `{asset?, steps?, loop?, fit?, anchors?}`. Old manifests: `frames`, read as `poses`. |
| `faces` | `left` / `right`, which way the art looks. Default right. For walk-here. |
| `walkSpeed` | reserved for walk-here. |
| `tags` | shared with asset manager filtering |

## Persistence

Manifests are written to the hidden **`SlidersCast`** passage. Reasons:

- passages are the only thing that survives into stock Twine
- they ride import/export and archive for free
- text, so they diff

Asset **bytes** stay in the asset store. Manifests hold ids only.

## Out of scope

Rigging. Bones. Per-step anchors. Face/expression compositing (`slots:` is the future hook,
and it won't require a scene YAML change).
