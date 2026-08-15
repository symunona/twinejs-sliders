import {MemoryBackend} from '../backends/memory-backend';
import {assetFragment, characterFragment} from '../fragment';
import {BackedAssetStore, defaultCharacter} from '../store';
import {
	animatedWebpBytes,
	gifBytes,
	jpegBytes,
	pngBytes
} from '../test-fixtures';

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

function file(bytes: Uint8Array, name: string, type: string) {
	return new File([bytes], name, {type});
}

function newStore() {
	return new BackedAssetStore(new MemoryBackend());
}

describe('BackedAssetStore', () => {
	it('assigns short ids and derives names from filenames', async () => {
		const store = newStore();
		const id = await store.put(file(pngBytes(), 'Tavern Night.png', 'image/png'), {
			kind: 'bg'
		});

		expect(id).toMatch(/^a_[0-9a-f]{4}$/);
		expect((await store.meta(id))?.name).toBe('tavern-night');
	});

	it('records a content hash', async () => {
		const store = newStore();
		const id = await store.put(file(pngBytes(), 'a.png', 'image/png'));

		expect((await store.meta(id))?.hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it('reports a re-uploaded file as a duplicate instead of storing it twice', async () => {
		const store = newStore();
		const first = await store.putAsset(
			file(pngBytes(), 'a.png', 'image/png'),
			{kind: 'bg'}
		);
		const second = await store.putAsset(
			file(pngBytes(), 'copy-of-a.png', 'image/png'),
			{kind: 'bg'}
		);

		expect(first.duplicate).toBe(false);
		expect(second.duplicate).toBe(true);
		expect(second.id).toBe(first.id);
		expect(await store.list({kind: 'bg'})).toHaveLength(1);
	});

	it('treats genuinely different files as separate assets', async () => {
		const store = newStore();
		const first = await store.putAsset(
			file(pngBytes(10, 10), 'a.png', 'image/png'),
			{kind: 'bg'}
		);
		const second = await store.putAsset(
			file(pngBytes(20, 20), 'b.png', 'image/png'),
			{kind: 'bg'}
		);

		expect(second.duplicate).toBe(false);
		expect(second.id).not.toBe(first.id);
	});

	// jsdom has no createImageBitmap or OffscreenCanvas, so the transcoding branch itself
	// is exercised in the Playwright suite. What matters here is that animated files never
	// reach it.
	it('stores an animated GIF unchanged and marks it animated', async () => {
		const store = newStore();
		const result = await store.putAsset(
			file(gifBytes({frames: 5}), 'wave.gif', 'image/gif'),
			{kind: 'object'}
		);

		expect(result.transcoded).toBe(false);
		expect(result.meta.animated).toBe(true);
		expect(result.meta.mime).toBe('image/gif');
	});

	it('stores an animated WebP unchanged', async () => {
		const store = newStore();
		const result = await store.putAsset(
			file(animatedWebpBytes(640, 480), 'rain.webp', 'image/webp'),
			{kind: 'fx'}
		);

		expect(result.meta.animated).toBe(true);
		expect(result.meta.w).toBe(640);
		expect(result.meta.h).toBe(480);
	});

	it('hides character frames from the flat list', async () => {
		const store = newStore();

		await store.put(file(pngBytes(1, 1), 'bg.png', 'image/png'), {kind: 'bg'});
		await store.put(file(pngBytes(2, 2), 'idle.png', 'image/png'), {
			kind: 'frame',
			ownerCharacter: 'mira'
		});

		expect(await store.list()).toHaveLength(1);
		expect(await store.list({includeFrames: true})).toHaveLength(2);
	});

	it('filters by kind, search text and tags', async () => {
		const store = newStore();

		await store.put(file(pngBytes(1, 1), 'tavern-night.png', 'image/png'), {
			kind: 'bg',
			tags: ['interior']
		});
		await store.put(file(pngBytes(2, 2), 'street-dusk.png', 'image/png'), {
			kind: 'bg',
			tags: ['exterior']
		});
		await store.put(file(pngBytes(3, 3), 'candle.png', 'image/png'), {
			kind: 'object'
		});

		expect(await store.list({kind: 'bg'})).toHaveLength(2);
		expect(await store.list({search: 'tavern'})).toHaveLength(1);
		expect(await store.list({tags: ['exterior']})).toHaveLength(1);
		expect(await store.list({kind: 'bg', tags: ['missing']})).toHaveLength(0);
	});

	it('removes an asset and its bytes', async () => {
		const store = newStore();
		const id = await store.put(file(pngBytes(), 'a.png', 'image/png'));

		await store.remove(id);
		expect(await store.meta(id)).toBeUndefined();
		expect(await store.get(id)).toBeUndefined();
	});

	it('persists characters and marks their frames as owned', async () => {
		const store = newStore();
		const frameId = await store.put(
			file(pngBytes(), 'idle.png', 'image/png'),
			{kind: 'bg'}
		);
		const character = {
			...defaultCharacter('mira', 'Mira'),
			frames: {idle: {asset: frameId}}
		};

		await store.putCharacter(character);

		const stored = await store.getCharacter('mira');

		expect(stored?.name).toBe('Mira');
		expect(stored?.origin).toEqual({x: 0.5, y: 1});
		expect((await store.meta(frameId))?.ownerCharacter).toBe('mira');
		expect((await store.meta(frameId))?.kind).toBe('frame');
		expect(await store.list()).toHaveLength(0);
		expect(await store.listCharacters()).toHaveLength(1);
	});

	it('removes a character along with its frames', async () => {
		const store = newStore();
		const frameId = await store.put(file(pngBytes(), 'idle.png', 'image/png'), {
			kind: 'frame',
			ownerCharacter: 'mira'
		});

		await store.putCharacter({
			...defaultCharacter('mira'),
			frames: {idle: {asset: frameId}}
		});
		await store.removeCharacter('mira');

		expect(await store.listCharacters()).toHaveLength(0);
		expect(await store.meta(frameId)).toBeUndefined();
	});

	it('survives concurrent uploads without losing manifest entries', async () => {
		const store = newStore();

		await Promise.all(
			[1, 2, 3, 4, 5].map(size =>
				store.put(file(pngBytes(size, size), `bg-${size}.png`, 'image/png'), {
					kind: 'bg'
				})
			)
		);

		expect(await store.list({kind: 'bg'})).toHaveLength(5);
	});
});

describe('YAML fragments', () => {
	it('copies a background as a bg line', async () => {
		const store = newStore();
		const id = await store.put(
			file(pngBytes(), 'tavern/night.png', 'image/png'),
			{kind: 'bg'}
		);

		expect(assetFragment((await store.meta(id))!)).toBe('bg: tavern/night');
	});

	it('copies an object as an entity line', async () => {
		const store = newStore();
		const id = await store.put(file(pngBytes(), 'props/candle.png', 'image/png'), {
			kind: 'object'
		});

		expect(assetFragment((await store.meta(id))!)).toBe('candle: {at: 0}');
	});

	it('copies a character as an entity line naming its first frame', () => {
		expect(
			characterFragment({
				...defaultCharacter('mira', 'Mira'),
				frames: {idle: {asset: 'a_0001'}, wave: {asset: 'a_0002'}}
			})
		).toBe('mira: {at: 0, frame: idle}');
	});

	it('falls back to an idle frame for a character with no frames yet', () => {
		expect(characterFragment(defaultCharacter('joren'))).toBe(
			'joren: {at: 0, frame: idle}'
		);
	});

	it('replaces an asset in place, keeping its identity', async () => {
		const store = newStore();
		const id = await store.put(file(pngBytes(), 'Tavern Night.png', 'image/png'), {
			kind: 'bg',
			tags: ['night']
		});
		const before = await store.meta(id);

		await store.replace(id, file(jpegBytes(), 'whatever-i-called-it.jpg', 'image/jpeg'));

		const after = await store.meta(id);

		// What the author chose survives.
		expect(after?.id).toBe(id);
		expect(after?.name).toBe('tavern-night');
		expect(after?.kind).toBe('bg');
		expect(after?.tags).toEqual(['night']);

		// What describes the bytes does not.
		expect(after?.mime).toBe('image/jpeg');
		expect(after?.hash).not.toBe(before?.hash);
		expect(after?.w).toBe(300);
		expect(after?.h).toBe(150);

		// And it is still one asset, not two.
		expect(await store.list({kind: 'bg'})).toHaveLength(1);
		expect(await store.get(id)).toBeDefined();
	});

	it('refuses to replace an asset that is not there', async () => {
		const store = newStore();

		await expect(
			store.replace('a_beef', file(pngBytes(), 'a.png', 'image/png'))
		).rejects.toThrow(/no asset with ID/);
	});
});
