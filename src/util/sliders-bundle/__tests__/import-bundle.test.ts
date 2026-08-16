import {strToU8, zipSync} from 'fflate';
import type {Zippable} from 'fflate';
import {blobBytes, contentHash} from '@sliders/asset-store';
import {
	pngBytes,
	webpBytes
} from '../../../../packages/asset-store/src/test-fixtures';
import type {Character} from '@sliders/scene-types';
import {BUNDLE_FORMAT, BUNDLE_VERSION} from '../bundle.types';
import type {BundleAssetEntry, BundleManifest} from '../bundle.types';
import {readStoryBundle} from '../import-bundle';

// jsdom ships getRandomValues but not SubtleCrypto.
beforeAll(() => {
	if (!globalThis.crypto?.subtle) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const {webcrypto} = require('crypto');

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		});
	}
});

function bundleBlob(files: Record<string, Uint8Array | string>): Blob {
	const entries: Zippable = {};

	for (const [name, data] of Object.entries(files)) {
		entries[name] = typeof data === 'string' ? strToU8(data) : data;
	}

	return new Blob([zipSync(entries)]);
}

async function assetEntry(
	bytes: Uint8Array,
	overrides: Partial<BundleAssetEntry> = {}
): Promise<BundleAssetEntry> {
	return {
		id: 'a_8f21',
		name: 'tavern/night',
		kind: 'bg',
		tags: ['interior'],
		animated: false,
		w: 640,
		h: 360,
		bytes: bytes.length,
		hash: await contentHash(bytes),
		mime: 'image/webp',
		file: 'assets/a_8f21.webp',
		...overrides
	};
}

function manifest(overrides: Partial<BundleManifest> = {}): BundleManifest {
	return {
		format: BUNDLE_FORMAT,
		version: BUNDLE_VERSION,
		creator: {name: 'Twine', version: '2.10.0'},
		story: {id: 's_1', ifid: 'IFID', name: 'Tavern'},
		assets: [],
		characters: [],
		unresolved: [],
		...overrides
	};
}

const storyJson = JSON.stringify({
	id: 's_1',
	ifid: 'IFID',
	name: 'Tavern',
	lastUpdate: '2024-03-04T05:06:07.000Z',
	passages: [
		{id: 'p_1', name: 'Start', text: '[scene]\nbg: tavern-night\n[/scene]'}
	],
	script: '',
	selected: false,
	snapToGrid: true,
	startPassage: 'p_1',
	storyFormat: 'Sliders',
	storyFormatVersion: '1.0.0',
	stylesheet: '',
	tags: [],
	tagColors: {},
	zoom: 1
});

const storyHtml = `<tw-storydata name="Tavern HTML" startnode="1" ifid="HTML-IFID" format="Sliders" format-version="1.0.0"><tw-passagedata pid="1" name="Start" position="10,20">hello</tw-passagedata></tw-storydata>`;

async function bytesOf(blob: Blob): Promise<Uint8Array> {
	return new Uint8Array(await blobBytes(blob));
}

