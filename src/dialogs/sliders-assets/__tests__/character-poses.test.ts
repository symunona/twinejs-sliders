import {
	BackedAssetStore,
	MemoryBackend,
	defaultCharacter
} from '@sliders/asset-store';
import {pngBytes} from '../../../../packages/asset-store/src/test-fixtures';
import {framesFromFiles} from '../character-frames';

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

describe('framesFromFiles', () => {
	it('names the first frame idle, whatever the file was called', async () => {
		const store = newStore();
		const frames = await framesFromFiles(store, {frames: {}, id: 'mira'}, [
			file('mira.png')
		]);

		expect(Object.keys(frames)).toEqual(['idle']);
	});

	it('names later frames after their files', async () => {
		const store = newStore();
		const first = await framesFromFiles(store, {frames: {}, id: 'mira'}, [
			file('mira.png')
		]);
		const frames = await framesFromFiles(store, {frames: first, id: 'mira'}, [
			file('wave.png', 65)
		]);

		expect(Object.keys(frames).sort()).toEqual(['idle', 'wave']);
	});

	// The bug this naming exists for: a frame is an ordinary asset, so `mira.png` dropped to
	// make a character called `mira` used to take that name and `putCharacter` then threw.
	it("names the frame asset after the character, so it can't take the character's name", async () => {
		const store = newStore();
		const frames = await framesFromFiles(store, {frames: {}, id: 'mira'}, [
			file('mira.png')
		]);
		const asset = (await store.list({includeFrames: true})).find(
			meta => meta.id === frames.idle.asset
		);

		expect(asset?.name).toBe('mira-idle');
		expect(asset?.ownerCharacter).toBe('mira');
		expect(asset?.kind).toBe('frame');
		await expect(
			store.putCharacter(defaultCharacter('mira'))
		).resolves.toBeDefined();
	});

	it('rigs a new frame from the frames the character already has', async () => {
		const store = newStore();
		const first = await framesFromFiles(store, {frames: {}, id: 'mira'}, [
			file('mira.png')
		]);

		first.idle.anchors = {bubble: {x: 0.25, y: 0.1}};

		const frames = await framesFromFiles(store, {frames: first, id: 'mira'}, [
			file('wave.png', 65)
		]);

		expect(frames.wave.anchors).toEqual({bubble: {x: 0.25, y: 0.1}});
	});
});
