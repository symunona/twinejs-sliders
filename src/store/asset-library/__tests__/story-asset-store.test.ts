/**
 * @jest-environment node
 */
/**
 * The per-story AssetStore facade over the shared library engine. Real engines, real
 * HttpTransport, one FakeLibServer (packages/asset-library/src/testing).
 */
import {blobBytes, defaultCharacter} from '@sliders/asset-store';
import type {Character, ImageEdits} from '@sliders/scene-types';
import {png} from '../../../../packages/asset-library/src/testing/fixtures';
import {
	Browser,
	World
} from '../../../../packages/asset-library/src/testing/world';
import {
	applyBundlePlan,
	exportStoryBundle,
	planBundle,
	readStoryBundle
} from '../../../util/sliders-bundle';
import type {Passage, Story} from '../../stories';
import {
	LibraryAssetStore,
	SharedAssetError,
	isSharedAssetError
} from '../story-asset-store';

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

function file(colour: Parameters<typeof png>[0], name = 'pic.png', w = 4) {
	return new File([png(colour, w, 4)], name, {type: 'image/png'});
}

function facade(browser: Browser, storyId: string) {
	return new LibraryAssetStore(storyId, async () => browser.engine);
}

async function bytes(blob: Blob | undefined): Promise<number[]> {
	return Array.from(new Uint8Array(await blobBytes(blob!)));
}

describe('putAsset', () => {
	it('numbers a name clash and dedupes exact hash + kind + owner in the view', async () => {
		const [, ana] = await World.create(['ana']);
		const store = facade(ana, 'S1');

		const first = await store.putAsset(file('red', 'tavern.png'), {kind: 'bg'});
		const again = await store.putAsset(file('red', 'tavern.png'), {kind: 'bg'});
		const other = await store.putAsset(file('blue', 'tavern.png'), {kind: 'bg'});
		const asObject = await store.putAsset(file('red', 'tavern.png'), {
			kind: 'object'
		});
		const forced = await store.putAsset(file('red', 'tavern.png'), {
			allowDuplicate: true,
			kind: 'bg'
		});

		expect(first.duplicate).toBe(false);
		expect(first.meta.name).toBe('tavern');
		expect(again).toMatchObject({duplicate: true, id: first.id});
		expect(other.meta.name).toBe('tavern-2');
		expect(asObject.duplicate).toBe(false);
		expect(forced.duplicate).toBe(false);
		expect(forced.meta.name).toBe('tavern-4');
		expect((await store.list()).map(meta => meta.name)).toEqual([
			'tavern',
			'tavern-2',
			'tavern-3',
			'tavern-4'
		]);
		// Own collection + binding came into being on the first write.
		expect(ana.engine.binding('S1')).toBeDefined();
		expect(first.meta.own).toBe(true);
		expect(await bytes(await store.get(first.id))).toEqual(
			Array.from(png('red', 4, 4))
		);
	});

	it('numbers against names attached collections hold too', async () => {
		const [world, ana] = await World.create(['ana']);
		const store = facade(ana, 'S1');
		const shared = ana.engine.createCollection({name: 'tavern-set'});

		await ana.engine.addAsset(png('green'), 'image/png', {
			collection: shared.id,
			name: 'night'
		});
		await store.ownCollection();
		ana.engine.bind('S1', [shared.id]);
		await world.settle();

		const result = await store.putAsset(file('red', 'night.png'));

		expect(result.meta.name).toBe('night-2');
	});
});

async function twoStories() {
	const [world, ana, bo] = await World.create(['ana', 'bo']);
	const tavern = ana.engine.createCollection({name: 'tavern-set'});
	const {asset: night} = await ana.engine.addAsset(png('green'), 'image/png', {
		collection: tavern.id,
		kind: 'bg',
		name: 'night'
	});
	const s1 = facade(ana, 'S1');
	const s2 = facade(bo, 'S2');

	await s1.ownCollection();
	ana.engine.bind('S1', [tavern.id]);
	await world.settle();
	await s2.ownCollection();
	bo.engine.bind('S2', [tavern.id]);
	bo.engine.setRefs('S2', [night!.id]);
	await world.settle();

	return {ana, bo, night: night!, s1, s2, tavern, world};
}

