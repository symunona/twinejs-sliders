# Point and click — plans

Status: planned. 2026-09-23.

Goal: Syberia-style play. Click object → character walks there → action fires.

| Doc | What |
|---|---|
| [walk-area.md](walk-area.md) | Walk polygon + depth gizmo on the bg asset. Ghost character, walk-here preview. |
| [character-poses.md](character-poses.md) | `frame` → `pose` / `step` rename. Import poses from an image set. |

## Order

1. `character-poses.md` rename lands first. Walk-here needs a `walk` pose, and the new
   code should use the new names only.
2. `walk-area.md`.
3. Later, own spec: hotspots (`stand:`, `cursor:`, `hit:`), `player:`, exits, inventory.

## Prior art

AGS (Adventure Game Studio): walkable area, walk-behind, hotspot, walk-to point, region,
scaling. We steal its model, not its code.

## Decided

| | |
|---|---|
| Walk data | `AssetMeta.walk`, NOT a sidecar. Sidecars never reach bundles or the player (`checkout-story.ts:16`, `importAsset` strips). `effect` is the precedent for runtime meta. |
| Naming | `pose` + `step`. The word `frame` is retired. |
| Animation tech | Baked image sequences. No Spine or skeletal runtime. Any rig tool (Synfig, Blender, OpenToonz, DragonBones) → export PNG sequence → import as a pose. |
