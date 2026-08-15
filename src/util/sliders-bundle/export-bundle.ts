/**
 * Writes a `.sliders.zip` — the story plus the assets it references (spec 08).
 *
 * Deliberately free of DOM side effects: it returns a Blob and a filename, and the caller
 * hands them to `file-saver`. That keeps the whole pipeline testable in jsdom.
 */

import {AssetStore, blobBytes} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {AsyncZippable, strToU8, zip} from 'fflate';
import {storyFileName} from '../../electron/shared';
import type {Story} from '../../store/stories';
import type {AppInfo} from '../app-info';
import {publishStory} from '../publish';
import {
	ASSET_DIR,
	BUNDLE_EXTENSION,
	BUNDLE_FORMAT,
	BUNDLE_MANIFEST,
	BUNDLE_VERSION,
	BundleManifest,
	ExportedBundle,
	STORY_HTML,
	STORY_JSON
} from './bundle.types';
import {collectAssetRefs} from './collect-asset-refs';
import {resolveBundleRefs} from './resolve-refs';

/** Text entries deflate; `assets/*` overrides this to 0. */
const TEXT_LEVEL = 6;

const MIME_EXTENSIONS: Record<string, string> = {
	'image/gif': '.gif',
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp'
};

/**
 * The extension is cosmetic — the manifest carries the real mime, and import reads that.
 * It exists so a curious author can unzip the bundle and double-click the pictures, which
 * is also why an unknown type gets `.bin` rather than a guess that opens wrong.
 */
export function assetExtension(mime: string): string {
	return MIME_EXTENSIONS[mime.split(';')[0].trim().toLowerCase()] ?? '.bin';
}

export function assetFilePath(meta: AssetMeta): string {
	return `${ASSET_DIR}${meta.id}${assetExtension(meta.mime)}`;
}

export function buildBundleManifest(
	story: Story,
	assets: AssetMeta[],
	characters: Character[],
	unresolved: string[],
	appInfo: AppInfo
): BundleManifest {
	return {
		assets: assets.map(meta => ({...meta, file: assetFilePath(meta)})),
		characters,
		creator: {name: appInfo.name, version: appInfo.version},
		format: BUNDLE_FORMAT,
		story: {id: story.id, ifid: story.ifid, name: story.name},
		unresolved: [...new Set(unresolved)].sort(),
		version: BUNDLE_VERSION
	};
}

/**
 * fflate's callback API as a promise. Async and not `zipSync` on purpose: a 40 MB library
 * takes long enough that the sync version visibly freezes the tab.
 */
function zipAsync(entries: AsyncZippable): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		zip(entries, {level: TEXT_LEVEL}, (error, data) =>
			error ? reject(error) : resolve(data)
		);
	});
}

export async function exportStoryBundle(
	story: Story,
	store: AssetStore,
	appInfo: AppInfo
): Promise<ExportedBundle> {
	const resolved = await resolveBundleRefs(store, collectAssetRefs(story));
	const unresolved = [...resolved.unresolved];
	const entries: AsyncZippable = {};
	const bundled: AssetMeta[] = [];

	for (const meta of resolved.assets) {
		const blob = await store.get(meta.id);

		if (!blob) {
			// Metadata with no bytes behind it. Reported like any other miss rather than
			// listed in the manifest, which must never promise a zip entry that is absent.
			unresolved.push(meta.name);
			continue;
		}

		entries[assetFilePath(meta)] = [
			// blobBytes, not blob.arrayBuffer: some WebViews lack the latter.
			new Uint8Array(await blobBytes(blob)),
			// WebP/GIF/PNG are already compressed. Deflating them costs CPU for ~nothing.
			{level: 0}
		];
		bundled.push(meta);
	}

	const manifest = buildBundleManifest(
		story,
		bundled,
		resolved.characters,
		unresolved,
		appInfo
	);

	// `story.lastUpdate` is a Date and comes out of JSON.stringify as an ISO string.
	// Accepted rather than worked around: import revives it with `new Date()`, and a
	// custom serializer for one field would be a second thing to keep in sync.
	entries[STORY_JSON] = strToU8(JSON.stringify(story));
	// Rides along only so the zip drags into vanilla Twine. It is lossy — no story or
	// passage ids, no lastUpdate — which is why story.json is what import reads.
	// startOptional because a story with no start passage still has to back up.
	entries[STORY_HTML] = strToU8(
		publishStory(story, appInfo, {startOptional: true})
	);
	entries[BUNDLE_MANIFEST] = strToU8(JSON.stringify(manifest, null, '\t'));

	const blob = new Blob([await zipAsync(entries)], {type: 'application/zip'});

	return {
		blob,
		filename: storyFileName(story, BUNDLE_EXTENSION),
		report: {
			ambiguousFx: resolved.ambiguousFx,
			assetCount: bundled.length,
			bytes: blob.size,
			characterCount: manifest.characters.length,
			unresolved: manifest.unresolved
		}
	};
}
