import {
	BackedAssetStore,
	MemoryBackend,
	contentHash
} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
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
