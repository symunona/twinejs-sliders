import {
	BackedAssetStore,
	MemoryBackend,
	defaultCharacter
} from '@sliders/asset-store';
import {pngBytes} from '../../../../packages/asset-store/src/test-fixtures';
import {posesFromFiles} from '../character-poses';

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
