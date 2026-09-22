import {
	BackedAssetStore,
	MemoryBackend,
	contentHash
} from '@sliders/asset-store';
import type {AssetMeta, Character, ImageEdits} from '@sliders/scene-types';
import {webpBytes} from '../../../../../packages/asset-store/src/test-fixtures';
import {checkoutStory} from '../checkout-story';
import type {ServerClient} from '../client';
import {resetSyncRecordsForTests, syncRecord} from '../sync-record';
import {testStory} from '../test-fixtures';
import type {StoriesAction} from '../../../stories';

// jsdom ships getRandomValues but not SubtleCrypto, which `contentHash` needs.
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

beforeEach(() => {
	window.localStorage.clear();
	resetSyncRecordsForTests();
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

/** What the asset editor leaves behind. Any value will do; it only has to survive. */
const EDITS: ImageEdits = {
	brightness: 12,
	contrast: -4,
	crop: {h: 100, w: 200, x: 0, y: 0},
	gamma: 1,
	height: 100,
	width: 200
};

function character(overrides: Partial<Character> = {}): Character {
	return {
		frames: {},
		id: 'mira',
		name: 'Mira',
		origin: {x: 0.5, y: 1},
		size: {h: 1024, w: 512},
		tags: [],
		...overrides
	};
}

interface FakeServer {
	client: ServerClient;
	getAssetBlob: jest.Mock;
	dispatched: StoriesAction[];
}

function fakeServer(options: {
	assets: AssetMeta[];
	characters?: Character[];
	missing?: string[];
	blobs?: Record<string, Blob>;
	manifestError?: Error;
}): FakeServer {
	const dispatched: StoriesAction[] = [];
	const getAssetBlob = jest.fn(async (_storyId: string, assetId: string) => {
		const blob = options.blobs?.[assetId];

		if (!blob) {
			throw new Error(`no bytes for ${assetId}`);
		}

		return blob;
	});
	const client = {
		getAssetBlob,
		getManifest: jest.fn(async () => {
			if (options.manifestError) {
				throw options.manifestError;
			}

			return {
				assets: options.assets,
				characters: options.characters ?? [],
				missing: options.missing ?? [],
				rev: 7,
				version: 1
			};
		}),
		getStory: jest.fn(async () => ({
			rev: 43,
			story: testStory({id: 'story-1', name: 'Lighthouse'})
		}))
	} as unknown as ServerClient;

	return {client, dispatched, getAssetBlob};
}

describe('checkoutStory', () => {
	it('inserts the story under the server id and ifid, synced', async () => {
		const {client, dispatched} = fakeServer({assets: []});
		const store = newStore();

		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store,
			storyId: 'story-1'
		});

		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]).toMatchObject({
			props: {id: 'story-1', ifid: 'IFID-1', sync: true},
			type: 'createStory'
		});
		expect(result.rev).toBe(43);
		expect(syncRecord('story-1')).toMatchObject({rev: 43, state: 'idle'});
	});

	it('records the pushed hash so a fresh checkout is not instantly dirty', async () => {
		const {client, dispatched} = fakeServer({assets: []});

		await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store: newStore(),
			storyId: 'story-1'
		});

		expect(syncRecord('story-1')?.pushedHash).not.toBe('');
	});

	it('renames around a local story that already owns the name', async () => {
		const {client, dispatched} = fakeServer({assets: []});

		await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [testStory({id: 'other', name: 'Lighthouse'})],
			store: newStore(),
			storyId: 'story-1'
		});

		expect(dispatched[0]).toMatchObject({
			props: {id: 'story-1', name: 'Lighthouse 1'}
		});
	});

	it('downloads the assets the manifest names and writes real bytes', async () => {
		const bytes = webpBytes();
		const assetMeta = await meta(bytes);
		const {client, dispatched, getAssetBlob} = fakeServer({
			assets: [assetMeta],
			blobs: {a_8f21: new Blob([bytes])},
			characters: [character({frames: {happy: {asset: 'a_8f21'}}})]
		});
		const store = newStore();

		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store,
			storyId: 'story-1'
		});

		expect(getAssetBlob).toHaveBeenCalledTimes(1);
		expect(result.downloaded).toEqual(['a_8f21']);
		expect(await store.meta('a_8f21')).toMatchObject({name: 'tavern/night'});
		expect((await store.get('a_8f21'))?.size).toBe(bytes.length);
		expect((await store.getCharacter('mira'))?.frames.happy.asset).toBe(
			'a_8f21'
		);
	});

	it('reports bytes the server does not have instead of throwing', async () => {
		const bytes = webpBytes();
		const present = await meta(bytes);
		const swept = await meta(bytes, {id: 'a_dead', name: 'gone'});
		const {client, dispatched, getAssetBlob} = fakeServer({
			assets: [present, swept],
			blobs: {a_8f21: new Blob([bytes])},
			missing: ['a_dead']
		});
		const store = newStore();

		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store,
			storyId: 'story-1'
		});

		expect(result.missingAssets).toEqual(['a_dead']);
		// The server said up front it did not have them, so nothing was even attempted.
		expect(getAssetBlob).toHaveBeenCalledTimes(1);
		expect(await store.meta('a_dead')).toBeUndefined();
		expect(await store.meta('a_8f21')).toBeDefined();
	});

	it('reports a download that fails partway rather than losing the rest', async () => {
		const bytes = webpBytes();
		const good = await meta(bytes);
		const bad = await meta(webpBytes(300, 200), {
			id: 'a_bad',
			name: 'broken'
		});
		const {client, dispatched} = fakeServer({
			assets: [bad, good],
			blobs: {a_8f21: new Blob([bytes])}
		});
		const store = newStore();

		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store,
			storyId: 'story-1'
		});

		expect(result.missingAssets).toEqual(['a_bad']);
		expect(result.downloaded).toEqual(['a_8f21']);
		expect(await store.meta('a_8f21')).toBeDefined();
	});

	it('survives a story published before it had a manifest', async () => {
		const {client, dispatched} = fakeServer({
			assets: [],
			manifestError: new Error('not_found')
		});

		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store: newStore(),
			storyId: 'story-1'
		});

		expect(result.warnings).toEqual(['not_found']);
		expect(result.missingAssets).toEqual([]);
	});

	it('downloads a sidecar under <id>.<kind> and lands the settings with it', async () => {
		const bytes = webpBytes();
		const cutout = new Uint8Array([1, 2, 3, 4, 5]);
		const edited = await meta(bytes, {
			edits: EDITS,
			sidecars: {
				cutout: {
					bytes: cutout.length,
					hash: await contentHash(cutout),
					mime: 'image/png',
					sync: true
				}
			}
		});
		const {client, dispatched, getAssetBlob} = fakeServer({
			assets: [edited],
			blobs: {
				a_8f21: new Blob([bytes]),
				'a_8f21.cutout': new Blob([cutout], {type: 'image/png'})
			}
		});
		const store = newStore();

		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store,
			storyId: 'story-1'
		});

		expect(getAssetBlob.mock.calls.map(call => call[1])).toEqual([
			'a_8f21',
			'a_8f21.cutout'
		]);
		expect(result.missingSidecars).toEqual([]);
		// The picture is not enough. Without these two the asset editor opens on baked
		// pixels with its controls at zero, and the edit can be stacked on but never undone.
		expect(await store.meta('a_8f21')).toMatchObject({edits: EDITS});
		expect((await store.sidecar('a_8f21', 'cutout'))?.size).toBe(cutout.length);
	});

	it('leaves the asset alone when its sidecar will not come down', async () => {
		const bytes = webpBytes();
		const cutout = new Uint8Array([1, 2, 3]);
		const edited = await meta(bytes, {
			edits: EDITS,
			sidecars: {
				cutout: {
					bytes: cutout.length,
					hash: await contentHash(cutout),
					sync: true
				}
			}
		});
		const {client, dispatched} = fakeServer({
			assets: [edited],
			blobs: {a_8f21: new Blob([bytes])}
		});
		const store = newStore();

		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store,
			storyId: 'story-1'
		});

		// A lost sidecar costs re-editability, not the picture — so it is reported on its
		// own channel and the asset, its bytes and the settings that did arrive all stand.
		expect(result.missingSidecars).toEqual(['a_8f21.cutout']);
		expect(result.missingAssets).toEqual([]);
		expect(result.downloaded).toEqual(['a_8f21']);
		expect((await store.get('a_8f21'))?.size).toBe(bytes.length);
		expect(await store.meta('a_8f21')).toMatchObject({edits: EDITS});
		expect(await store.sidecar('a_8f21', 'cutout')).toBeUndefined();
	});

	it('never asks for a sidecar whose kind does not sync', async () => {
		const bytes = webpBytes();
		const original = new Uint8Array([9, 9, 9]);
		const edited = await meta(bytes, {
			sidecars: {
				src: {
					bytes: original.length,
					hash: await contentHash(original),
					sync: false
				}
			}
		});
		const {client, dispatched, getAssetBlob} = fakeServer({
			assets: [edited],
			blobs: {a_8f21: new Blob([bytes])}
		});

		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store: newStore(),
			storyId: 'story-1'
		});

		// `src` is the un-edited original and never leaves the device that made the edit,
		// so the key names bytes the server was never given. Asking would 404 every time.
		expect(getAssetBlob.mock.calls.map(call => call[1])).toEqual(['a_8f21']);
		expect(result.missingSidecars).toEqual([]);
	});

	it('does not re-download bytes the local library already holds', async () => {
		const bytes = webpBytes();
		const assetMeta = await meta(bytes);
		const store = newStore();

		await store.importAsset(assetMeta, new Blob([bytes]));

		const {client, dispatched, getAssetBlob} = fakeServer({
			assets: [assetMeta],
			blobs: {a_8f21: new Blob([bytes])}
		});

		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			store,
			storyId: 'story-1'
		});

		expect(getAssetBlob).not.toHaveBeenCalled();
		expect(result.downloaded).toEqual([]);
		expect(await store.meta('a_8f21')).toBeDefined();
	});
});
