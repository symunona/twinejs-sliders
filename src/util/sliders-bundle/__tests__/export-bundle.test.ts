import {
	BackedAssetStore,
	MemoryBackend,
	blobBytes,
	defaultCharacter
} from '@sliders/asset-store';
import type {Character} from '@sliders/scene-types';
import {strFromU8, unzipSync} from 'fflate';
// Not re-exported from the package index -- fixtures are test-only.
import {
	pngBytes,
	webpBytes
} from '../../../../packages/asset-store/src/test-fixtures';
import type {Passage, Story} from '../../../store/stories';
import type {AppInfo} from '../../app-info';
import {BundleManifest} from '../bundle.types';
import {collectAssetRefs} from '../collect-asset-refs';
import {
	assetExtension,
	buildBundleManifest,
	exportStoryBundle
} from '../export-bundle';
import {resolveBundleRefs} from '../resolve-refs';

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

const appInfo: AppInfo = {name: 'Twine', version: '2.10.0'};

function newStore() {
	return new BackedAssetStore(new MemoryBackend());
}

function file(bytes: Uint8Array, name: string, type: string) {
	return new File([bytes], name, {type});
}

function passage(name: string, text: string): Passage {
	return {
		height: 100,
		highlighted: false,
		id: `p-${name}`,
		left: 0,
		name,
		selected: false,
		story: 'story-id',
		tags: [],
		text,
		top: 0,
		width: 100
	};
}

function fakeStory(passages: Passage[]): Story {
	return {
		id: 'story-id',
		ifid: 'C0FFEE00-0000-4000-8000-000000000000',
		lastUpdate: new Date('2026-01-02T03:04:05.000Z'),
		name: 'Tavern',
		passages,
		script: '',
		selected: false,
		snapToGrid: false,
		startPassage: passages[0]?.id ?? '',
		storyFormat: 'Sliders',
		storyFormatVersion: '1.0.0',
		stylesheet: '',
		tagColors: {},
		tags: [],
		zoom: 1
	};
}

function scenePassage(name: string, block: string): Passage {
	return passage(name, `[scene]\nid: ${name.toLowerCase()}\n${block}`);
}

/** Reads a zip the way import will: entry name -> bytes. */
function entriesOf(bytes: Uint8Array) {
	return unzipSync(bytes);
}

async function zipBytes(blob: Blob) {
	// jsdom has no Blob.arrayBuffer, which is what blobBytes exists for.
	return new Uint8Array(await blobBytes(blob));
}

/** A character with `count` frames, all of them stored assets. */
async function putCharacter(
	store: BackedAssetStore,
	id: string,
	frameNames: string[]
): Promise<Character> {
	const character = defaultCharacter(id);

	for (const [index, frameName] of frameNames.entries()) {
		const asset = await store.put(
			file(pngBytes(10 + index, 20), `${id}-${frameName}.png`, 'image/png'),
			{kind: 'frame', name: `${id}/${frameName}`, ownerCharacter: id}
		);

		character.frames[frameName] = {asset};
	}

	return await store.putCharacter(character);
}

describe('assetExtension', () => {
	it('maps the mimes the library stores', () => {
		expect(assetExtension('image/webp')).toBe('.webp');
		expect(assetExtension('image/gif')).toBe('.gif');
		expect(assetExtension('image/png')).toBe('.png');
		expect(assetExtension('image/jpeg')).toBe('.jpg');
	});

	it('falls back to .bin rather than guessing', () => {
		expect(assetExtension('application/octet-stream')).toBe('.bin');
		expect(assetExtension('')).toBe('.bin');
	});

	it('ignores mime parameters', () => {
		expect(assetExtension('image/png; charset=binary')).toBe('.png');
	});
});

