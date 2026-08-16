/**
 * Publishing a story with the art it references (spec 03, "Publish pipeline").
 *
 * The Sliders runtime resolves assets through two hidden passages (see
 * `sliders-format`'s `src/runtime/sliders/assets.ts`):
 *
 *     SlidersCast    {characters: Character[]}
 *     SlidersAssets  {assets: AssetMeta[], urls: {key: url}}
 *
 * Nothing wrote them until now, so `manifests().empty` was true for every published story
 * and every scene fell through to `createStubResolver()` — the orange labelled rectangles
 * authors see in Play, Test and Publish to File while the editor preview draws real art.
 *
 * The keying trap: authors write NAMES in scene YAML (`bg: lighthouse-night`) and
 * `dom-renderer` hands those straight to `resolver.url()`, while character frames carry
 * asset IDS (`frame.asset`). The runtime's lookup is a bare map read with no name
 * fallback, so every asset is emitted under BOTH keys. Ids are written last, so a name
 * that happens to equal some other asset's id can never shadow the real one.
 */

import {AssetStore, blobBytes} from '@sliders/asset-store';
import type {AssetMeta} from '@sliders/scene-types';
import type {Passage, Story} from '../store/stories';
import {collectAssetRefs} from './sliders-bundle/collect-asset-refs';
import {resolveBundleRefs} from './sliders-bundle/resolve-refs';

export const CAST_PASSAGE_NAME = 'SlidersCast';
export const ASSETS_PASSAGE_NAME = 'SlidersAssets';
export const MANIFEST_PASSAGE_TAG = 'sliders-manifest';

/**
 * How the manifest addresses an asset's bytes.
 *
 * - `blob` — `store.url()`, i.e. an object URL owned by this origin. Cheap, and valid for
 *   a story that plays in the tab that published it: `replaceDom` uses
 *   `document.open/write/close`, which replaces the Document but not the Window, and the
 *   blob URL store hangs off the environment settings object rather than the document.
 * - `data` — base64 in the HTML. The only thing that survives leaving the origin: a
 *   downloaded file or an Electron scratch file loaded over `file:`. Spec 03 warns
 *   against base64 by default (33% overhead, nothing plays until it all downloads), which
 *   is exactly why this is a caller's choice and not a guess.
 */
export type SlidersUrlFlavor = 'blob' | 'data';

/** `btoa` on a 20 MB string is fine. `String.fromCharCode(...20M args)` blows the stack. */
const BASE64_CHUNK = 0x8000;

async function dataUrl(blob: Blob, mime: string): Promise<string> {
	// blobBytes, not blob.arrayBuffer: some WebViews lack the latter.
	const bytes = new Uint8Array(await blobBytes(blob));
	let binary = '';

	for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + BASE64_CHUNK)
		);
	}

	return `data:${mime || 'application/octet-stream'};base64,${btoa(binary)}`;
}

async function assetUrl(
	store: AssetStore,
	meta: AssetMeta,
	flavor: SlidersUrlFlavor
): Promise<string | undefined> {
	if (flavor === 'blob') {
		return store.url(meta.id);
	}

	const blob = await store.get(meta.id);

	return blob ? dataUrl(blob, meta.mime) : undefined;
}

function manifestPassage(story: Story, name: string, value: unknown): Passage {
	return {
		height: 100,
		highlighted: false,
		id: `sliders-manifest-${name}`,
		left: 0,
		name,
		selected: false,
		story: story.id,
		tags: [MANIFEST_PASSAGE_TAG],
		text: JSON.stringify(value),
		top: 0,
		width: 100
	};
}

export interface SlidersManifestOptions {
	urls: SlidersUrlFlavor;
}

/**
 * The story as it should be published: its own passages plus `SlidersCast` and
 * `SlidersAssets`. The stories store is never touched — these two exist only in the copy
 * handed to `publishStoryWithFormat`, so they cannot leak into the passage map, undo, or
 * the archive.
 */
export async function withSlidersManifests(
	story: Story,
	store: AssetStore,
	{urls: flavor}: SlidersManifestOptions
): Promise<Story> {
	let resolved;

	try {
		resolved = await resolveBundleRefs(store, collectAssetRefs(story));
	} catch (error) {
		// A library that cannot be read must not stop the story from opening. Without the
		// manifests it plays with stub art, which is what it did before this existed.
		console.warn('Could not read the Sliders asset library to publish', error);
		return story;
	}

	const {assets, characters} = resolved;

	// Nothing to say, so say nothing. `manifests().empty` is only true while BOTH passages
	// are absent, and emitting a pair of empty ones would switch the runtime's stub
	// resolver off for the whole story in exchange for no art at all. Once something does
	// resolve, the cliff is worth it: `dom-renderer` draws its own labelled placeholder
	// for any url it cannot get, so a genuinely missing asset still reads as missing.
	if (assets.length === 0 && characters.length === 0) {
		return story;
	}

	const byName: Record<string, string> = {};
	const byId: Record<string, string> = {};
	// `byId<AssetMeta>` in the runtime keys metas by `.id` only, but a prop's meta is
	// looked up by the same name its url is — and it is what sizes the sprite. A copy
	// under the name keeps published props the shape the preview drew them.
	const namedMetas: AssetMeta[] = [];

	for (const meta of assets) {
		const url = await assetUrl(store, meta, flavor);

		if (url) {
			byName[meta.name] = url;
			byId[meta.id] = url;
		}

		if (meta.name && meta.name !== meta.id) {
			namedMetas.push({...meta, id: meta.name});
		}
	}

	return {
		...story,
		passages: [
			// A hand-written manifest passage would win the runtime's `passageNamed` lookup
			// and silently beat the generated one, so it is dropped rather than duplicated.
			...story.passages.filter(
				passage =>
					passage.name !== CAST_PASSAGE_NAME &&
					passage.name !== ASSETS_PASSAGE_NAME
			),
			manifestPassage(story, CAST_PASSAGE_NAME, {characters}),
			manifestPassage(story, ASSETS_PASSAGE_NAME, {
				// Real ids last: `byId` takes the last entry for a key.
				assets: [...namedMetas, ...assets],
				urls: {...byName, ...byId}
			})
		]
	};
}
