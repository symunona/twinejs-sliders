/**
 * The whole pipeline, end to end: `exportStoryBundle` -> `readStoryBundle` -> `planBundle`
 * -> `applyBundlePlan`, into a second, empty library.
 *
 * The other suites in this folder each test one half against a hand-built fixture, which is
 * exactly where a bundle can be self-consistently wrong: an exporter and an importer that
 * agree with their own fixtures but not with each other still lose the author's art. Nothing
 * here builds a zip by hand — the only input is a story and a library, and the only output
 * asserted on is the second library.
 */

import {
	BackedAssetStore,
	MemoryBackend,
	blobBytes,
	contentHash,
	defaultCharacter
} from '@sliders/asset-store';
import type {AssetId, AssetMeta, Character} from '@sliders/scene-types';
// Not re-exported from the package index -- fixtures are test-only.
import {
	gifBytes,
	jpegBytes,
	pngBytes,
	webpBytes
} from '../../../../packages/asset-store/src/test-fixtures';
import type {Passage, Story} from '../../../store/stories';
import type {AppInfo} from '../../app-info';
import {applyBundlePlan, planBundle} from '../apply-bundle';
import type {BundleContents, BundlePlan} from '../bundle.types';
import {collectAssetRefs} from '../collect-asset-refs';
import {exportStoryBundle} from '../export-bundle';
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

const appInfo: AppInfo = {name: 'Twine', version: '2.10.0'};

function newStore() {
	return new BackedAssetStore(new MemoryBackend());
}

function file(bytes: Uint8Array, name: string, type: string) {
	return new File([bytes], name, {type});
}

async function bytesOf(blob: Blob | undefined): Promise<number[]> {
	if (!blob) {
		throw new Error('Expected a blob.');
	}

	return Array.from(new Uint8Array(await blobBytes(blob)));
}

/**
 * Copies, not the store's own objects. `list()` hands back the live manifest entries and
 * `putCharacter` stamps `ownerCharacter`/`kind` onto them in place, so a snapshot of
 * references would compare equal to itself however badly a second import had mangled it.
 */
