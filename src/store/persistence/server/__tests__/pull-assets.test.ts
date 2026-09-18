/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {
	BackedAssetStore,
	MemoryBackend,
	contentHash
} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {webpBytes} from '../../../../../packages/asset-store/src/test-fixtures';
import type {ServerClient} from '../client';
import {pullStoryAssets} from '../pull-assets';
import type {AssetManifest} from '../server.types';

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

async function meta(
	bytes: Uint8Array,
	overrides: Partial<AssetMeta> = {}
): Promise<AssetMeta> {
	return {
		animated: false,
		bytes: bytes.length,
		h: 100,
		hash: await contentHash(bytes),
		id: 'a_8f21',
		kind: 'bg',
		mime: 'image/webp',
		name: 'tavern/night',
		tags: [],
		w: 200,
		...overrides
	};
}

function fakeClient(options: {
	manifest?: Partial<AssetManifest>;
	manifestError?: Error;
	blob?: Blob;
}) {
	const getManifest = jest.fn(async () => {
		if (options.manifestError) {
			throw options.manifestError;
		}

		return {
			assets: [],
			characters: [],
			missing: [],
			rev: 1,
			version: 1,
			...options.manifest
		} as AssetManifest;
	});
	const getAssetBlob = jest.fn(
		async () => options.blob ?? new Blob([webpBytes()], {type: 'image/webp'})
	);

	return {
		client: {getAssetBlob, getManifest} as unknown as ServerClient,
		getAssetBlob,
		getManifest
	};
}

function character(overrides: Partial<Character> = {}): Character {
	return {
		frames: {idle: 'a_8f21'},
		id: 'mira',
		name: 'mira',
		size: {h: 1, w: 0.3},
		...overrides
	} as Character;
}

describe('pullStoryAssets', () => {
	it('downloads art the local library does not have', async () => {
		const bytes = webpBytes();
		const store = newStore();
		const incoming = await meta(bytes);
		const {client, getAssetBlob} = fakeClient({
			blob: new Blob([bytes], {type: 'image/webp'}),
			manifest: {assets: [incoming], rev: 4}
		});

		const result = await pullStoryAssets({client, store, storyId: 'story-1'});

		expect(getAssetBlob).toHaveBeenCalledWith('story-1', incoming.id);
		expect(result.downloaded).toEqual([incoming.id]);
		expect(result.changed).toBe(true);
		expect(result.rev).toBe(4);
		expect((await store.list({includeFrames: true})).length).toBe(1);
	});

	it('asks the server nothing when the manifest rev has not moved', async () => {
		const {client, getManifest, getAssetBlob} = fakeClient({
			manifest: {rev: 7}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 7,
			store: newStore(),
			storyId: 'story-1'
		});

		expect(getManifest).toHaveBeenCalledTimes(1);
		expect(getAssetBlob).not.toHaveBeenCalled();
		expect(result.skipped).toBe(true);
		expect(result.changed).toBe(false);
	});

	/**
	 * The guard that stops two clients pulling nothing and pushing a manifest at each
	 * other forever: a rev we have not seen, over a library that already matches.
	 */
	it('downloads nothing when the library already holds the manifest', async () => {
		const bytes = webpBytes();
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'tavern.webp', {type: 'image/webp'}),
			{kind: 'bg'}
		);
		const {client, getAssetBlob} = fakeClient({
			manifest: {
				assets: [await meta(bytes, {hash: saved.meta.hash, id: 'a_other'})],
				rev: 9
			}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		expect(getAssetBlob).not.toHaveBeenCalled();
		expect(result.changed).toBe(false);
		expect(result.skipped).toBe(true);
		expect(result.rev).toBe(9);
	});

	it('runs when only the cast moved, even with every asset already here', async () => {
		const bytes = webpBytes();
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'mira-idle.webp', {type: 'image/webp'}),
			{kind: 'frame'}
		);
		const {client} = fakeClient({
			manifest: {
				assets: [await meta(bytes, {hash: saved.meta.hash, kind: 'frame'})],
				characters: [character()],
				rev: 3
			}
		});

		const result = await pullStoryAssets({client, store, storyId: 'story-1'});

		expect(result.changed).toBe(true);
		expect((await store.listCharacters()).map(item => item.id)).toEqual([
			'mira'
		]);
	});

	it('skips ids the server says it has no bytes for', async () => {
		const bytes = webpBytes();
		const {client, getAssetBlob} = fakeClient({
			manifest: {
				assets: [await meta(bytes, {id: 'a_gone'})],
				missing: ['a_gone'],
				rev: 2
			}
		});

		const result = await pullStoryAssets({
			client,
			store: newStore(),
			storyId: 'story-1'
		});

		expect(getAssetBlob).not.toHaveBeenCalled();
		expect(result.skipped).toBe(true);
	});

	it('treats a story with no manifest as nothing to do', async () => {
		const {client} = fakeClient({
			manifestError: new Error('404 not found')
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 5,
			store: newStore(),
			storyId: 'story-1'
		});

		expect(result).toMatchObject({changed: false, rev: 5, skipped: true});
	});

	it('reports progress while art comes down', async () => {
		const bytes = webpBytes();
		const phases: string[] = [];
		const {client} = fakeClient({
			blob: new Blob([bytes], {type: 'image/webp'}),
			manifest: {assets: [await meta(bytes)], rev: 4}
		});

		await pullStoryAssets({
			client,
			onProgress: progress => phases.push(progress.phase),
			store: newStore(),
			storyId: 'story-1'
		});

		expect(phases).toContain('download');
	});
});
