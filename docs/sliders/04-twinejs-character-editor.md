# 04 — Character editor (twinejs fork)

Opened by clicking a character in the [asset manager](03-twinejs-asset-manager.md). Tab per
character (D8). Output = the character manifest in [02](02-sliders-format.md).

## Why it's separate

Anchors are **the one thing authors cannot sanely type by hand.** Everything else in the
scene format is typeable. This editor exists mainly to drag two dots onto a sprite.

## Layout

```
┌─ Characters ──────────────────────────────────────────────┐
│ [Mira] [Joren] [+]                                        │
├──────────────┬────────────────────────────────────────────┤
│  FRAMES      │                                            │
│  ▸ idle    ⟳ │            ┌──────────────┐                │
│  ▸ arms      │            │              │                │
│  ▸ angry     │            │   ● bubble   │  ← drag        │
│  ▸ wave      │            │              │                │
│  [+ drop]    │            │   ● mouth    │  ← drag        │
│              │            │              │                │
│              │            └──────┬───────┘                │
│              │                   ✛ origin  ← drag         │
├──────────────┴────────────────────────────────────────────┤
│ size 512×1024   tags: tavern, main-cast                   │
└───────────────────────────────────────────────────────────┘
```

## Frames (D5/D6)

| Action | Result |
|---|---|
| Drop files onto the frame list | uploads via asset manager, `kind: 'frame'`, `ownerCharacter` set |
| Frame name | derived from filename, editable. This is what `frame:` refers to in scene YAML. |
| `⟳` badge | file is animated. Plays in preview. |
| `loop: false` | per-frame toggle, for one-shots like `wave` |
| Delete a frame | warn if any passage references it (needs the scene index) |

Animation = an animated file. No timeline UI. No sprite sheets. (D5)

## Anchors

Draggable dots on the sprite preview. Stored as **fractions of the frame**, never pixels.

| Anchor | Used for |
|---|---|
| `bubble` | where speech bubbles attach (D2) |
| `mouth` | reserved — lipsync/effects later |
| *(custom)* | add by name; the renderer just reports positions |

Why fractions: uniform sizes today → per-frame sizes tomorrow → 3D sockets after that, and
the scene YAML never changes.

**Anchors are per-character, not per-frame** in v1. If a character's frames differ wildly,
that's a signal to split them into two characters.

## Origin

One draggable cross. Defaults to `{x: 0.5, y: 1.0}` — bottom centre = feet.

This is why `at: 0` means "standing centre" rather than "floating centre".

## Preview

Shows the selected frame at real aspect ratio, with:

- anchor dots and origin cross, draggable
- a centre line and floor line, so the origin makes visual sense
- optional onion-skin of another frame, to check registration between poses

## Fields

| Field | Notes |
|---|---|
| `id` | slug. Unique. This is what scene YAML writes. Renaming = rewrite refs (needs scene index). |
| `name` | display name |
| `size` | `{w, h}`, uniform for now |
| `origin` | fraction |
| `anchors` | map of name → fraction |
| `frames` | map of name → `{asset, loop?}` |
| `tags` | shared with asset manager filtering |

## Persistence

Manifests are written to the hidden **`SlidersCast`** passage. Reasons:

- passages are the only thing that survives into stock Twine
- they ride import/export and archive for free
- text, so they diff

Asset **bytes** stay in the asset store. Manifests hold ids only.

## Out of scope

Rigging. Bones. Sprite sheets. Per-frame anchors. Face/expression compositing (`slots:` is
the future hook, and it won't require a scene YAML change).
