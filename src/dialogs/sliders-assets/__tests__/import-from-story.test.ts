/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {BackedAssetStore, MemoryBackend, contentHash} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {pngBytes} from '../../../../packages/asset-store/src/test-fixtures';
import {
	assetIsPresent,
	importAssetFromStory,
	importCharacterFromStory
} from '../import-from-story';

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

function newStore() {
	return new BackedAssetStore(new MemoryBackend(), 'story-1');
}

async function meta(
	bytes: Uint8Array,
	overrides: Partial<AssetMeta> = {}
): Promise<AssetMeta> {
	return {
		animated: false,
		bytes: bytes.length,
		h: 360,
		hash: await contentHash(bytes),
		id: 'a_8f21',
		kind: 'bg',
		mime: 'image/png',
		name: 'tavern/night',
		tags: [],
		w: 640,
		...overrides
	};
}

describe('importAssetFromStory', () => {
	it('copies the bytes and the metadata into the other library', async () => {
		const source = newStore();
		const target = newStore();
		const bytes = pngBytes();
		const stored = await source.importAsset(await meta(bytes), new Blob([bytes]));

		const result = await importAssetFromStory(source, target, stored);

		expect(result.imported).toBe(true);
		expect(result.warnings).toEqual([]);

		const [copied] = await target.list();

		expect(copied.name).toBe('tavern/night');
		// Ids are kept where they are free, so a scene naming the id still resolves.
		expect(copied.id).toBe(stored.id);
		expect(await target.get(copied.id)).toBeDefined();
	});

	it('leaves the source library alone', async () => {
		const source = newStore();
		const target = newStore();
		const bytes = pngBytes();
		const stored = await source.importAsset(await meta(bytes), new Blob([bytes]));

		await importAssetFromStory(source, target, stored);
		expect(await source.list()).toHaveLength(1);
	});

	it('does not copy the same bytes twice', async () => {
		const source = newStore();
		const target = newStore();
		const bytes = pngBytes();
		const stored = await source.importAsset(await meta(bytes), new Blob([bytes]));

		await importAssetFromStory(source, target, stored);
		const second = await importAssetFromStory(source, target, stored);

		expect(second.imported).toBe(false);
		expect(await target.list()).toHaveLength(1);
	});

	it('keeps this story’s art when the name is already taken, and says so', async () => {
		const source = newStore();
		const target = newStore();
		const mine = pngBytes();
		const theirs = pngBytes(100);

		await target.importAsset(
			await meta(mine, {id: 'a_1111'}),
			new Blob([mine])
		);

		const stored = await source.importAsset(
			await meta(theirs, {id: 'a_2222'}),
			new Blob([theirs])
		);
		const result = await importAssetFromStory(source, target, stored);

		expect(result.imported).toBe(false);
		expect(result.warnings.join(' ')).toContain('tavern/night');
		expect(await target.list()).toHaveLength(1);
		expect((await target.list())[0].id).toBe('a_1111');
	});

	it('explains an asset whose bytes are missing', async () => {
		const source = newStore();
		const target = newStore();

		await expect(
			importAssetFromStory(source, target, await meta(pngBytes()))
		).rejects.toThrow(/no image data/);
	});
});

describe('importCharacterFromStory', () => {
	async function castMember(store: BackedAssetStore): Promise<Character> {
		const idle = pngBytes();
		const angry = pngBytes(100);

		await store.importAsset(
			await meta(idle, {id: 'a_0001', kind: 'frame', name: 'mira/idle'}),
			new Blob([idle])
		);
		await store.importAsset(
			await meta(angry, {id: 'a_0002', kind: 'frame', name: 'mira/angry'}),
			new Blob([angry])
		);

		return await store.putCharacter({
			frames: {angry: {asset: 'a_0002'}, idle: {asset: 'a_0001'}},
			id: 'mira',
			name: 'Mira Vale',
			origin: {x: 0.5, y: 1},
			size: {w: 512, h: 1024},
			tags: []
		});
	}

	it('brings every frame across, not only the ones a scene names', async () => {
		const source = newStore();
		const target = newStore();
		const character = await castMember(source);

		const result = await importCharacterFromStory(source, target, character);

		expect(result.imported).toBe(true);
		expect(Object.keys((await target.getCharacter('mira'))!.frames).sort()).toEqual(
			['angry', 'idle']
		);
		expect(await target.list({includeFrames: true})).toHaveLength(2);
	});

	it('merges into a character that is already here rather than replacing it', async () => {
		const source = newStore();
		const target = newStore();
		const character = await castMember(source);
		const mine = pngBytes(12);

		await target.importAsset(
			await meta(mine, {id: 'a_9999', kind: 'frame', name: 'mine/idle'}),
			new Blob([mine])
		);
		await target.putCharacter({
			frames: {idle: {asset: 'a_9999'}},
			id: 'mira',
			name: 'My Mira',
			origin: {x: 0.5, y: 1},
			size: {w: 512, h: 1024},
			tags: []
		});

		const result = await importCharacterFromStory(source, target, character);
		const merged = (await target.getCharacter('mira'))!;

		expect(merged.name).toBe('My Mira');
		expect(merged.frames.idle.asset).toBe('a_9999');
		expect(merged.frames.angry).toBeDefined();
		expect(result.warnings.join(' ')).toContain('merged');
	});

	it('reports a frame whose image the other story lost', async () => {
		const source = newStore();
		const target = newStore();

		await source.putCharacter({
			frames: {idle: {asset: 'a_dead'}},
			id: 'mira',
			name: 'Mira Vale',
			origin: {x: 0.5, y: 1},
			size: {w: 512, h: 1024},
			tags: []
		});

		const result = await importCharacterFromStory(
			source,
			target,
			(await source.getCharacter('mira'))!
		);

		expect(result.warnings.join(' ')).toContain('idle');
		expect((await target.getCharacter('mira'))!.frames.idle).toBeUndefined();
	});
});

describe('assetIsPresent', () => {
	it('matches on bytes, not on name', async () => {
		const bytes = pngBytes();
		const mine = await meta(bytes, {id: 'a_1111', name: 'forest'});
		const theirs = await meta(bytes, {id: 'a_2222', name: 'woods'});

		expect(assetIsPresent(theirs, [mine])).toBe(true);
	});

	it('does not count a character frame as a loose asset', async () => {
		const bytes = pngBytes();
		const frame = await meta(bytes, {ownerCharacter: 'mira'});
		const loose = await meta(bytes, {id: 'a_2222'});

		expect(assetIsPresent(loose, [frame])).toBe(false);
	});
});
