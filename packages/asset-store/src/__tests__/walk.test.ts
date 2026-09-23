import type {AssetMeta, WalkArea} from '@sliders/scene-types';
import {MemoryBackend} from '../backends/memory-backend';
import {BackedAssetStore} from '../store';
import {pngBytes} from '../test-fixtures';

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

const WALK: WalkArea = {
	depth: {far: {scale: 0.45, y: 0.52}, near: {scale: 1, y: 0.96}},
	shapes: [
		{
			id: 's1',
			op: 'walk',
			points: [
				{x: 0.1, y: 0.5},
				{x: 0.9, y: 0.5},
				{x: 0.9, y: 0.95},
				{x: 0.1, y: 0.95}
			]
		},
		{
			id: 's2',
			op: 'block',
			points: [
				{x: 0.4, y: 0.6},
				{x: 0.6, y: 0.6},
				{x: 0.5, y: 0.8}
			]
		}
	]
};

function newStore() {
	return new BackedAssetStore(new MemoryBackend());
}

function png() {
	return new File([pngBytes()], 'room.png', {type: 'image/png'});
}

describe('walk areas in the store', () => {
	it('round trips through putAsset and meta', async () => {
		const store = newStore();
		const {id} = await store.putAsset(png(), {kind: 'bg', walk: WALK});

		expect((await store.meta(id))?.walk).toEqual(WALK);
	});

	it('round trips through update, and clears', async () => {
		const store = newStore();
		const {id} = await store.putAsset(png(), {kind: 'bg'});

		await store.update(id, {walk: WALK});
		expect((await store.meta(id))?.walk).toEqual(WALK);

		await store.update(id, {walk: undefined});
		expect((await store.meta(id))?.walk).toBeUndefined();
	});

	it('survives a replace, like an effect', async () => {
		const store = newStore();
		const {id} = await store.putAsset(png(), {kind: 'bg', walk: WALK});

		await store.replace(id, new File([pngBytes()], 'b.png', {type: 'image/png'}));
		expect((await store.meta(id))?.walk).toEqual(WALK);
	});

	it('is kept by importAsset, which strips edits and masks', async () => {
		const store = newStore();
		const bytes = pngBytes();
		const meta: AssetMeta = {
			animated: false,
			bytes: bytes.length,
			h: 1,
			hash: 'deadbeef',
			id: 'a_room',
			kind: 'bg',
			mask: {shapes: []},
			mime: 'image/png',
			name: 'room',
			tags: [],
			w: 1,
			walk: WALK
		};

		const stored = await store.importAsset(meta, new Blob([bytes]));

		expect(stored.walk).toEqual(WALK);
		expect(stored.mask).toBeUndefined();
	});
});
