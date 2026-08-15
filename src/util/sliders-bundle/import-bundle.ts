/**
 * Reading a `.sliders.zip`. Parse and check only — this module never touches the asset
 * store.
 *
 * The split is the point (spec 08): the import dialog has to be able to say "these four
 * assets are already yours, this one clashes with art you already have" *before* a byte is
 * written, and the author has to be able to cancel. So everything here is pure, and every
 * problem that is not fatal comes back as prose in `warnings` rather than as a throw.
 *
 * Fatal means "there is nothing here to import": no manifest, not our format, or a bundle
 * from a future Twine whose rules we do not know. Everything else — a mangled hash, an
 * asset whose bytes went missing, an unreadable `story.json` — degrades instead.
 */

import {strFromU8, unzip, unzipSync} from 'fflate';
import type {Unzipped} from 'fflate';
import {blobBytes, contentHash} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {
	BUNDLE_FORMAT,
	BUNDLE_MANIFEST,
	BUNDLE_VERSION,
	STORY_HTML,
	STORY_JSON
} from './bundle.types';
import type {
	BundleAsset,
	BundleAssetEntry,
	BundleContents,
	BundleManifest
} from './bundle.types';
import {importStories} from '../import';
import type {Story} from '../../store/stories';

/**
 * `unzip` hands the work to a Worker so a 40 MB bundle cannot freeze the tab — which is
 * why the sync twin is not used here. But fflate builds that Worker out of
 * `URL.createObjectURL`, and jsdom and some locked-down WebViews have neither. It throws
 * synchronously when they are missing, so fall back to unzipping on this thread: a slow
 * import beats an import that cannot happen.
 */
function unzipAsync(data: Uint8Array): Promise<Unzipped> {
	return new Promise((resolve, reject) => {
		const fail = (error: unknown) =>
			reject(
				new Error(
					`This file could not be read as a zip archive. It may be damaged or may not be a Sliders bundle. (${
						error instanceof Error ? error.message : String(error)
					})`
				)
			);

		try {
			unzip(data, (error, unzipped) =>
				error ? fail(error) : resolve(unzipped)
			);
		} catch {
			try {
				resolve(unzipSync(data));
			} catch (error) {
				fail(error);
			}
		}
	});
}

function textEntry(files: Unzipped, name: string): string | undefined {
	const bytes = files[name];

	return bytes ? strFromU8(bytes) : undefined;
}

function readManifest(files: Unzipped): BundleManifest {
	const text = textEntry(files, BUNDLE_MANIFEST);

	if (text === undefined) {
		throw new Error(
			`This zip file has no ${BUNDLE_MANIFEST} inside, so it is not a Sliders bundle.`
		);
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error(
			`The ${BUNDLE_MANIFEST} in this bundle is damaged and could not be read.`
		);
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new Error(
			`The ${BUNDLE_MANIFEST} in this bundle is damaged and could not be read.`
		);
	}

	const manifest = parsed as Partial<BundleManifest>;

	if (manifest.format !== BUNDLE_FORMAT) {
		throw new Error(
			`This file is not a Sliders bundle. It says its format is ${
				manifest.format ? `"${manifest.format}"` : 'missing'
			}, not "${BUNDLE_FORMAT}".`
		);
	}

	if (
		typeof manifest.version !== 'number' ||
		!Number.isFinite(manifest.version)
	) {
		throw new Error(
			'This bundle does not say which version it is, so it cannot be opened.'
		);
	}

	// A lower version is fine: older bundles are readable, that is what versioning is for.
	// A higher one is not — it may lean on rules this copy has never heard of, and quietly
	// importing half of it is worse than saying no.

	if (manifest.version > BUNDLE_VERSION) {
		throw new Error(
			`This bundle was made by a newer version of Twine (bundle version ${manifest.version}; this copy understands up to ${BUNDLE_VERSION}). Update Twine to open it.`
		);
	}

	return {
		...manifest,
		format: BUNDLE_FORMAT,
		version: manifest.version,
		creator: manifest.creator ?? {name: 'unknown', version: ''},
		story: manifest.story ?? {id: '', ifid: '', name: ''},
		assets: Array.isArray(manifest.assets) ? manifest.assets : [],
		characters: Array.isArray(manifest.characters) ? manifest.characters : [],
		unresolved: Array.isArray(manifest.unresolved) ? manifest.unresolved : []
	};
}

