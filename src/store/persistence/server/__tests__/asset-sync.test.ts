/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {
	BackedAssetStore,
	blobBytes,
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

	it('pushes art no scene names yet', async () => {
		// The order authors actually work in: upload the picture, write the scene later.
		// A manifest built from the scene references alone drops it, and the art is in the
		// editor and absent from the server with nothing saying so.
		const bytes = webpBytes();
		const store = newStore();

		await store.importAsset(
			await meta(bytes, {id: 'a_lone', name: 'nobody-uses-me'}),
			new Blob([bytes])
		);

		const {client, putManifest} = fakeClient({missing: ['a_lone']});
		const result = await syncStoryAssets({
			client,
			story: storyReferencing('[scene]\n'),
			store
		});

		expect(result.uploaded).toEqual(['a_lone']);

		const [, sentManifest] = putManifest.mock.calls[0] as unknown as [
			string,
			{assets: {id: string}[]}
		];

		expect(sentManifest.assets.map(asset => asset.id)).toEqual(['a_lone']);
	});

	it('does nothing at all when the library has not moved', async () => {
		const bytes = webpBytes();
		const store = newStore();

		await store.importAsset(await meta(bytes), new Blob([bytes]));

		const {client, diffAssets, putAssetBlob, putManifest} = fakeClient({
			present: ['a_8f21']
		});
		const first = await syncStoryAssets({
			client,
			story: storyReferencing(),
			store
		});

		expect(first.unchanged).toBe(false);

		const second = await syncStoryAssets({
			client,
			lastFingerprint: first.fingerprint,
			story: storyReferencing(),
			store
		});

		expect(second.unchanged).toBe(true);
		// The whole point: the autosave path calls this after every push, so an
		// unchanged library must not cost a request.
		expect(diffAssets).toHaveBeenCalledTimes(1);
		expect(putAssetBlob).not.toHaveBeenCalled();
		expect(putManifest).toHaveBeenCalledTimes(1);
	});

	it('syncs again once a character frame is added', async () => {
		const bytes = webpBytes();
		const store = newStore();

		await store.importAsset(await meta(bytes), new Blob([bytes]));

		const {client, putManifest} = fakeClient({present: ['a_8f21']});
		const first = await syncStoryAssets({
			client,
			story: storyReferencing(),
			store
		});

		await store.putCharacter({
			frames: {idle: {asset: 'a_8f21'}},
			id: 'bob',
			name: 'bob',
			origin: {x: 0.5, y: 1},
			size: {h: 1024, w: 512},
			tags: []
		});

		const second = await syncStoryAssets({
			client,
			lastFingerprint: first.fingerprint,
			story: storyReferencing(),
			store
		});

		expect(second.unchanged).toBe(false);
		expect(putManifest).toHaveBeenCalledTimes(2);

		const [, sentManifest] = putManifest.mock.calls[1] as unknown as [
			string,
			{characters: {id: string}[]}
		];

		expect(sentManifest.characters.map(item => item.id)).toEqual(['bob']);
	});
});

