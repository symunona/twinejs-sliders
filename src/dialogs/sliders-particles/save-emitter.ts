/**
 * Writes an emitter's DEFAULTS (its asset's `particles` / `origin`) from the Particles
 * dialog.
 *
 * The asset is the particle system: every scene placing it reads these numbers, and a
 * scene's `emit:` overrides them per key. So an edit here goes to the asset itself, in
 * whatever collection it lives in — the shared `particles` pack included, so every story
 * using it follows. The store refuses a shared asset without a scope
 * (`SharedAssetError`); this is the scope the dialog means:
 *
 * | asset | scope |
 * |---|---|
 * | own, used nowhere else | none needed |
 * | shared, collection open | `all` — the one record, every story |
 * | shared, collection locked | `fork` — this story's own copy, which shadows it by name |
 */

import type {AssetId, AssetMeta} from '@sliders/scene-types';
import type {
	LibraryAssetMeta,
	LibraryAssetStore,
	SharedInfo
} from '../../store/asset-library/story-asset-store';

export type EmitterDefaults = Pick<AssetMeta, 'particles' | 'origin'>;

export function emitterEditScope(
	info: SharedInfo | undefined
): 'all' | 'fork' | undefined {
	if (!info?.shared) {
		return undefined;
	}

	return info.canUpdateAll ? 'all' : 'fork';
}

export async function saveEmitterDefaults(
	store: Pick<LibraryAssetStore, 'sharedInfo' | 'update'>,
	id: AssetId,
	changes: EmitterDefaults
): Promise<LibraryAssetMeta> {
	const scope = emitterEditScope(await store.sharedInfo(id));

	return store.update(id, changes, scope ? {scope} : {});
}