/** JSON has no date type, so `lastUpdate` travelled as an ISO string. */
function reviveDate(value: unknown): Date {
	if (value instanceof Date) {
		return value;
	}

	if (typeof value === 'string' || typeof value === 'number') {
		const date = new Date(value);

		if (!Number.isNaN(date.getTime())) {
			return date;
		}
	}

	// A story with no readable timestamp still imports. It just looks freshly touched.
	return new Date();
}

/**
 * `story.json` is the `Story` object verbatim, so almost nothing needs doing to it — the
 * whole reason it rides along beside `story.html` is that `publishStory` drops the story
 * id, every passage id, `lastUpdate` and `snapToGrid` (spec 08).
 *
 * Returns undefined when the entry is missing or is not a story-shaped object, which sends
 * the caller to the HTML fallback.
 */
function readStoryJson(files: Unzipped): Story | undefined {
	const text = textEntry(files, STORY_JSON);

	if (text === undefined) {
		return undefined;
	}

	let parsed: unknown;

	try {
		parsed = JSON.parse(text);
	} catch {
		return undefined;
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return undefined;
	}

	const story = parsed as Story;

	if (!Array.isArray(story.passages)) {
		return undefined;
	}

	// `selected` and `highlighted` are editor state, not the story — they record whatever
	// the author had clicked when they hit export. Restoring them means an imported story
	// arrives pre-selected in the library with a scatter of passages lit up.
	return {
		...story,
		lastUpdate: reviveDate(story.lastUpdate),
		selected: false,
		passages: story.passages.map(passage => ({
			...passage,
			highlighted: false,
			selected: false
		}))
	};
}

/** `file` is a zip path, not library metadata. It must not reach the store. */
function assetMeta(entry: BundleAssetEntry): AssetMeta {
	const {file, ...meta} = entry;

	void file;
	return meta;
}

/**
 * Reads and validates a bundle without writing anything anywhere.
 *
 * Throws only when there is nothing importable in the file at all; everything survivable
 * comes back in `warnings`, phrased for a dialog.
 */
export async function readStoryBundle(file: Blob): Promise<BundleContents> {
	const files = await unzipAsync(new Uint8Array(await blobBytes(file)));
	const manifest = readManifest(files);
	const warnings: string[] = [];
	const stories: Story[] = [];
	const fromJson = readStoryJson(files);

	if (fromJson) {
		stories.push(fromJson);
	} else {
		const html = textEntry(files, STORY_HTML);

		if (html === undefined) {
			throw new Error(
				`This bundle contains no story — neither ${STORY_JSON} nor ${STORY_HTML} is inside it.`
			);
		}

		// The HTML is lossy by design: importStories mints fresh ids for the story and
		// every passage, so a bundle re-imported onto the machine it came from arrives as
		// a twin rather than as itself. Worth saying out loud.
		warnings.push(
			`This bundle's ${STORY_JSON} is missing or unreadable, so the story was rebuilt from ${STORY_HTML}. It will be imported as a new copy rather than as the original story.`
		);
		stories.push(...importStories(html));

		if (stories.length === 0) {
			throw new Error(
				`This bundle contains no story — its ${STORY_HTML} has nothing importable in it.`
			);
		}
	}

	const assets: BundleAsset[] = [];

	for (const entry of manifest.assets) {
		const bytes = files[entry.file];

		if (!bytes) {
			warnings.push(
				`The asset "${entry.name}" is listed in this bundle but its image data is missing, so it was skipped.`
			);
			continue;
		}

		// Re-hash rather than trust the manifest: the point is to catch a zip that was
		// mangled in transit. A mismatch is still importable art, though, and refusing the
		// whole bundle over one asset would be worse than warning — so warn.
		const hash = await contentHash(bytes);

		if (hash !== entry.hash) {
			warnings.push(
				`The image data for "${entry.name}" does not match what this bundle says it should be. It may have been altered or damaged; it was imported anyway.`
			);
		}

		assets.push({
			meta: assetMeta(entry),
			blob: new Blob([bytes], {type: entry.mime})
		});
	}

	const characters: Character[] = manifest.characters;

	return {manifest, stories, assets, characters, warnings};
}
