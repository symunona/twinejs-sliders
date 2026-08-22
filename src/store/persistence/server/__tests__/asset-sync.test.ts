/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {
	BackedAssetStore,
	MemoryBackend,
	contentHash
} from '@sliders/asset-store';
import type {AssetMeta} from '@sliders/scene-types';
import {webpBytes} from '../../../../../packages/asset-store/src/test-fixtures';
import {syncStoryAssets, type AssetSyncProgress} from '../asset-sync';
import type {ServerClient} from '../client';
import {testPassage, testStory} from '../test-fixtures';

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

const SCENE = '[scene]\nbg: tavern/night\n';

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

function storyReferencing(text = SCENE) {
	return testStory({passages: [testPassage('story-1', {text})]});
}

function fakeClient(diff: {
	missing?: string[];
	present?: string[];
	stale?: string[];
}) {
	const diffAssets = jest.fn(async () => ({
		missing: diff.missing ?? [],
		present: diff.present ?? [],
		stale: diff.stale ?? []
	}));
	const putAssetBlob = jest.fn(async () => undefined);
	const putManifest = jest.fn(async () => ({rev: 8}));

	return {
		client: {diffAssets, putAssetBlob, putManifest} as unknown as ServerClient,
		diffAssets,
		putAssetBlob,
		putManifest
	};
}

describe('syncStoryAssets', () => {
	it('uploads only what the diff says is missing, then writes the manifest', async () => {
		const bytes = webpBytes();
		const store = newStore();

		await store.importAsset(await meta(bytes), new Blob([bytes]));

		const {client, diffAssets, putAssetBlob, putManifest} = fakeClient({
			missing: ['a_8f21']
		});
		const result = await syncStoryAssets({
			client,
			story: storyReferencing(),
			store
		});

		const [, sentAssets] = diffAssets.mock.calls[0] as unknown as [
			string,
			{id: string; hash: string; bytes: number}[]
		];

		expect(sentAssets).toEqual([
			{bytes: bytes.length, hash: await contentHash(bytes), id: 'a_8f21'}
		]);
		expect(putAssetBlob).toHaveBeenCalledTimes(1);
		expect(result.uploaded).toEqual(['a_8f21']);

		// Manifest last, always: it is the index a checkout reads.
		expect(putAssetBlob.mock.invocationCallOrder[0]).toBeLessThan(
			putManifest.mock.invocationCallOrder[0]
		);
		const [, sentManifest] = putManifest.mock.calls[0] as unknown as [
			string,
			{assets: unknown[]; characters: unknown[]; version: number}
		];

		expect(sentManifest).toMatchObject({
			assets: [expect.objectContaining({id: 'a_8f21'})],
			characters: [],
			version: 1
		});
		expect(result.rev).toBe(8);
	});

	it('skips the 4 MB background the server already has', async () => {
		const bytes = webpBytes();
		const store = newStore();

		await store.importAsset(await meta(bytes), new Blob([bytes]));

		const {client, putAssetBlob} = fakeClient({present: ['a_8f21']});
		const result = await syncStoryAssets({
			client,
			story: storyReferencing(),
			store
		});

		expect(putAssetBlob).not.toHaveBeenCalled();
		expect(result.skipped).toEqual(['a_8f21']);
	});

	it('re-uploads an asset the server holds under a different hash', async () => {
		const bytes = webpBytes();
		const store = newStore();

		await store.importAsset(await meta(bytes), new Blob([bytes]));

		const {client, putAssetBlob} = fakeClient({stale: ['a_8f21']});

		await syncStoryAssets({client, story: storyReferencing(), store});

		expect(putAssetBlob).toHaveBeenCalledTimes(1);
	});

	it('uploads one at a time', async () => {
		const store = newStore();
		const first = webpBytes(200, 100);
		const second = webpBytes(300, 200);

		await store.importAsset(await meta(first), new Blob([first]));
		await store.importAsset(
			await meta(second, {id: 'a_2222', name: 'street/day'}),
			new Blob([second])
		);

		let concurrent = 0;
		let peak = 0;
		const client = {
			diffAssets: async () => ({
				missing: ['a_8f21', 'a_2222'],
				present: [],
				stale: []
			}),
			putAssetBlob: async () => {
				concurrent += 1;
				peak = Math.max(peak, concurrent);
				await Promise.resolve();
				concurrent -= 1;
			},
			putManifest: async () => ({rev: 1})
		} as unknown as ServerClient;

		await syncStoryAssets({
			client,
			story: storyReferencing(
				'[scene]\nbg: tavern/night\nprops:\n  street/day: {at: 0}\n'
			),
			store
		});

		expect(peak).toBe(1);
	});

	it('reports a name the story writes that the library does not have', async () => {
		const {client} = fakeClient({});
		const result = await syncStoryAssets({
			client,
			story: storyReferencing(),
			store: newStore()
		});

		expect(result.unresolved).toEqual(['tavern/night']);
		expect(result.assetCount).toBe(0);
	});

	it('reports an asset whose bytes the library lost, without failing the push', async () => {
		const bytes = webpBytes();
		const backend = new MemoryBackend();
		const store = new BackedAssetStore(backend);

		await store.importAsset(await meta(bytes), new Blob([bytes]));
		// The manifest still names it; the bytes are gone. OPFS eviction looks like this.
		await backend.deleteBlob('a_8f21');

		const {client, putManifest} = fakeClient({missing: ['a_8f21']});
		const result = await syncStoryAssets({
			client,
			story: storyReferencing(),
			store
		});

		expect(result.missingLocally).toEqual(['a_8f21']);
		expect(putManifest).toHaveBeenCalled();
	});

	it('reports progress through every phase', async () => {
		const bytes = webpBytes();
		const store = newStore();

		await store.importAsset(await meta(bytes), new Blob([bytes]));

		const {client} = fakeClient({missing: ['a_8f21']});
		const progress: AssetSyncProgress[] = [];

		await syncStoryAssets({
			client,
			onProgress: next => progress.push(next),
			story: storyReferencing(),
			store
		});

		expect(progress.map(item => item.phase)).toEqual([
			'scan',
			'scan',
			'diff',
			'diff',
			'upload',
			'upload',
			'manifest',
			'manifest'
		]);
	});
});