describe('readStoryBundle', () => {
	it('reads a valid bundle', async () => {
		const art = webpBytes();
		const character: Character = {
			id: 'mira',
			name: 'Mira',
			size: {w: 512, h: 1024},
			origin: {x: 0.5, y: 1},
			frames: {happy: {anchors: {bubble: {x: 0.5, y: 0.15}}, asset: 'a_0001'}},
			tags: []
		};
		const entry = await assetEntry(art);
		const contents = await readStoryBundle(
			bundleBlob({
				'sliders.json': JSON.stringify(
					manifest({
						assets: [entry],
						characters: [character],
						unresolved: ['mira']
					})
				),
				'story.json': storyJson,
				'assets/a_8f21.webp': art
			})
		);

		expect(contents.warnings).toEqual([]);
		expect(contents.manifest.unresolved).toEqual(['mira']);
		expect(contents.characters).toEqual([character]);
		expect(contents.stories).toHaveLength(1);
		expect(contents.stories[0].name).toBe('Tavern');
		expect(contents.stories[0].passages).toHaveLength(1);
		expect(contents.assets).toHaveLength(1);
		// The whole AssetMeta, not a spot check. Import restores identity from the manifest
		// instead of re-deriving it (spec 08), so anything quietly dropped here -- tags,
		// kind, the dimensions -- is gone from the destination library for good.
		const {file: zipPath, ...expected} = entry;

		void zipPath;
		expect(contents.assets[0].meta).toEqual(expected);
		expect(contents.assets[0].meta.tags).toEqual(['interior']);
		expect(contents.assets[0].blob.type).toBe('image/webp');
		expect(Array.from(await bytesOf(contents.assets[0].blob))).toEqual(
			Array.from(art)
		);
	});

	it('strips the zip path off asset metadata', async () => {
		const art = webpBytes();
		const contents = await readStoryBundle(
			bundleBlob({
				'sliders.json': JSON.stringify(
					manifest({assets: [await assetEntry(art)]})
				),
				'story.json': storyJson,
				'assets/a_8f21.webp': art
			})
		);

		expect('file' in contents.assets[0].meta).toBe(false);
	});

	it('revives lastUpdate as a Date', async () => {
		const contents = await readStoryBundle(
			bundleBlob({
				'sliders.json': JSON.stringify(manifest()),
				'story.json': storyJson
			})
		);

		expect(contents.stories[0].lastUpdate).toBeInstanceOf(Date);
		expect(contents.stories[0].lastUpdate.toISOString()).toBe(
			'2024-03-04T05:06:07.000Z'
		);
	});

	it('rejects a zip with no sliders.json', async () => {
		await expect(
			readStoryBundle(bundleBlob({'story.json': storyJson}))
		).rejects.toThrow(/sliders\.json/);
	});

	it('rejects a manifest with the wrong format', async () => {
		await expect(
			readStoryBundle(
				bundleBlob({
					'sliders.json': JSON.stringify({
						...manifest(),
						format: 'twine-archive'
					}),
					'story.json': storyJson
				})
			)
		).rejects.toThrow(/not a Sliders bundle/);
	});

	it('rejects a bundle from a future version', async () => {
		await expect(
			readStoryBundle(
				bundleBlob({
					'sliders.json': JSON.stringify(
						manifest({version: BUNDLE_VERSION + 1})
					),
					'story.json': storyJson
				})
			)
		).rejects.toThrow(/newer version of Twine/);
	});

	it('accepts a bundle from an older version', async () => {
		const contents = await readStoryBundle(
			bundleBlob({
				'sliders.json': JSON.stringify(manifest({version: BUNDLE_VERSION - 1})),
				'story.json': storyJson
			})
		);

		expect(contents.stories[0].name).toBe('Tavern');
	});

	it('falls back to story.html when story.json is missing', async () => {
		const contents = await readStoryBundle(
			bundleBlob({
				'sliders.json': JSON.stringify(manifest()),
				'story.html': storyHtml
			})
		);

		expect(contents.stories).toHaveLength(1);
		expect(contents.stories[0].name).toBe('Tavern HTML');
		expect(contents.warnings).toHaveLength(1);
		expect(contents.warnings[0]).toMatch(/story\.html/);
	});

	it('falls back to story.html when story.json is unparseable', async () => {
		const contents = await readStoryBundle(
			bundleBlob({
				'sliders.json': JSON.stringify(manifest()),
				'story.json': '{not json at all',
				'story.html': storyHtml
			})
		);

		expect(contents.stories[0].name).toBe('Tavern HTML');
		expect(contents.warnings).toHaveLength(1);
	});

	it('rejects a bundle with neither story.json nor story.html', async () => {
		await expect(
			readStoryBundle(bundleBlob({'sliders.json': JSON.stringify(manifest())}))
		).rejects.toThrow(/contains no story/);
	});

	it('warns but still imports an asset whose bytes do not match its hash', async () => {
		const art = pngBytes();
		const entry = await assetEntry(art, {
			mime: 'image/png',
			file: 'assets/a_8f21.png'
		});
		const contents = await readStoryBundle(
			bundleBlob({
				'sliders.json': JSON.stringify(manifest({assets: [entry]})),
				'story.json': storyJson,
				// Different bytes than the hash in the manifest describes.
				'assets/a_8f21.png': webpBytes()
			})
		);

		expect(contents.warnings).toHaveLength(1);
		expect(contents.warnings[0]).toMatch(/tavern\/night/);
		expect(contents.assets).toHaveLength(1);
		expect(Array.from(await bytesOf(contents.assets[0].blob))).toEqual(
			Array.from(webpBytes())
		);
	});

	it('warns and skips a manifest entry whose bytes are missing', async () => {
		const art = webpBytes();
		const present = await assetEntry(art);
		const absent = await assetEntry(art, {
			id: 'a_0002',
			name: 'tavern/day',
			file: 'assets/a_0002.webp'
		});
		const contents = await readStoryBundle(
			bundleBlob({
				'sliders.json': JSON.stringify(manifest({assets: [present, absent]})),
				'story.json': storyJson,
				'assets/a_8f21.webp': art
			})
		);

		expect(contents.assets.map(asset => asset.meta.id)).toEqual(['a_8f21']);
		expect(contents.warnings).toHaveLength(1);
		expect(contents.warnings[0]).toMatch(/tavern\/day/);
	});

	it('rejects a file that is not a zip at all', async () => {
		await expect(
			readStoryBundle(new Blob(['this is just some text']))
		).rejects.toThrow(/zip archive/);
	});
});