describe('shared assets', () => {
	it('replace without a scope throws SharedAssetError with usage', async () => {
		const {night, s1} = await twoStories();
		let caught: unknown;

		try {
			await s1.replace(night.id, file('red', 'night.png'));
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(SharedAssetError);
		expect(isSharedAssetError(caught)).toBe(true);

		const info = (caught as SharedAssetError).info;

		expect(info).toMatchObject({
			canFork: true,
			canUpdateAll: true,
			collection: {name: 'tavern-set'},
			foreign: true,
			kind: 'asset',
			name: 'night'
		});
		expect(info.stories.map(story => story.storyId)).toEqual(['S2']);
		expect(info.stories[0].by).toBe('bo');
		// Nothing moved.
		expect((await s1.meta(night.id))!.hash).toBe(night.blob);
	});

	it('update and remove guard the same way', async () => {
		const {night, s1} = await twoStories();

		await expect(s1.update(night.id, {tags: ['x']})).rejects.toThrow(
			SharedAssetError
		);
		await expect(s1.remove(night.id)).rejects.toThrow(SharedAssetError);
	});

	it('scope fork shadows for this story only; the other story keeps the original', async () => {
		const {night, s1, s2, world} = await twoStories();

		const forked = await s1.replace(night.id, file('red', 'night.png'), {
			scope: 'fork'
		});

		await world.settle();

		expect(forked.id).not.toBe(night.id);
		expect(forked.name).toBe('night');

		const mine = await s1.lookup('night');
		const theirs = await s2.lookup('night');

		expect(mine!.id).toBe(forked.id);
		expect(mine!.own).toBe(true);
		expect(theirs!.id).toBe(night.id);
		expect(theirs!.hash).toBe(night.blob);
		// Only one `night` in S1's list: the shared one is shadowed.
		expect((await s1.list()).filter(meta => meta.name === 'night')).toHaveLength(
			1
		);
		// Qualified form still reaches the original.
		expect((await s1.lookup('tavern-set/night'))!.id).toBe(night.id);
	});

	it('scope all updates the other story view', async () => {
		const {night, s1, s2, world} = await twoStories();

		const updated = await s1.replace(night.id, file('red', 'night.png'), {
			scope: 'all'
		});

		await world.settle();

		expect(updated.id).toBe(night.id);
		expect((await s2.lookup('night'))!.hash).toBe(updated.hash);
		expect(updated.hash).not.toBe(night.blob);
	});

	it('a locked collection refuses scope all, allows fork', async () => {
		const {ana, night, s1, tavern} = await twoStories();

		ana.engine.updateCollection(tavern.id, {locked: true});

		const info = await s1.sharedInfo(night.id);

		expect(info!.canUpdateAll).toBe(false);
		await expect(
			s1.update(night.id, {origin: {x: 0.5, y: 0.5}}, {scope: 'all'})
		).rejects.toThrow(/locked/);
		expect(
			(await s1.update(night.id, {origin: {x: 0.5, y: 0.5}}, {scope: 'fork'}))
				.origin
		).toEqual({x: 0.5, y: 0.5});
	});

	it('own-collection assets nobody else uses edit without a scope', async () => {
		const [, ana] = await World.create(['ana']);
		const store = facade(ana, 'S1');
		const {id} = await store.putAsset(file('red'), {kind: 'bg'});

		const replaced = await store.replace(id, file('blue'), {
			edits: {brightness: 10, contrast: 0, gamma: 1} as ImageEdits,
			sidecars: {src: new Blob([png('red')], {type: 'image/png'})}
		});

		expect(replaced.edits).toMatchObject({brightness: 10});
		expect(replaced.sidecars?.src?.hash).toBeDefined();
		expect(await bytes(await store.sidecar(id, 'src'))).toEqual(
			Array.from(png('red'))
		);

		// A bare re-upload drops sidecars and edits.
		const reuploaded = await store.replace(id, file('green'));

		expect(reuploaded.sidecars).toBeUndefined();
		expect(reuploaded.edits).toBeUndefined();
	});
});

describe('characters', () => {
	async function withMira() {
		const [world, ana] = await World.create(['ana']);
		const store = facade(ana, 'S1');
		const idle = await store.put(file('red', 'mira-idle.png'), {
			kind: 'frame',
			name: 'mira-idle',
			ownerCharacter: 'mira'
		});
		const smile = await store.put(file('blue', 'mira-smile.png'), {
			kind: 'frame',
			name: 'mira-smile',
			ownerCharacter: 'mira'
		});
		const mira: Character = {
			...defaultCharacter('mira'),
			poses: {idle: {asset: idle}, smile: {asset: smile}}
		};

		await store.putCharacter(mira);

		return {ana, idle, mira, smile, store, world};
	}

	it('pose images are hidden from the flat list and owned', async () => {
		const {idle, store} = await withMira();

		expect(await store.list()).toEqual([]);
		expect((await store.meta(idle))!.ownerCharacter).toBe('mira');
		expect((await store.character('mira'))!.poses.idle.asset).toBe(idle);
	});

	it('rename via put-new + remove-old keeps the pose assets (old bug)', async () => {
		const {idle, mira, smile, store} = await withMira();

		await store.putCharacter({...mira, id: 'mara', name: 'mara'});
		await store.removeCharacter('mira');

		expect(await store.meta(idle)).toBeDefined();
		expect(await store.meta(smile)).toBeDefined();
		expect(await store.url(idle)).toBeDefined();
		expect((await store.character('mara'))!.poses.smile.asset).toBe(smile);
		expect(await store.character('mira')).toBeUndefined();
	});

	it('renameCharacter keeps the record and its poses', async () => {
		const {ana, idle, store} = await withMira();
		const before = ana.engine
			.characters()
			.find(character => character.charId === 'mira')!;

		await store.renameCharacter('mira', 'mara');

		const after = ana.engine
			.characters()
			.find(character => character.charId === 'mara')!;

		expect(after.id).toBe(before.id);
		expect((await store.meta(idle))!.ownerCharacter).toBe('mara');
		await expect(store.renameCharacter('mara', 'mira-idle')).rejects.toThrow(
			/already called/
		);
	});

	it('removeCharacter takes its unshared pose images with it', async () => {
		const {idle, store} = await withMira();

		await store.removeCharacter('mira');

		expect(await store.meta(idle)).toBeUndefined();
	});
});

describe('packager through the facade', () => {
	function passage(name: string, text: string): Passage {
		return {
			height: 100,
			highlighted: false,
			id: `p-${name}`,
			left: 0,
			name,
			selected: false,
			story: 'S1',
			tags: [],
			text,
			top: 0,
			width: 100
		};
	}

	const story: Story = {
		id: 'S1',
		ifid: 'C0FFEE00-0000-4000-8000-000000000000',
		lastUpdate: new Date('2026-01-02T03:04:05.000Z'),
		name: 'Tavern',
		passages: [
			passage(
				'Tavern',
				[
					'[scene]',
					'bg: tavern-night',
					'cast:',
					'  mira: {at: -0.4, pose: smile}'
				].join('\n')
			)
		],
		script: '',
		selected: false,
		snapToGrid: true,
		startPassage: 'p-Tavern',
		storyFormat: 'Sliders',
		storyFormatVersion: '1.0.0',
		stylesheet: '',
		tagColors: {},
		tags: [],
		zoom: 1
	};

	it('exports from one story and lands intact in another library', async () => {
		const [, ana, bo] = await World.create(['ana', 'bo']);
		const source = facade(ana, 'S1');
		const dest = facade(bo, 'S9');
		const bg = await source.put(file('red', 'tavern.png', 8), {
			kind: 'bg',
			name: 'tavern-night',
			tags: ['night']
		});
		const smile = await source.put(file('blue', 'mira-smile.png'), {
			kind: 'frame',
			name: 'mira/smile',
			ownerCharacter: 'mira'
		});

		await source.putCharacter({
			...defaultCharacter('mira'),
			poses: {smile: {asset: smile}}
		});

		const exported = await exportStoryBundle(story, source, {
			name: 'Twine',
			version: '2.10.0'
		});
		const contents = await readStoryBundle(exported.blob);
		const plan = await planBundle(dest, contents);

		await applyBundlePlan(dest, plan);

		const landed = await dest.list({includePoseImages: true});

		expect(landed.map(meta => meta.name).sort()).toEqual([
			'mira/smile',
			'tavern-night'
		]);

		const night = landed.find(meta => meta.name === 'tavern-night')!;
		const mira = (await dest.character('mira'))!;

		expect(night.tags).toEqual(['night']);
		expect(await bytes(await dest.get(night.id))).toEqual(
			await bytes(await source.get(bg))
		);
		expect((await dest.meta(mira.poses.smile.asset!))!.name).toBe('mira/smile');
		expect(
			(await dest.meta(mira.poses.smile.asset!))!.ownerCharacter
		).toBe('mira');

		// Re-importing is a no-op.
		const again = await planBundle(dest, contents);

		expect(again.assets.every(item => item.outcome === 'reused')).toBe(true);
	});
});