async function librarySnapshot(store: BackedAssetStore): Promise<AssetMeta[]> {
	return (await store.list({includeFrames: true})).map(meta => ({
		...meta,
		tags: [...meta.tags]
	}));
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
		// Not the default: a field that only survives because story.json carries it, so
		// asserting on the default value would prove nothing.
		snapToGrid: true,
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

const TAVERN = scenePassage(
	'Tavern',
	[
		'bg: tavern-night',
		'cast:',
		'  mira: {at: -0.4, frame: smile}',
		'fx: [{id: rain, amount: 1}]',
		'beats:',
		'  - mira: Evening.'
	].join('\n')
);

const CELLAR = scenePassage('Cellar', 'bg: tavern-night-edited');

const PROSE = passage('Prose', 'Just some Chapbook text, no scene block.');

function storyFixture(): Story {
	return fakeStory([TAVERN, CELLAR, PROSE]);
}

interface Seeded {
	bg: AssetId;
	character: Character;
	edited: AssetId;
	rain: AssetId;
	store: BackedAssetStore;
}

/**
 * A library with one of everything the manifest has a field for: tags, a `sourceAsset`
 * pointing at another bundled asset, an animated file, and a character whose geometry is
 * nothing like the defaults.
 */
async function seedSource(): Promise<Seeded> {
	const store = newStore();
	const bg = await store.put(
		file(webpBytes(640, 360), 'tavern.webp', 'image/webp'),
		{kind: 'bg', name: 'tavern-night', tags: ['interior', 'night']}
	);
	// `sourceAsset` is the asset editor's "revert to original" breadcrumb. It only survives
	// a round trip if the id it points at is remapped along with everything else.
	const edited = await store.put(
		file(jpegBytes(640, 360), 'tavern-edit.jpg', 'image/jpeg'),
		{
			kind: 'bg',
			name: 'tavern-night-edited',
			sourceAsset: bg,
			tags: ['interior']
		}
	);
	// Animated on purpose: "never flatten an animation" is load-bearing here (prepareUpload
	// stores animated files verbatim for exactly this reason), and an animation that came
	// back as a still would be a silent loss no field-count check would catch.
	const rain = await store.put(
		file(gifBytes({frames: 3}), 'rain.gif', 'image/gif'),
		{
			kind: 'fx',
			name: 'fx/rain',
			tags: ['weather']
		}
	);
	const character: Character = {
		...defaultCharacter('mira', 'Mira'),
		origin: {x: 0.42, y: 0.98},
		size: {w: 400, h: 900},
		tags: ['cast', 'chapter-one']
	};

	for (const [index, frameName] of ['idle', 'smile'].entries()) {
		const asset = await store.put(
			file(pngBytes(10 + index, 20), `mira-${frameName}.png`, 'image/png'),
			{kind: 'frame', name: `mira/${frameName}`, ownerCharacter: 'mira'}
		);

		// Anchors are per frame, and deliberately different between the two: a round trip
		// that flattened them back onto the character would still pass with one rig.
		character.frames[frameName] = {
			anchors: {
				bubble: {x: 0.5, y: index === 0 ? 0.12 : 0.17},
				mouth: {x: 0.48, y: 0.3}
			},
			asset,
			loop: index === 0
		};
	}

	// Never referenced by any passage -- a 40 MB library must not follow a two-passage story.
	await store.put(file(pngBytes(4, 4), 'unused.png', 'image/png'), {
		kind: 'bg',
		name: 'unused'
	});

	return {
		bg,
		character: await store.putCharacter(character),
		edited,
		rain,
		store
	};
}

interface RoundTrip {
	contents: BundleContents;
	plan: BundlePlan;
}

/** Export from one library and land the result in another. No hand-built zip anywhere. */
async function roundTrip(
	story: Story,
	source: BackedAssetStore,
	dest: BackedAssetStore
): Promise<RoundTrip> {
	const exported = await exportStoryBundle(story, source, appInfo);
	const contents = await readStoryBundle(exported.blob);
	const plan = await planBundle(dest, contents);

	await applyBundlePlan(dest, plan);

	return {contents, plan};
}

/** The names the fixture story is supposed to carry, in `list()` order. */
const BUNDLED_NAMES = [
	'fx/rain',
	'mira/idle',
	'mira/smile',
	'tavern-night',
	'tavern-night-edited'
];

describe('the fixture story references what this suite relies on', () => {
	// Guards against a vacuous suite: a fixture that stopped parsing would make every
	// assertion below an empty-vs-empty comparison and still pass.
	it('writes the refs the scanner is expected to find', () => {
		expect(collectAssetRefs(storyFixture())).toEqual({
			assetRefs: ['tavern-night', 'tavern-night-edited'],
			autoRefs: [],
			characterRefs: ['mira'],
			frameRefs: {mira: ['smile']},
			fxRefs: ['rain'],
			optionalAssetRefs: []
		});
	});

	it('seeds an animated asset and a non-default character', async () => {
		const {character, rain, store} = await seedSource();

		expect(await store.meta(rain)).toMatchObject({
			animated: true,
			mime: 'image/gif'
		});
		expect(character.size).toEqual({w: 400, h: 900});
		expect(Object.keys(character.frames).sort()).toEqual(['idle', 'smile']);
	});
});

describe('exportStoryBundle into readStoryBundle into applyBundlePlan', () => {
	it('carries every AssetMeta field and every byte into an empty library', async () => {
		const {store: source} = await seedSource();
		const dest = newStore();
		const {contents} = await roundTrip(storyFixture(), source, dest);

		expect(contents.warnings).toEqual([]);

		const before = await source.list({includeFrames: true});
		const after = await dest.list({includeFrames: true});

		expect(after.map(meta => meta.name)).toEqual(BUNDLED_NAMES);

		for (const meta of after) {
			const original = before.find(other => other.name === meta.name);

			expect(original).toBeDefined();
			// Covers id, name, kind, tags, w, h, animated, bytes, hash, mime,
			// ownerCharacter and sourceAsset in one go -- the destination was empty, so no
			// id had any reason to move.
			expect(meta).toEqual(original);
			expect(await bytesOf(await dest.get(meta.id))).toEqual(
				await bytesOf(await source.get(original!.id))
			);
		}
	});

	it('does not flatten an animation on the way through', async () => {
		const {store: source} = await seedSource();
		const dest = newStore();

		await roundTrip(storyFixture(), source, dest);

		const rain = (await dest.list({includeFrames: true})).find(
			meta => meta.name === 'fx/rain'
		);

		// Spelled out rather than left to the toEqual above, because a bundle that
		// re-encoded its images would still round-trip *some* consistent metadata.
		expect(rain).toMatchObject({
			animated: true,
			kind: 'fx',
			mime: 'image/gif',
			tags: ['weather']
		});
		expect(await bytesOf(await dest.get(rain!.id))).toEqual(
			Array.from(gifBytes({frames: 3}))
		);
	});

	it('keeps a sourceAsset pointing at the copy that travelled with it', async () => {
		const {store: source} = await seedSource();
		const dest = newStore();

		await roundTrip(storyFixture(), source, dest);

		const library = await dest.list({includeFrames: true});
		const original = library.find(meta => meta.name === 'tavern-night');
		const edited = library.find(meta => meta.name === 'tavern-night-edited');

		expect(edited?.sourceAsset).toBe(original?.id);
	});

	it('carries the character whole, with its frames repointed by name', async () => {
		const {character, store: source} = await seedSource();
		const dest = newStore();

		await roundTrip(storyFixture(), source, dest);

		const stored = await dest.getCharacter('mira');

		expect(stored).toBeDefined();
		expect(stored!.name).toBe('Mira');
		expect(stored!.size).toEqual({w: 400, h: 900});
		expect(stored!.origin).toEqual({x: 0.42, y: 0.98});
		expect(stored!.frames.idle.anchors).toEqual({
			bubble: {x: 0.5, y: 0.12},
			mouth: {x: 0.48, y: 0.3}
		});
		expect(stored!.frames.smile.anchors).toEqual({
			bubble: {x: 0.5, y: 0.17},
			mouth: {x: 0.48, y: 0.3}
		});
		expect(stored!.tags).toEqual(['cast', 'chapter-one']);
		expect(Object.keys(stored!.frames).sort()).toEqual(['idle', 'smile']);
		// `loop` is per-frame and easy to drop in a remap that rebuilds the object.
		expect(stored!.frames.idle.loop).toBe(true);
		expect(stored!.frames.smile.loop).toBe(false);

		const local = await dest.list({includeFrames: true});

		for (const [name, frame] of Object.entries(character.frames)) {
			const sourceMeta = await source.meta(frame.asset);
			const destMeta = local.find(meta => meta.name === sourceMeta!.name);

			// Derived from the name rather than assumed equal to the bundle id: the point is
			// that the frame points at whatever this library called the image.
			expect(stored!.frames[name].asset).toBe(destMeta!.id);
			expect(await bytesOf(await dest.get(stored!.frames[name].asset))).toEqual(
				await bytesOf(await source.get(frame.asset))
			);
		}
	});

	it('repoints frames when the destination already owns their ids', async () => {
		const {character, store: source} = await seedSource();
		const dest = newStore();
		const squatterIds = Object.values(character.frames).map(
			frame => frame.asset
		);

		// Unrelated local art that happens to hold the ids the bundle's frames want. Four
		// hex digits collide across libraries often enough that this is the normal case,
		// not an edge one.
		for (const [index, id] of squatterIds.entries()) {
			const bytes = pngBytes(50 + index, 60);

			await dest.importAsset(
				{
					animated: false,
					bytes: bytes.length,
					h: 60,
					hash: await contentHash(bytes),
					id,
					kind: 'bg',
					mime: 'image/png',
					name: `squatter-${index}`,
					tags: [],
					w: 50 + index
				},
				new Blob([bytes])
			);
		}

		await roundTrip(storyFixture(), source, dest);

		const stored = await dest.getCharacter('mira');

		for (const [index, id] of squatterIds.entries()) {
			// The local art kept its id, its name and its pixels.
			expect(await dest.meta(id)).toMatchObject({name: `squatter-${index}`});
			expect(await bytesOf(await dest.get(id))).toEqual(
				Array.from(pngBytes(50 + index, 60))
			);
		}

		for (const [name, frame] of Object.entries(character.frames)) {
			expect(stored!.frames[name].asset).not.toBe(frame.asset);
			expect(await bytesOf(await dest.get(stored!.frames[name].asset))).toEqual(
				await bytesOf(await source.get(frame.asset))
			);
		}
	});

	it('brings the story back with its ids, ifid, snapToGrid and lastUpdate', async () => {
		const {store: source} = await seedSource();
		const dest = newStore();
		const story = storyFixture();
		const {contents} = await roundTrip(story, source, dest);

		expect(contents.stories).toHaveLength(1);

		const [imported] = contents.stories;

		expect(imported.id).toBe(story.id);
		expect(imported.ifid).toBe(story.ifid);
		expect(imported.snapToGrid).toBe(true);
		expect(imported.startPassage).toBe(story.startPassage);
		expect(imported.passages.map(item => item.id)).toEqual(
			story.passages.map(item => item.id)
		);
		// JSON has no date type, so this only works because import revives it.
		expect(imported.lastUpdate).toBeInstanceOf(Date);
		expect(imported.lastUpdate).toEqual(story.lastUpdate);
		expect(imported.passages).toEqual(story.passages);
	});

	it('leaves the story text alone so its scene still names the art', async () => {
		const {bg, store: source} = await seedSource();
		const dest = newStore();
		const {contents} = await roundTrip(storyFixture(), source, dest);

		// The index `createNamedResolver` builds, exactly as it builds it. Whatever this
		// finds is what the passage preview draws.
		const byName = new Map(
			(await dest.list({includeFrames: true})).map(meta => [meta.name, meta])
		);
		const drawn = byName.get('tavern-night');

		expect(contents.stories[0].passages[0].text).toContain('bg: tavern-night');
		expect(drawn).toBeDefined();
		expect(await bytesOf(await dest.get(drawn!.id))).toEqual(
			await bytesOf(await source.get(bg))
		);
	});

	it('clears the editor state a story was exported with', async () => {
		const {store: source} = await seedSource();
		const dest = newStore();
		const story = storyFixture();
		// Whatever the author had clicked when they hit export. Restoring it means the
		// imported story arrives pre-selected with a scatter of passages lit up.
		const dirty: Story = {
			...story,
			passages: story.passages.map(item => ({
				...item,
				highlighted: true,
				selected: true
			})),
			selected: true
		};
		const {contents} = await roundTrip(dirty, source, dest);
		const [imported] = contents.stories;

		expect(imported.selected).toBe(false);
		expect(imported.passages.map(item => item.selected)).toEqual([
			false,
			false,
			false
		]);
		expect(imported.passages.map(item => item.highlighted)).toEqual([
			false,
			false,
			false
		]);
	});

	it('is a no-op when the same bundle is imported a second time', async () => {
		const {store: source} = await seedSource();
		const dest = newStore();

		await roundTrip(storyFixture(), source, dest);

		const library = await librarySnapshot(dest);
		const character = await dest.getCharacter('mira');

		expect(library).toHaveLength(BUNDLED_NAMES.length);

		let writes = 0;
		const write = dest.importAsset.bind(dest);

		dest.importAsset = (meta: AssetMeta, blob: Blob) => {
			writes++;
			return write(meta, blob);
		};

		const {plan} = await roundTrip(storyFixture(), source, dest);

		// Every asset is already here, byte for byte. If hash dedupe and id handling
		// disagreed anywhere, this is where the library would start growing a duplicate on
		// every import.
		expect(plan.assets.map(item => item.outcome)).toEqual(
			BUNDLED_NAMES.map(() => 'reused')
		);
		expect(writes).toBe(0);
		expect(await librarySnapshot(dest)).toEqual(library);
		expect(await dest.getCharacter('mira')).toEqual(character);
	});

	it('rolls back its own asset writes when the store fails partway', async () => {
		const {store: source} = await seedSource();
		const dest = newStore();
		const exported = await exportStoryBundle(storyFixture(), source, appInfo);
		const contents = await readStoryBundle(exported.blob);
		const plan = await planBundle(dest, contents);

		expect(
			plan.assets.filter(item => item.outcome === 'imported').length
		).toBeGreaterThan(1);

		let calls = 0;
		const write = dest.importAsset.bind(dest);

		dest.importAsset = (meta: AssetMeta, blob: Blob) => {
			calls++;

			if (calls === 2) {
				return Promise.reject(new Error('The disk is full.'));
			}

			return write(meta, blob);
		};

		await expect(applyBundlePlan(dest, plan)).rejects.toThrow(
			'The disk is full.'
		);

		// A half-applied import leaves frames owned by a character that never got written:
		// filtered out of the asset grid and unreachable from the character editor, so the
		// author can neither see them nor delete them.
		expect(await dest.list({includeFrames: true})).toEqual([]);
		expect(await dest.listCharacters()).toEqual([]);
	});
});