describe('resolveBundleRefs', () => {
	it('resolves a bg written by name', async () => {
		const store = newStore();
		const id = await store.put(file(webpBytes(), 'tavern.webp', 'image/webp'), {
			kind: 'bg',
			name: 'tavern-night'
		});
		const resolved = await resolveBundleRefs(store, {
			assetRefs: ['tavern-night'],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: []
		});

		expect(resolved.assets.map(meta => meta.id)).toEqual([id]);
		expect(resolved.unresolved).toEqual([]);
	});

	it('takes an implied bg when it exists and shrugs when it does not', async () => {
		const store = newStore();
		const id = await store.put(file(webpBytes(), 'tavern.webp', 'image/webp'), {
			kind: 'bg',
			name: 'tavern-night'
		});
		const resolved = await resolveBundleRefs(store, {
			assetRefs: [],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: [],
			optionalAssetRefs: ['tavern-night', 'signal-fire']
		});

		expect(resolved.assets.map(meta => meta.id)).toEqual([id]);
		// `signal-fire` is a scene id that names no art. The author never asked for a
		// backdrop there, so the export must not report one missing.
		expect(resolved.unresolved).toEqual([]);
	});

	it('resolves a bg written by id', async () => {
		const store = newStore();
		const id = await store.put(file(webpBytes(), 'tavern.webp', 'image/webp'), {
			kind: 'bg',
			name: 'tavern-night'
		});
		const resolved = await resolveBundleRefs(store, {
			assetRefs: [id],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: []
		});

		expect(resolved.assets.map(meta => meta.id)).toEqual([id]);
	});

	it('reports names the library does not have', async () => {
		const store = newStore();

		// Seeded on purpose. An empty result out of an empty library would also be what a
		// resolver that never finds anything returns -- the assertion only means something
		// when there was art here to find and none of it matched.
		await store.put(file(webpBytes(), 'tavern.webp', 'image/webp'), {
			kind: 'bg',
			name: 'tavern-night'
		});
		await store.put(file(pngBytes(2, 2), 'sparkle.png', 'image/png'), {
			kind: 'fx',
			name: 'fx/sparkles'
		});
		await putCharacter(store, 'joren', ['idle']);

		const resolved = await resolveBundleRefs(store, {
			assetRefs: ['tavern-nite', 'tavern-nite'],
			autoRefs: [],
			characterRefs: ['mira'],
			frameRefs: {},
			fxRefs: ['sparkle']
		});

		expect(resolved.assets).toEqual([]);
		expect(resolved.characters).toEqual([]);
		expect(resolved.unresolved).toEqual(['mira', 'sparkle', 'tavern-nite']);
	});

	// The store does not enforce unique names -- the asset editor only warns (904386e8) --
	// so two assets can sit under one. Whichever one the passage preview draws is the one
	// the bundle has to carry, or the author downloads art they have never seen.
	describe('two assets under one name', () => {
		/** The index `createNamedResolver` builds, built the way that file builds it. */
		async function previewIndex(store: BackedAssetStore) {
			const list = await store.list({includeFrames: true});

			return new Map(list.map(asset => [asset.name, asset]));
		}

		/**
		 * Two assets under one name, built the only way that is still possible:
		 * `putAsset` numbers a clashing name now, so the second one goes in through
		 * `importAsset` — the bundle path, which deliberately leaves naming to its caller.
		 * A library that predates the uniqueness rule holds exactly this shape, and the
		 * resolver still has to pick the one the preview draws.
		 */
		async function seedBothOrders(first: 'png' | 'webp') {
			const store = newStore();
			const blobs = {
				png: file(pngBytes(3, 3), 'a.png', 'image/png'),
				webp: file(webpBytes(), 'b.webp', 'image/webp')
			};
			const second = first === 'png' ? 'webp' : 'png';

			await store.put(blobs[first], {kind: 'bg', name: 'tavern-night'});

			const put = await store.putAsset(blobs[second], {
				kind: 'bg',
				name: 'tavern-night'
			});

			// The rule under test elsewhere, asserted here so this fixture cannot rot into
			// something that quietly stops producing a clash.
			expect(put.meta.name).toBe('tavern-night-2');
			// Re-filed under the contested name, then the numbered copy dropped.
			await store.importAsset({...put.meta, name: 'tavern-night'}, blobs[second]);
			await store.remove(put.id);

			return store;
		}

		it.each(['png', 'webp'] as const)(
			'bundles the one the preview would draw (%s uploaded first)',
			async first => {
				const store = await seedBothOrders(first);
				const clashing = (await store.list({includeFrames: true})).filter(
					meta => meta.name === 'tavern-night'
				);

				// Without this the whole case evaporates: `putAsset` dedupes by hash, so two
				// fixtures with the same bytes would leave one asset and nothing to pick.
				expect(clashing).toHaveLength(2);

				const drawn = (await previewIndex(store)).get('tavern-night');
				const resolved = await resolveBundleRefs(store, {
					assetRefs: ['tavern-night'],
					autoRefs: [],
					characterRefs: [],
					frameRefs: {},
					fxRefs: []
				});

				// Derived from the resolver, never hardcoded to "first" or "last": if
				// createNamedResolver ever changes its tie-break, export has to follow it
				// rather than keep shipping whatever used to be right.
				expect(drawn).toBeDefined();
				expect(resolved.assets.map(meta => meta.id)).toEqual([drawn!.id]);
			}
		);
	});

	describe('an autoRef, which could be either', () => {
		it('resolves as a character first', async () => {
			const store = newStore();

			await store.putCharacter({
				frames: {},
				id: 'mira',
				name: 'Mira',
				origin: {x: 0.5, y: 1},
				size: {w: 100, h: 200},
				tags: []
			});

			const resolved = await resolveBundleRefs(store, {
				assetRefs: [],
				autoRefs: ['mira'],
				characterRefs: [],
				frameRefs: {},
				fxRefs: []
			});

			expect(resolved.characters.map(one => one.id)).toEqual(['mira']);
			expect(resolved.unresolved).toEqual([]);
		});

		it('falls through to an asset when no character answers', async () => {
			const store = newStore();
			const id = await store.put(file(webpBytes(), 'lamp.webp', 'image/webp'), {
				kind: 'object',
				name: 'lamp'
			});
			const resolved = await resolveBundleRefs(store, {
				assetRefs: [],
				autoRefs: ['lamp'],
				characterRefs: [],
				frameRefs: {},
				fxRefs: []
			});

			expect(resolved.assets.map(meta => meta.id)).toEqual([id]);
			// Never "missing character lamp": only one of the two was ever going to hit.
			expect(resolved.unresolved).toEqual([]);
		});

		it('is unresolved only when BOTH lookups miss', async () => {
			const resolved = await resolveBundleRefs(newStore(), {
				assetRefs: [],
				autoRefs: ['ghost'],
				characterRefs: [],
				frameRefs: {},
				fxRefs: []
			});

			expect(resolved.unresolved).toEqual(['ghost']);
		});
	});

	it('matches an fx ref against the slug assetFragment writes', async () => {
		const store = newStore();
		const id = await store.put(file(webpBytes(), 'rain.webp', 'image/webp'), {
			kind: 'fx',
			name: 'fx/rain'
		});
		const resolved = await resolveBundleRefs(store, {
			assetRefs: [],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: ['rain']
		});

		expect(resolved.assets.map(meta => meta.id)).toEqual([id]);
		expect(resolved.unresolved).toEqual([]);
		expect(resolved.ambiguousFx).toEqual([]);
	});

	it('prefers an fx-kind asset when two names mangle alike, and says so', async () => {
		const store = newStore();

		await store.put(file(pngBytes(1, 1), 'a.png', 'image/png'), {
			kind: 'bg',
			name: 'weather/rain'
		});

		const fx = await store.put(file(webpBytes(), 'b.webp', 'image/webp'), {
			kind: 'fx',
			name: 'fx/rain'
		});
		const resolved = await resolveBundleRefs(store, {
			assetRefs: [],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: ['rain']
		});

		expect(resolved.assets.map(meta => meta.id)).toEqual([fx]);
		// Only one fx-kind candidate, so nothing was actually guessed at.
		expect(resolved.ambiguousFx).toEqual([]);
	});

	it('flags an fx ref that two fx assets both answer to', async () => {
		const store = newStore();

		await store.put(file(pngBytes(1, 1), 'a.png', 'image/png'), {
			kind: 'fx',
			name: 'storm/rain'
		});
		await store.put(file(webpBytes(), 'b.webp', 'image/webp'), {
			kind: 'fx',
			name: 'fx/rain'
		});

		const resolved = await resolveBundleRefs(store, {
			assetRefs: [],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: ['rain']
		});

		// First by name sort: `fx/rain` before `storm/rain`.
		expect(resolved.assets.map(meta => meta.name)).toEqual(['fx/rain']);
		expect(resolved.ambiguousFx).toEqual(['rain']);
		// Ambiguity is not a miss. The manifest must not claim the ref was lost.
		expect(resolved.unresolved).toEqual([]);
	});

	it('does not answer an fx ref with a character frame', async () => {
		const store = newStore();

		await putCharacter(store, 'mira', ['rain']);

		// The only thing in the library that mangles to `rain` is a frame, and there is no
		// fx asset at all -- so anything found here was found by slug coincidence.
		expect(
			(await store.list({includeFrames: true})).map(meta => meta.name)
		).toEqual(['mira/rain']);

		const resolved = await resolveBundleRefs(store, {
			assetRefs: [],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: ['rain']
		});

		// A frame is only ever addressed through its character (`mira: {frame: rain}`), so
		// bundling one for an `fx:` ref ships an asset owned by a character that is not in
		// the bundle: filtered out of the asset grid, unreachable from the character editor.
		expect(resolved.assets).toEqual([]);
		expect(resolved.characters).toEqual([]);
		expect(resolved.unresolved).toEqual(['rain']);
		expect(resolved.ambiguousFx).toEqual([]);
	});

	it('drags a character along when one of its frames is named on its own', async () => {
		const store = newStore();
		const character = await putCharacter(store, 'mira', ['idle', 'smile']);
		const resolved = await resolveBundleRefs(store, {
			// A `bg:` may legitimately name a frame by its full name, and then the frame
			// travels without anything having asked for its character.
			assetRefs: ['mira/smile'],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: []
		});

		// Without the owner, the frame lands in the destination owned by a character that
		// is not there -- invisible in the grid and unopenable in the character editor.
		expect(resolved.characters).toEqual([character]);
		expect(resolved.assets.map(meta => meta.name).sort()).toEqual([
			'mira/idle',
			'mira/smile'
		]);
		expect(resolved.unresolved).toEqual([]);
	});

	it('carries an ambiguous fx ref through to the export report', async () => {
		const store = newStore();

		await store.put(file(pngBytes(1, 1), 'a.png', 'image/png'), {
			kind: 'fx',
			name: 'storm/rain'
		});
		await store.put(file(webpBytes(), 'b.webp', 'image/webp'), {
			kind: 'fx',
			name: 'fx/rain'
		});

		const story = fakeStory([
			scenePassage('Storm', 'fx: [{id: rain, amount: 1}]')
		]);
		const bundle = await exportStoryBundle(story, store, appInfo);

		// Only the author knows which `rain` they meant, so the pre-download card has to
		// be able to say one was picked for them.
		expect(bundle.report.ambiguousFx).toEqual(['rain']);
		expect(bundle.report.unresolved).toEqual([]);
	});

	it('pulls every frame of a referenced character, not just the named ones', async () => {
		const store = newStore();
		const character = await putCharacter(store, 'mira', [
			'idle',
			'smile',
			'angry'
		]);
		const resolved = await resolveBundleRefs(store, {
			assetRefs: [],
			autoRefs: [],
			characterRefs: ['mira'],
			frameRefs: {mira: ['smile']},
			fxRefs: []
		});

		expect(resolved.characters).toEqual([character]);
		expect(resolved.assets.map(meta => meta.name).sort()).toEqual([
			'mira/angry',
			'mira/idle',
			'mira/smile'
		]);
	});

	it('reports a frame the referenced character does not have', async () => {
		const store = newStore();

		await putCharacter(store, 'mira', ['idle']);

		const resolved = await resolveBundleRefs(store, {
			assetRefs: [],
			autoRefs: [],
			characterRefs: ['mira'],
			frameRefs: {mira: ['idle', 'smirk'], candle: ['lit']},
			fxRefs: []
		});

		// `candle` is not a resolved character, so its frame is not guessed at.
		expect(resolved.unresolved).toEqual(['mira/smirk']);
	});

	it('reports a character named but not addressable by id as unresolved', async () => {
		const store = newStore();

		await store.putCharacter({...defaultCharacter('c_01'), name: 'mira'});

		const resolved = await resolveBundleRefs(store, {
			assetRefs: [],
			autoRefs: [],
			characterRefs: ['mira'],
			frameRefs: {},
			fxRefs: []
		});

		// `cast: mira` reaches nothing at render time either — `store.character` and
		// `createNamedResolver.character` are both id-keyed. Bundling `c_01` on a name match
		// would ship a character no scene in the bundle can address, and tell the author
		// their story was fine while it renders nothing.
		expect(resolved.characters).toEqual([]);
		expect(resolved.unresolved).toEqual(['mira']);
	});

	it('dedupes assets reached by two different refs', async () => {
		const store = newStore();
		const id = await store.put(file(webpBytes(), 'tavern.webp', 'image/webp'), {
			kind: 'bg',
			name: 'tavern-night'
		});
		const resolved = await resolveBundleRefs(store, {
			assetRefs: ['tavern-night', id],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: []
		});

		expect(resolved.assets).toHaveLength(1);
	});
});

