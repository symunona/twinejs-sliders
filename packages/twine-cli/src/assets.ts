/**
 * The asset walk, plus the one piece of it that needs a `Source`.
 *
 * Resolution itself moved to `@sliders/story-map` when the voice panel needed the same
 * answers in a browser. What stays here is `loadCatalog`: reading a manifest and asking
 * where a blob lives are I/O, and I/O is what a CLI has that a browser tab does not.
 */

import {catalogFromManifest} from '@sliders/story-map';
import type {AssetCatalog} from '@sliders/story-map';
import type {Source} from './types';

export {
	catalogFromManifest,
	catalogRows,
	referencedAssetIds,
	resolveSceneAssets,
	unusedAssets
} from '@sliders/story-map';
export type {
	AssetCatalog,
	AssetPresence,
	AssetRow,
	ResolveOptions,
	SceneLookup
} from '@sliders/story-map';

/** Build the lookup tables once per invocation; every resolution below is then synchronous. */
export async function loadCatalog(
	source: Source,
	storyId: string
): Promise<AssetCatalog> {
	const manifest = await source.manifest(storyId);

	return catalogFromManifest(manifest, async id => source.assetPath(storyId, id));
}
