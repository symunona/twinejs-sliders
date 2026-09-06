/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {BackedAssetStore, MemoryBackend} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {fakePassage, fakeStory} from '../../../test-util/fakes';
import type {Story} from '../../../store/stories';
import {resolveSyncedRefs} from '../use-synced-refs';

/**
 * The badge is only worth showing if it agrees with what a push actually does, so these
 * pin the agreement rather than the rendering: `resolveSyncedRefs` must return exactly the
 * set `syncStoryAssets` would upload. Every case here is one where a naive "is this name
 * written in the YAML" check would give the wrong answer.
 */

function newStore() {
	return new BackedAssetStore(new MemoryBackend(), 'story-1');
}

function meta(overrides: Partial<AssetMeta> = {}): AssetMeta {
	return {
		animated: false,
		bytes: 10,
		h: 100,
		hash: 'hash',
		id: 'a_0001',
		kind: 'bg',
		mime: 'image/png',
		name: 'tavern/night',
		tags: [],
		w: 100,
		...overrides
	};
}

function character(overrides: Partial<Character> = {}): Character {
	return {
		frames: {},
		id: 'mira',
		name: 'Mira Vale',
		origin: {x: 0.5, y: 1},
		size: {w: 1, h: 2},
		tags: [],
		...overrides
	};
}

/** A story whose single passage carries the given `[scene]` body. */
function storyWithScene(sceneText: string): Story {
	const story = fakeStory(1);

	return {
		...story,
		passages: [
			{
				...fakePassage(),
				story: story.id,
				text: `[scene]\n${sceneText}\n`
			}
		]
	};
}

async function seed(
	store: BackedAssetStore,
	assets: AssetMeta[],
	characters: Character[] = []
) {
	for (const asset of assets) {
		await store.importAsset(asset, new Blob(['x']));
	}

	for (const entry of characters) {
		await store.putCharacter(entry);
	}
}

describe('resolveSyncedRefs()', () => {
	it('returns an asset a scene names as its background', async () => {
		const store = newStore();

		await seed(store, [meta()]);

		const {assets} = await resolveSyncedRefs(
			store,
			storyWithScene('bg: tavern/night')
		);

		expect(assets.map(found => found.id)).toEqual(['a_0001']);
	});

	it('leaves out an asset no scene names', async () => {
		const store = newStore();

		await seed(store, [
			meta(),
			meta({id: 'a_0002', kind: 'object', name: 'props/candle'})
		]);

		const {assets} = await resolveSyncedRefs(
			store,
			storyWithScene('bg: tavern/night')
		);

		expect(assets.map(found => found.id)).toEqual(['a_0001']);
	});

	it('returns nothing for a story with no scene blocks', async () => {
		const store = newStore();

		await seed(store, [meta()]);

		const story = fakeStory(1);
		const {assets, characters} = await resolveSyncedRefs(store, {
			...story,
			passages: [{...fakePassage(), story: story.id, text: 'Just prose.'}]
		});

		expect(assets).toEqual([]);
		expect(characters).toEqual([]);
	});

	/**
	 * The case the badge exists for. A character is cast by ID, and casting it drags every
	 * frame along — including frames no scene mentions. Marking those frames "unused"
	 * because their names are absent from the YAML would be a lie.
	 */
	it('returns a cast character and all of its frames, named or not', async () => {
		const store = newStore();

		await seed(
			store,
			[
				meta({id: 'a_idle', kind: 'frame', name: 'mira/idle'}),
				meta({id: 'a_wave', kind: 'frame', name: 'mira/wave'})
			],
			[
				character({
					frames: {idle: {asset: 'a_idle'}, wave: {asset: 'a_wave'}}
				})
			]
		);

		const {assets, characters} = await resolveSyncedRefs(
			store,
			storyWithScene('cast:\n  mira: {at: 0, frame: idle}')
		);

		expect(characters.map(found => found.id)).toEqual(['mira']);
		expect(assets.map(found => found.id).sort()).toEqual(['a_idle', 'a_wave']);
	});

	it('leaves out a character no scene casts', async () => {
		const store = newStore();

		await seed(
			store,
			[meta({id: 'a_idle', kind: 'frame', name: 'mira/idle'})],
			[character({frames: {idle: {asset: 'a_idle'}}})]
		);

		const {assets, characters} = await resolveSyncedRefs(
			store,
			storyWithScene('bg: nothing-here')
		);

		expect(characters).toEqual([]);
		expect(assets).toEqual([]);
	});

	/**
	 * `fx: [rain]` is written as a slug, and the asset is named `fx/rain`. A name-equality
	 * check would call this one unused.
	 */
	it('matches an fx ref through its mangled key', async () => {
		const store = newStore();

		await seed(store, [meta({id: 'a_rain', kind: 'fx', name: 'fx/rain'})]);

		const {assets} = await resolveSyncedRefs(
			store,
			storyWithScene('fx: [rain]')
		);

		expect(assets.map(found => found.id)).toEqual(['a_rain']);
	});

	it('matches an asset a scene addresses by id rather than name', async () => {
		const store = newStore();

		await seed(store, [meta()]);

		const {assets} = await resolveSyncedRefs(
			store,
			storyWithScene('bg: a_0001')
		);

		expect(assets.map(found => found.id)).toEqual(['a_0001']);
	});

	it('unions the refs of every passage', async () => {
		const store = newStore();

		await seed(store, [
			meta(),
			meta({id: 'a_0002', kind: 'bg', name: 'road/dawn'})
		]);

		const story = fakeStory(1);
		const {assets} = await resolveSyncedRefs(store, {
			...story,
			passages: [
				{...fakePassage(), story: story.id, text: '[scene]\nbg: tavern/night\n'},
				{...fakePassage(), story: story.id, text: '[scene]\nbg: road/dawn\n'}
			]
		});

		expect(assets.map(found => found.id).sort()).toEqual(['a_0001', 'a_0002']);
	});
});