describe('buildBundleManifest', () => {
	it('names a file for every asset and sorts unresolved', () => {
		const manifest = buildBundleManifest(
			fakeStory([]),
			[
				{
					animated: false,
					bytes: 10,
					h: 2,
					hash: 'abc',
					id: 'a_0001',
					kind: 'bg',
					mime: 'image/webp',
					name: 'tavern-night',
					tags: [],
					w: 1
				}
			],
			[],
			['zed', 'alpha', 'zed'],
			appInfo
		);

		expect(manifest.format).toBe('sliders-bundle');
		expect(manifest.version).toBe(1);
		expect(manifest.creator).toEqual({name: 'Twine', version: '2.10.0'});
		expect(manifest.story).toEqual({
			id: 'story-id',
			ifid: 'C0FFEE00-0000-4000-8000-000000000000',
			name: 'Tavern'
		});
		expect(manifest.assets[0].file).toBe('assets/a_0001.webp');
		expect(manifest.assets[0].name).toBe('tavern-night');
		expect(manifest.unresolved).toEqual(['alpha', 'zed']);
	});
});

describe('exportStoryBundle', () => {
	async function seeded() {
		const backend = new MemoryBackend();
		const store = new BackedAssetStore(backend);
		const bg = await store.put(file(webpBytes(), 'tavern.webp', 'image/webp'), {
			kind: 'bg',
			name: 'tavern-night'
		});

		await putCharacter(store, 'mira', ['idle', 'smile', 'angry']);
		await store.put(file(webpBytes(300, 300), 'rain.webp', 'image/webp'), {
			kind: 'fx',
			name: 'fx/rain'
		});
		// Never referenced -- a 40 MB library must not follow a two-passage story.
		await store.put(file(pngBytes(4, 4), 'unused.png', 'image/png'), {
			kind: 'bg',
			name: 'unused'
		});

		const story = fakeStory([
			scenePassage(
				'Tavern',
				[
					'bg: tavern-night',
					'cast:',
					'  mira: {at: -0.4, frame: smile}',
					'fx: [{id: rain, amount: 1}]',
					'beats:',
					'  - mira: Evening.'
				].join('\n')
			),
			passage('Prose', 'Just some Chapbook text, no scene block.')
		]);

		return {backend, bg, store, story};
	}

	it('carries the referenced bg into the zip', async () => {
		const {bg, store, story} = await seeded();
		const bundle = await exportStoryBundle(story, store, appInfo);
		const entries = entriesOf(await zipBytes(bundle.blob));

		expect(Object.keys(entries)).toContain(`assets/${bg}.webp`);
		expect(bundle.blob.type).toBe('application/zip');
		expect(bundle.filename).toBe('Tavern.sliders.zip');
		expect(bundle.report.bytes).toBe(bundle.blob.size);
	});

	it('contains exactly the entries the manifest promises', async () => {
		const {store, story} = await seeded();
		const bundle = await exportStoryBundle(story, store, appInfo);
		const entries = entriesOf(await zipBytes(bundle.blob));
		const manifest = JSON.parse(
			strFromU8(entries['sliders.json'])
		) as BundleManifest;
		const assetFiles = manifest.assets.map(asset => asset.file);

		expect(Object.keys(entries).sort()).toEqual(
			['sliders.json', 'story.html', 'story.json', ...assetFiles].sort()
		);

		for (const path of assetFiles) {
			expect(entries[path].length).toBeGreaterThan(0);
		}

		// bg + fx + three of Mira's frames. The unused asset stayed home.
		expect(manifest.assets).toHaveLength(5);
		expect(manifest.characters.map(character => character.id)).toEqual([
			'mira'
		]);
		expect(bundle.report).toEqual({
			ambiguousFx: [],
			assetCount: 5,
			bytes: bundle.blob.size,
			characterCount: 1,
			unresolved: []
		});
	});

	it('round-trips the passages through story.json', async () => {
		const {store, story} = await seeded();
		const bundle = await exportStoryBundle(story, store, appInfo);
		const entries = entriesOf(await zipBytes(bundle.blob));
		const parsed = JSON.parse(strFromU8(entries['story.json'])) as Omit<
			Story,
			'lastUpdate'
		> & {lastUpdate: string};

		expect(parsed.id).toBe(story.id);
		expect(parsed.ifid).toBe(story.ifid);
		expect(parsed.passages).toEqual(story.passages);
		// Dates survive as ISO strings; import revives them.
		expect(parsed.lastUpdate).toBe('2026-01-02T03:04:05.000Z');
		expect(new Date(parsed.lastUpdate)).toEqual(story.lastUpdate);
	});

	it('writes a story.html that vanilla Twine can read', async () => {
		const {store, story} = await seeded();
		const bundle = await exportStoryBundle(story, store, appInfo);
		const entries = entriesOf(await zipBytes(bundle.blob));
		const html = strFromU8(entries['story.html']);

		expect(html).toContain('<tw-storydata name="Tavern"');
		expect(html).toContain('<tw-passagedata');
	});

	it('exports a story with no start passage rather than throwing', async () => {
		const {store, story} = await seeded();
		const bundle = await exportStoryBundle(
			{...story, startPassage: ''},
			store,
			appInfo
		);

		expect(bundle.blob.size).toBeGreaterThan(0);
	});

	it('reports unresolved names without failing the export', async () => {
		const store = newStore();
		const story = fakeStory([
			scenePassage(
				'Tavern',
				['bg: tavern-nite', 'cast:', '  mira: {at: 0}'].join('\n')
			)
		]);
		const bundle = await exportStoryBundle(story, store, appInfo);
		const entries = entriesOf(await zipBytes(bundle.blob));
		const manifest = JSON.parse(
			strFromU8(entries['sliders.json'])
		) as BundleManifest;

		expect(manifest.unresolved).toEqual(['mira', 'tavern-nite']);
		expect(manifest.assets).toEqual([]);
		expect(bundle.report.unresolved).toEqual(['mira', 'tavern-nite']);
		expect(Object.keys(entries).sort()).toEqual([
			'sliders.json',
			'story.html',
			'story.json'
		]);
	});

	it('reports an asset whose bytes are gone instead of promising a missing entry', async () => {
		const {backend, bg, store, story} = await seeded();

		// Behind the store's back: the manifest still lists the asset, the blob is gone.
		await backend.deleteBlob(bg);

		const bundle = await exportStoryBundle(story, store, appInfo);
		const entries = entriesOf(await zipBytes(bundle.blob));
		const manifest = JSON.parse(
			strFromU8(entries['sliders.json'])
		) as BundleManifest;

		expect(Object.keys(entries)).not.toContain(`assets/${bg}.webp`);
		expect(manifest.assets.map(asset => asset.id)).not.toContain(bg);
		expect(bundle.report.assetCount).toBe(4);
		expect(bundle.report.unresolved).toEqual(['tavern-night']);
	});

	it('collects the same refs the scanner sees', async () => {
		const {story} = await seeded();

		expect(collectAssetRefs(story)).toEqual({
			assetRefs: ['tavern-night'],
			autoRefs: [],
			characterRefs: ['mira'],
			frameRefs: {mira: ['smile']},
			fxRefs: ['rain'],
			optionalAssetRefs: []
		});
	});
});
