import {BackedAssetStore, MemoryBackend} from '@sliders/asset-store';
import {pngBytes} from '../../../../packages/asset-store/src/test-fixtures';
import {Generation} from '../generation-store';
import {saveGeneration} from '../save-generation';

// jsdom ships getRandomValues but not SubtleCrypto, and the store hashes every upload.
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

function newStore() {
	return new BackedAssetStore(new MemoryBackend());
}

function generation(overrides: Partial<Generation> = {}): Generation {
	return {
		aspect: '16:9',
		attachments: [],
		blob: new Blob([pngBytes()], {type: 'image/png'}),
		createdAt: 1,
		id: 'g_1',
		model: 'test-model',
		prompt: 'a desert at dusk',
		provider: 'gemini',
		savedAs: [],
		...overrides
	};
}

describe('saveGeneration', () => {
	it('names what it saved, so the asset manager can be asked to show it', async () => {
		const store = newStore();
		const result = await saveGeneration(
			store,
			generation(),
			'bg',
			'desert-at-dusk'
		);

		expect(result.duplicate).toBe(false);
		expect(result.ref).toBe('desert-at-dusk');
		expect((await store.list({kind: 'bg'}))[0].name).toBe('desert-at-dusk');
	});

	// The bug: saving the same image a second time reported a duplicate and named the
	// asset the FIRST save made, which is not the name the author had just typed -- so
	// they went looking in the library for a name that was never written.
	it('reports the existing asset by name when the bytes are already saved', async () => {
		const store = newStore();

		await saveGeneration(store, generation(), 'bg', 'desert-at-dusk');

		const again = await saveGeneration(store, generation(), 'bg', 'desert-at-dawn');

		expect(again.duplicate).toBe(true);
		expect(again.ref).toBe('desert-at-dusk');
		expect(await store.list({kind: 'bg'})).toHaveLength(1);
	});

	it('saves a second copy under the name asked for when allowed to', async () => {
		const store = newStore();

		await saveGeneration(store, generation(), 'bg', 'desert-at-dusk');

		const copy = await saveGeneration(
			store,
			generation(),
			'bg',
			'desert-at-dawn',
			{allowDuplicate: true}
		);

		expect(copy.duplicate).toBe(false);
		expect(copy.ref).toBe('desert-at-dawn');
		expect((await store.list({kind: 'bg'})).map(asset => asset.name).sort()).toEqual(
			['desert-at-dawn', 'desert-at-dusk']
		);
	});

	// Typing an existing character's name means another frame of them, not a twin.
	it('adds a pose to a character that already exists', async () => {
		const store = newStore();

		await saveGeneration(store, generation(), 'character', 'mira');

		const second = await saveGeneration(
			store,
			generation({prompt: 'Mira waving, full body'}),
			'character',
			'Mira'
		);
		const characters = await store.listCharacters();

		expect(second.ref).toBe('mira');
		expect(characters).toHaveLength(1);
		expect(Object.keys(characters[0].poses)).toEqual(['idle', 'waving']);
		expect(characters[0].poses.waving.asset).not.toBe(
			characters[0].poses.idle.asset
		);
	});

	it('names the pose after a slash, and never overwrites one', async () => {
		const store = newStore();

		await saveGeneration(store, generation(), 'character', 'mira');
		await saveGeneration(store, generation(), 'character', 'mira/wave');
		await saveGeneration(store, generation(), 'character', 'mira/wave');

		const [mira] = await store.listCharacters();

		expect(Object.keys(mira.poses)).toEqual(['idle', 'wave', 'wave-2']);
	});

	it('still makes a new character from a name nobody has', async () => {
		const store = newStore();

		await saveGeneration(store, generation(), 'character', 'mira');

		const other = await saveGeneration(store, generation(), 'character', 'tom');

		expect(other.ref).toBe('tom');
		expect(await store.listCharacters()).toHaveLength(2);
	});
});
