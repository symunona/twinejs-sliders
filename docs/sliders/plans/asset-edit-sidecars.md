# Non-destructive asset editing — sidecar blobs + edit params on meta

Status: implementing. Branch `asset-sidecars`.

## Problem

Asset editor bakes pixels and overwrites. `store.replace()` drops the old bytes.
Re-open an edited asset: sliders at 0/0/1, edit looks unedited. Re-adjust stacks on
already-baked pixels, and `prepareUpload` re-encodes lossy WebP every round.
Background removal is worse — the ML mask is thrown away, so re-tuning means re-running
the model.

## Shape

One asset id owns up to three blobs. The current bytes keep the bare id, so every reader
downstream (renderer, `url()` cache, sync, bundle export) is untouched.

| Key | Written | Holds |
|---|---|---|
| `<id>` | every save | current baked bytes. Contract unchanged. |
| `<id>#src` | first non-trivial save, then never | pre-edit pixels, the re-edit base |
| `<id>#cutout` | when a cutout exists | alpha mask, PNG-packed |

`AssetMeta` gains `edits`, `tuning`, `sidecars`. Params live in the manifest, not in a
blob — the manifest is already read on every `load()`.

## Re-edit base

One rule, no branches:

```
base = sidecar(id, 'source') ?? get(id)
```

Save-as-new writes `#src` too, so a variant re-edits from its own base rather than
chasing `sourceAsset`. `sourceAsset` stays what it is: provenance.

## Why PNG for the mask

`alpha` is `Float32Array`, one float per source pixel. 2048² = 16 MB raw. Packed
grayscale into a lossless PNG it is a few hundred KB. 8 bits is plenty — `applyTuning`
thresholds the mask anyway.

## Files

| File | Change |
|---|---|
| `packages/scene-types/src/index.ts` | `CropRect`, `ImageEdits`, `CutoutTuning`, `SidecarKind`; three new `AssetMeta` fields |
| `packages/asset-store/src/ids.ts` | `sidecarKey(id, kind)` |
| `packages/asset-store/src/asset-store.types.ts` | `ReplaceAssetOptions`, `sidecar()`, `PutAssetOptions` extras |
| `packages/asset-store/src/store.ts` | `replace` writes sidecars, `remove` deletes them, `sidecar()` reads |
| `src/dialogs/asset-editor/cutout-map.ts` | new — pack/unpack alpha |
| `src/dialogs/asset-editor/image-edits.ts` | re-export moved types |
| `src/dialogs/asset-editor/background-engine.ts` | re-export `CutoutTuning` |
| `src/dialogs/asset-editor/asset-editor.tsx` | load from base + mask, save with params |

Backends need **no change**. They key blobs by an opaque string already, and `#` cannot
occur in an asset id (`randomAssetId` is `a_<hex>`), so a sidecar key can never collide.

## Decided

- **Sidecars do not sync and do not go in bundles.** Both enumerate manifest assets by
  id (`asset-sync.ts:170`). Re-editability is device-local. Cheap, and nobody wants a
  16 MB original crossing the wire to a reader.
- **`remove()` deletes sidecars** from `meta.sidecars` — an explicit list, so no backend
  needs a prefix sweep.
- **`#src` is written once.** Second edit of the same asset re-bakes from `#src`, so
  there is no generation loss and no reason to overwrite it.
- **No version chain.** Day/night are separate assets linked by `sourceAsset`, which the
  scene format already assumes (`02-sliders-format.md:167` — scene `tavern-night` implies
  backdrop `tavern-night`).

## Not doing

- Migrating assets edited before this. They have no `#src`; they re-edit from their baked
  bytes, same as today.
- The true original. `prepareUpload` transcodes to lossy WebP before the first
  `writeBlob`, so `#src` preserves first-stored bytes, not what the author uploaded.
  Separate call.