describe('syncStoryAssets sidecars', () => {
	const CUTOUT = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

	/**
	 * An asset with a sidecar, set up the blunt way: `importAsset` strips `sidecars` on
	 * purpose, and `replace` would drag the whole edit-options surface into a test that is
	 * only about what goes over the wire. So the manifest entry and the blob are written
	 * separately, which is exactly the pair `store.sidecar()` reads back.
	 */
	async function storeWithSidecar(
		entry: Record<string, unknown>,
		{blob = true, kind = 'cutout'}: {blob?: boolean; kind?: string} = {}
	) {
		const bytes = webpBytes();
		const backend = new MemoryBackend();
		const store = new BackedAssetStore(backend);

		await store.importAsset(await meta(bytes), new Blob([bytes]));
		await store.update('a_8f21', {
			sidecars: {[kind]: entry}
		} as unknown as Partial<AssetMeta>);

		if (blob) {
			await backend.writeBlob(`a_8f21.${kind}`, new Blob([CUTOUT]));
		}

		return {bytes, store};
	}

	async function cutoutEntry(overrides: Record<string, unknown> = {}) {
		return {
			bytes: CUTOUT.length,
			hash: await contentHash(CUTOUT),
			mime: 'image/png',
			sync: true,
			...overrides
		};
	}

	function offered(diffAssets: jest.Mock): string[] {
		const [, sent] = diffAssets.mock.calls[0] as unknown as [
			string,
			{id: string}[]
		];

		return sent.map(row => row.id);
	}

	it('offers a syncing sidecar to the diff and uploads it under <id>.<kind>', async () => {
		const {store} = await storeWithSidecar(await cutoutEntry());
		const {client, diffAssets, putAssetBlob} = fakeClient({
			missing: ['a_8f21.cutout'],
			present: ['a_8f21']
		});
		const result = await syncStoryAssets({
			client,
			story: storyReferencing(),
			store
		});

		expect(offered(diffAssets)).toEqual(['a_8f21', 'a_8f21.cutout']);

		const [, key, blob, hash, mime] = putAssetBlob.mock
			.calls[0] as unknown as [string, string, Blob, string, string];

		expect(key).toBe('a_8f21.cutout');
		expect(hash).toBe(await contentHash(CUTOUT));
		expect(mime).toBe('image/png');
		// The hash above is the manifest's claim; this is the blob actually handed over.
		expect(await contentHash(await blobBytes(blob))).toBe(
			await contentHash(CUTOUT)
		);

		// Its own channel: a sidecar is not a picture, and a caller counting uploaded art
		// must not count re-edit bases among it.
		expect(result.uploadedSidecars).toEqual(['a_8f21.cutout']);
		expect(result.uploaded).toEqual([]);
	});

	it('never offers a kind whose policy is not to sync', async () => {
		// `src` is the un-edited original -- routinely 16 MB, and wanted by nothing but
		// the device that made the edit.
		const {store} = await storeWithSidecar(await cutoutEntry(), {kind: 'src'});
		const {client, diffAssets, putAssetBlob} = fakeClient({
			present: ['a_8f21']
		});

		await syncStoryAssets({client, story: storyReferencing(), store});

		expect(offered(diffAssets)).toEqual(['a_8f21']);
		expect(putAssetBlob).not.toHaveBeenCalled();
	});

	it('offers a syncable kind whose entry was stamped before the policy said so', async () => {
		// `sync` on the entry is a record of what was true when it was WRITTEN. The
		// policy is `sidecarSyncs`, and it is the one that decides -- otherwise opting a
		// kind in would silently skip every entry that already existed.
		const {store} = await storeWithSidecar(await cutoutEntry({sync: false}));
		const {client, diffAssets} = fakeClient({present: ['a_8f21']});

		await syncStoryAssets({client, story: storyReferencing(), store});

		expect(offered(diffAssets)).toEqual(['a_8f21', 'a_8f21.cutout']);
	});

	it('never offers a sidecar with no hash, which would re-upload on every push', async () => {
		const {store} = await storeWithSidecar(
			await cutoutEntry({hash: undefined})
		);
		const {client, diffAssets, putAssetBlob} = fakeClient({
			present: ['a_8f21']
		});

		await syncStoryAssets({client, story: storyReferencing(), store});

		// The server cannot vouch for bytes nobody measured, so it answers `stale` — and a
		// row offered here every time is a blob uploaded here every time.
		expect(offered(diffAssets)).toEqual(['a_8f21']);
		expect(putAssetBlob).not.toHaveBeenCalled();
	});

	it('skips a sidecar the server already holds', async () => {
		const {store} = await storeWithSidecar(await cutoutEntry());
		const {client, putAssetBlob} = fakeClient({
			present: ['a_8f21', 'a_8f21.cutout']
		});
		const result = await syncStoryAssets({
			client,
			story: storyReferencing(),
			store
		});

		expect(putAssetBlob).not.toHaveBeenCalled();
		expect(result.uploadedSidecars).toEqual([]);
	});

	it('reports a sidecar whose blob is gone without calling the picture lost', async () => {
		const {store} = await storeWithSidecar(await cutoutEntry(), {blob: false});
		const {client, putAssetBlob, putManifest} = fakeClient({
			missing: ['a_8f21', 'a_8f21.cutout']
		});
		const result = await syncStoryAssets({
			client,
			story: storyReferencing(),
			store
		});

		expect(result.missingSidecars).toEqual(['a_8f21.cutout']);
		// The asset's own bytes are still here and still go up, and the push still finishes.
		expect(result.missingLocally).toEqual([]);
		expect(result.uploaded).toEqual(['a_8f21']);
		expect(putAssetBlob).toHaveBeenCalledTimes(1);
		expect(putManifest).toHaveBeenCalledTimes(1);
	});
});
