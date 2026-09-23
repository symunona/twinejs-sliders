import {
	BackedAssetStore,
	MemoryBackend,
	defaultCharacter
} from '@sliders/asset-store';
import {pngBytes} from '../../../../packages/asset-store/src/test-fixtures';
import {
	importPoseSet,
	plannedPoseNames,
	posesFromFiles
} from '../character-poses';

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

function file(name: string, width = 64, height = 64) {
	return new File([pngBytes(width, height)], name, {type: 'image/png'});
}

function newStore() {
	return new BackedAssetStore(new MemoryBackend());
}

describe('posesFromFiles', () => {
	it('names the first pose idle, whatever the file was called', async () => {
		const store = newStore();
		const poses = await posesFromFiles(store, {poses: {}, id: 'mira'}, [
			file('mira.png')
		]);

		expect(Object.keys(poses)).toEqual(['idle']);
	});

	it('names later poses after their files', async () => {
		const store = newStore();
		const first = await posesFromFiles(store, {poses: {}, id: 'mira'}, [
			file('mira.png')
		]);
		const poses = await posesFromFiles(store, {poses: first, id: 'mira'}, [
			file('wave.png', 65)
		]);

		expect(Object.keys(poses).sort()).toEqual(['idle', 'wave']);
	});

	// The bug this naming exists for: a pose is an ordinary asset, so `mira.png` dropped to
	// make a character called `mira` used to take that name and `putCharacter` then threw.
	it("names the pose asset after the character, so it can't take the character's name", async () => {
		const store = newStore();
		const poses = await posesFromFiles(store, {poses: {}, id: 'mira'}, [
			file('mira.png')
		]);
		const asset = (await store.list({includePoseImages: true})).find(
			meta => meta.id === poses.idle.asset
		);

		expect(asset?.name).toBe('mira-idle');
		expect(asset?.ownerCharacter).toBe('mira');
		expect(asset?.kind).toBe('frame');
		await expect(
			store.putCharacter(defaultCharacter('mira'))
		).resolves.toBeDefined();
	});

	it('rigs a new pose from the poses the character already has', async () => {
		const store = newStore();
		const first = await posesFromFiles(store, {poses: {}, id: 'mira'}, [
			file('mira.png')
		]);

		first.idle.anchors = {bubble: {x: 0.25, y: 0.1}};

		const poses = await posesFromFiles(store, {poses: first, id: 'mira'}, [
			file('wave.png', 65)
		]);

		expect(poses.wave.anchors).toEqual({bubble: {x: 0.25, y: 0.1}});
	});
});

describe('importPoseSet', () => {
	function image(width: number, fit?: {offset: {x: number; y: number}; scale: number}) {
		return {blob: file(`${width}.png`, width), fit, label: `${width}`};
	}

	it('makes steps, stills, idle first, and keeps fits and timing', async () => {
		const store = newStore();
		const fit = {offset: {x: 0.1, y: 0}, scale: 1};
		const poses = await importPoseSet(store, {id: 'mira', poses: {}}, [
			{dur: 0.2, images: [image(10, fit), image(11)], loop: false, name: 'walk'},
			{images: [image(12)], name: 'wave'}
		]);

		// No idle in the set, and the character had no poses: the first one takes it.
		expect(Object.keys(poses)).toEqual(['idle', 'wave']);
		expect(poses.idle.loop).toBe(false);
		expect(poses.idle.steps).toEqual([
			{asset: expect.any(String), dur: 0.2, fit},
			{asset: expect.any(String), dur: 0.2}
		]);
		expect(poses.wave.asset).toEqual(expect.any(String));
		expect(poses.wave.steps).toBeUndefined();

		const names = (await store.list({includePoseImages: true})).map(
			meta => meta.name
		);

		expect(names).toEqual(
			expect.arrayContaining(['mira-idle-1', 'mira-idle-2', 'mira-wave'])
		);
	});

	it('suffixes a name that clashes with an existing pose', async () => {
		const store = newStore();
		const first = await posesFromFiles(store, {id: 'mira', poses: {}}, [
			file('a.png')
		]);
		const poses = await importPoseSet(store, {id: 'mira', poses: first}, [
			{images: [image(20), image(21)], name: 'idle'}
		]);

		expect(Object.keys(poses)).toEqual(['idle', 'idle-2']);
		expect(poses['idle-2'].steps).toHaveLength(2);
	});
});

describe('plannedPoseNames', () => {
	it('gives an empty character idle: its own, else the first', () => {
		expect(plannedPoseNames(['walk', 'Idle', 'wave'], {})).toEqual([
			'walk',
			'idle',
			'wave'
		]);
		expect(plannedPoseNames(['walk', 'wave'], {})).toEqual(['idle', 'wave']);
	});

	it('suffixes clashes, with existing poses and within the set', () => {
		expect(
			plannedPoseNames(['idle', 'walk', 'walk'], {idle: {asset: 'a'}})
		).toEqual(['idle-2', 'walk', 'walk-2']);
	});
});
