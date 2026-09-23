/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {
	BackedAssetStore,
	MemoryBackend,
	blobBytes,
	contentHash
} from '@sliders/asset-store';
import type {
	AssetMeta,
	Character,
	CutoutTuning,
	ImageEdits,
	SidecarEntry
} from '@sliders/scene-types';
import {
	jpegBytes,
	webpBytes
} from '../../../../../packages/asset-store/src/test-fixtures';
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

/** What the asset editor leaves behind. Any values will do; they only have to survive. */
const EDITS: ImageEdits = {
	brightness: 12,
	contrast: -4,
	crop: {h: 100, w: 200, x: 0, y: 0},
	gamma: 1,
	height: 100,
	width: 200
};

const TUNING: CutoutTuning = {softness: 0.2, threshold: 0.6};

/** A manifest's record of a sidecar the server holds bytes for. */
async function sidecarEntry(
	bytes: Uint8Array,
	overrides: Partial<SidecarEntry> = {}
): Promise<SidecarEntry> {
	return {
		bytes: bytes.length,
		hash: await contentHash(bytes),
		mime: 'image/png',
		sync: true,
		...overrides
	};
}

function fakeClient(options: {
	manifest?: Partial<AssetManifest>;
	manifestError?: Error;
	blob?: Blob;
	/** Keyed by what the server is asked for: an asset id, or `<id>.<kind>`. */
	blobs?: Record<string, Blob>;
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
	const getAssetBlob = jest.fn(async (_storyId: string, key: string) => {
		if (options.blobs) {
			const found = options.blobs[key];

			if (!found) {
				throw new Error(`no bytes for ${key}`);
			}

			return found;
		}

		return options.blob ?? new Blob([webpBytes()], {type: 'image/webp'});
	});

	return {
		client: {getAssetBlob, getManifest} as unknown as ServerClient,
		getAssetBlob,
		getManifest
	};
}

function character(overrides: Partial<Character> = {}): Character {
	return {
		poses: {idle: 'a_8f21'},
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
		expect((await store.list({includePoseImages: true})).length).toBe(1);
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

	/**
	 * The other half of the guard above, and the reason it had to be widened: an edit
	 * leaves the pixels alone. Keyed on bytes alone this asset is "already here" forever,
	 * and the author's second machine never hears that the picture was edited at all.
	 */
	it('takes provenance from an asset whose bytes are already here', async () => {
		const bytes = webpBytes();
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'tavern.webp', {type: 'image/webp'}),
			{kind: 'bg'}
		);
		const {client, getAssetBlob} = fakeClient({
			manifest: {
				assets: [
					await meta(bytes, {
						edits: EDITS,
						hash: saved.meta.hash,
						id: 'a_other',
						tuning: TUNING
					})
				],
				rev: 9
			}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		expect(result.changed).toBe(true);
		expect(result.skipped).toBe(false);
		// Onto the LOCAL asset, under the local id. The manifest's `a_other` is another
		// library's name for these bytes and is never written here.
		expect(await store.meta(saved.id)).toMatchObject({
			edits: EDITS,
			id: saved.id,
			tuning: TUNING
		});
		// The bytes were already here, so nothing was fetched for them.
		expect(getAssetBlob).not.toHaveBeenCalled();
	});

	/**
	 * Rule 3 of the sync model, asserted head on. `id`, `name`, `w` and `h` all differ
	 * between two libraries holding one picture, permanently — a compare that reads any of
	 * them reports a change on every poll, and two clients push art at each other forever.
	 */
	it('reports nothing when only id, name and size differ', async () => {
		const bytes = webpBytes();
		const cutout = new Uint8Array([1, 2, 3, 4]);
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'tavern.webp', {type: 'image/webp'}),
			{kind: 'bg'}
		);

		await store.applySyncedProvenance(saved.id, {
			edits: EDITS,
			sidecars: {cutout: new Blob([cutout], {type: 'image/png'})},
			tuning: TUNING
		});

		const {client, getAssetBlob} = fakeClient({
			manifest: {
				assets: [
					await meta(bytes, {
						edits: EDITS,
						h: 512,
						hash: saved.meta.hash,
						id: 'a_other',
						name: 'tavern/night-2',
						sidecars: {cutout: await sidecarEntry(cutout)},
						tuning: TUNING,
						w: 1024
					})
				],
				rev: 9
			}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		expect(result.changed).toBe(false);
		expect(result.skipped).toBe(true);
		expect(getAssetBlob).not.toHaveBeenCalled();
	});

	it('cannot see a sidecar whose kind does not sync', async () => {
		const bytes = webpBytes();
		const original = new Uint8Array([7, 7, 7]);
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'tavern.webp', {type: 'image/webp'}),
			{kind: 'bg'}
		);
		const {client, getAssetBlob} = fakeClient({
			manifest: {
				assets: [
					await meta(bytes, {
						hash: saved.meta.hash,
						id: 'a_other',
						sidecars: {src: await sidecarEntry(original, {sync: false})}
					})
				],
				rev: 9
			}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		// `src` never crosses the wire, so the sender's library names one and this one
		// never can. Compared, the two would differ by construction and forever.
		expect(result.changed).toBe(false);
		expect(result.skipped).toBe(true);
		expect(getAssetBlob).not.toHaveBeenCalled();
	});

	it('follows a cutout the other client undid', async () => {
		const bytes = webpBytes();
		const cutout = new Uint8Array([4, 5, 6]);
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'tavern.webp', {type: 'image/webp'}),
			{kind: 'bg'}
		);

		await store.applySyncedProvenance(saved.id, {
			sidecars: {cutout: new Blob([cutout], {type: 'image/png'})},
			tuning: TUNING
		});

		const {client} = fakeClient({
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

		// A manifest that names no cutout for bytes both sides hold is the author having
		// undone the background removal. Deletion is the whole mechanism, not a side effect.
		expect(result.changed).toBe(true);
		expect(await store.sidecar(saved.id, 'cutout')).toBeUndefined();
		expect((await store.meta(saved.id))?.tuning).toBeUndefined();
	});

	it('still skips an id the server has no bytes for, provenance or not', async () => {
		const bytes = webpBytes();
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'tavern.webp', {type: 'image/webp'}),
			{kind: 'bg'}
		);
		const {client, getAssetBlob} = fakeClient({
			manifest: {
				assets: [
					await meta(bytes, {
						edits: EDITS,
						hash: saved.meta.hash,
						id: 'a_gone'
					})
				],
				missing: ['a_gone'],
				rev: 9
			}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		// The server is admitting the asset is gone; its manifest row is all that is left.
		// Comparing a local twin against a ghost would want a download on every poll.
		expect(result.changed).toBe(false);
		expect(result.skipped).toBe(true);
		expect(getAssetBlob).not.toHaveBeenCalled();
		expect((await store.meta(saved.id))?.edits).toBeUndefined();
	});

	it('reports no change when the sidecar the manifest names will not come down', async () => {
		const bytes = webpBytes();
		const cutout = new Uint8Array([1, 1, 2, 3]);
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'tavern.webp', {type: 'image/webp'}),
			{kind: 'bg'}
		);
		const {client} = fakeClient({
			// Every key 404s: the asset's own bytes are never asked for, the cutout is.
			blobs: {},
			manifest: {
				assets: [
					await meta(bytes, {
						hash: saved.meta.hash,
						id: 'a_other',
						sidecars: {cutout: await sidecarEntry(cutout)}
					})
				],
				rev: 9
			}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		// The difference stands — nothing landed, so nothing is reported as changed. A
		// `changed` here would fire a refresh, schedule a push, and be back on the next rev
		// asking for the same blob the server does not have.
		expect(result.changed).toBe(false);
		expect(result.missingSidecars).toEqual(['a_other.cutout']);
	});

	/**
	 * The test that actually proves there is no ping-pong: apply a pull, then run the same
	 * pull again over the same manifest. A metadata round trip has to be a fixpoint, or the
	 * two clients take turns waking each other every three seconds on every synced story.
	 */
	it('is a fixpoint — the same manifest pulled twice changes nothing the second time', async () => {
		const bytes = webpBytes();
		const cutout = new Uint8Array([2, 4, 8, 16]);
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'tavern.webp', {type: 'image/webp'}),
			{kind: 'bg'}
		);
		const incoming = await meta(bytes, {
			edits: EDITS,
			hash: saved.meta.hash,
			id: 'a_other',
			name: 'tavern/night-2',
			sidecars: {cutout: await sidecarEntry(cutout)},
			tuning: TUNING
		});
		const {client} = fakeClient({
			blobs: {'a_other.cutout': new Blob([cutout], {type: 'image/png'})},
			manifest: {assets: [incoming], rev: 9}
		});

		const first = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		expect(first.changed).toBe(true);
		expect((await store.sidecar(saved.id, 'cutout'))?.size).toBe(cutout.length);

		// Same manifest, and `lastRev` deliberately not the rev it carries: the library
		// compare has to be the thing that stops this, not the cheap rev guard in front.
		const second = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		expect(second.changed).toBe(false);
		expect(second.skipped).toBe(true);
	});

	it('lands a walk area and a mask drawn on the other side, then stops', async () => {
		const bytes = webpBytes();
		const store = newStore();
		const saved = await store.putAsset(
			new File([bytes], 'tavern.webp', {type: 'image/webp'}),
			{kind: 'bg'}
		);
		const walk = {
			depth: {far: {scale: 0.5, y: 0.5}, near: {scale: 1, y: 0.95}},
			shapes: [
				{
					id: 's1',
					op: 'walk' as const,
					points: [
						{x: 0.1, y: 0.5},
						{x: 0.9, y: 0.5},
						{x: 0.9, y: 0.95}
					]
				}
			]
		};
		const mask = {
			shapes: [
				{
					feather: 0,
					id: 's1',
					op: 'cut' as const,
					points: [
						{x: 0.1, y: 0.1},
						{x: 0.2, y: 0.1},
						{x: 0.2, y: 0.2}
					]
				}
			]
		};
		const {client} = fakeClient({
			manifest: {
				assets: [
					await meta(bytes, {hash: saved.meta.hash, id: 'a_other', mask, walk})
				],
				rev: 9
			}
		});

		const first = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		expect(first.changed).toBe(true);
		expect(await store.meta(saved.id)).toMatchObject({mask, walk});

		const second = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 'story-1'
		});

		expect(second.changed).toBe(false);
	});

	it('reports no change when the plan drops the bytes it fetched', async () => {
		// A name clash: the library already has `tavern/night`, holding different bytes.
		// `planBundle` settles that `kept-existing` -- the local asset stays, the incoming
		// one is dropped -- so the download happened and the library gained nothing.
		const store = newStore();
		const local = webpBytes(320, 240);

		await store.importAsset(
			await meta(local, {hash: await contentHash(local), id: 'a_local'}),
			new Blob([local])
		);

		const incoming = jpegBytes();
		const {client} = fakeClient({
			blob: new Blob([incoming], {type: 'image/jpeg'}),
			manifest: {
				assets: [
					await meta(incoming, {
						hash: await contentHash(incoming),
						id: 'a_far',
						mime: 'image/jpeg',
						name: 'tavern/night'
					})
				],
				rev: 9
			}
		});

		const result = await pullStoryAssets({client, store, storyId: 'story-1'});

		// Reported as a change, this fires `refreshAssetLibrary`, which schedules a push,
		// and that push writes THIS library's older manifest over the one the other editor
		// just published -- their edit gone from the server, silently.
		expect(result.changed).toBe(false);
		expect(result.warnings.length).toBeGreaterThan(0);
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

/**
 * A `replace` on the far side: same id, same name, new bytes. No dedupe twin, so before
 * the fast-forward the plan settled it `kept-existing` and this side kept the old pixels
 * forever. See docs/2026-09-23-asset-sync-bytes.md.
 */
describe('pullStoryAssets fast-forward', () => {
	const GLITCH = {
		amount: 40,
		bands: 6,
		burst: 0.5,
		kind: 'glitch' as const,
		noise: 10,
		period: 2,
		rotate: 0,
		scanlines: 20,
		speed: 12,
		split: 30
	};

	/** This device's copy, under the server's id, as a checkout leaves it. */
	async function held(
		store: BackedAssetStore,
		bytes: Uint8Array,
		overrides: Partial<AssetMeta> = {}
	) {
		return await store.importAsset(
			await meta(bytes, overrides),
			new Blob([bytes], {type: 'image/webp'})
		);
	}

	async function bytesOf(store: BackedAssetStore, id: string) {
		return new Uint8Array(await blobBytes((await store.get(id)) as Blob));
	}

	it('lands an effect-only change, then stops', async () => {
		const bytes = webpBytes();
		const store = newStore();
		const local = await held(store, bytes);
		const {client, getAssetBlob} = fakeClient({
			manifest: {assets: [await meta(bytes, {effect: GLITCH})], rev: 9}
		});

		const first = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 's'
		});

		expect(first.changed).toBe(true);
		expect((await store.meta(local.id))?.effect).toEqual(GLITCH);

		const second = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 's'
		});

		expect(second.changed).toBe(false);
		expect(second.skipped).toBe(true);
		expect(getAssetBlob).not.toHaveBeenCalled();
	});

	it.each([
		['no synced base', false],
		['a base equal to the local hash', true]
	])('fast-forwards untouched bytes (%s)', async (_, withBase) => {
		const old = webpBytes();
		const next = jpegBytes();
		const cutout = new Uint8Array([9, 8, 7]);
		const store = newStore();
		const local = await held(store, old, {tags: ['night']});
		const row = await meta(next, {
			edits: EDITS,
			effect: GLITCH,
			h: 150,
			mime: 'image/jpeg',
			sidecars: {cutout: await sidecarEntry(cutout)},
			tags: ['far'],
			tuning: TUNING,
			w: 300
		});
		const {client, getAssetBlob} = fakeClient({
			blobs: {
				[row.id]: new Blob([next], {type: 'image/jpeg'}),
				[`${row.id}.cutout`]: new Blob([cutout], {type: 'image/png'})
			},
			manifest: {assets: [row], rev: 9}
		});

		const first = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 's',
			syncedHashes: withBase ? new Map([[local.id, local.hash]]) : undefined
		});

		expect(first.changed).toBe(true);
		expect(first.warnings).toEqual([]);
		expect(first.syncedHashes).toEqual(new Map([[row.id, row.hash]]));
		// One asset, same id and name, new bytes, far side's provenance landed.
		expect(await store.list({includePoseImages: true})).toHaveLength(1);
		expect(await store.meta(local.id)).toMatchObject({
			edits: EDITS,
			effect: GLITCH,
			hash: row.hash,
			id: local.id,
			name: local.name,
			tags: ['night'],
			tuning: TUNING,
			w: 300
		});
		expect(await bytesOf(store, local.id)).toEqual(next);
		expect((await store.sidecar(local.id, 'cutout'))?.size).toBe(cutout.length);

		const calls = getAssetBlob.mock.calls.length;
		const second = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 's',
			syncedHashes: first.syncedHashes
		});

		expect(second.changed).toBe(false);
		expect(second.skipped).toBe(true);
		expect(getAssetBlob).toHaveBeenCalledTimes(calls);
	});

	it('leaves bytes this device replaced since the last sync', async () => {
		const base = webpBytes();
		const mine = webpBytes(320, 240);
		const theirs = jpegBytes();
		const store = newStore();
		const local = await held(store, mine);
		const row = await meta(theirs, {mime: 'image/jpeg'});
		const {client, getAssetBlob} = fakeClient({
			manifest: {assets: [row], rev: 9}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 's',
			syncedHashes: new Map([[local.id, await contentHash(base)]])
		});

		// Local is ahead; the push side sends it. Nothing fetched, nothing to warn about.
		expect(result.changed).toBe(false);
		expect(result.warnings).toEqual([]);
		expect(getAssetBlob).not.toHaveBeenCalled();
		expect(await bytesOf(store, local.id)).toEqual(mine);
		expect((await store.meta(local.id))?.hash).toBe(local.hash);
		expect(result.syncedHashes.get(local.id)).toBe(row.hash);
	});

	it('keeps the old base when the newer bytes will not come down', async () => {
		const old = webpBytes();
		const store = newStore();
		const local = await held(store, old);
		const row = await meta(jpegBytes(), {mime: 'image/jpeg'});
		const {client} = fakeClient({
			blobs: {},
			manifest: {assets: [row], rev: 9}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 's'
		});

		expect(result.changed).toBe(false);
		expect(result.missing).toEqual([row.id]);
		expect(await bytesOf(store, local.id)).toEqual(old);
		// Not the server's hash: that would read the old bytes as a local edit next time,
		// and the push side would send them over the newer ones.
		expect(result.syncedHashes.get(row.id)).toBe(local.hash);
	});

	it('moves a pose image forward and leaves the character intact', async () => {
		const old = webpBytes();
		const next = jpegBytes();
		const store = newStore();
		const pose = {
			kind: 'frame' as const,
			name: 'mira-idle',
			ownerCharacter: 'mira'
		};
		const local = await held(store, old, pose);
		const mira = character({poses: {idle: {asset: local.id}}});

		await store.putCharacter(mira);

		const before = await store.getCharacter('mira');
		const row = await meta(next, {...pose, mime: 'image/jpeg'});
		const {client} = fakeClient({
			blobs: {[row.id]: new Blob([next], {type: 'image/jpeg'})},
			manifest: {assets: [row], characters: [mira], rev: 9}
		});

		const result = await pullStoryAssets({
			client,
			lastRev: 8,
			store,
			storyId: 's'
		});

		expect(result.changed).toBe(true);
		// The cast merge always says so; what must not appear is a dropped pose.
		expect(result.warnings.join('\n')).not.toMatch(/has no image/);
		expect(await store.list({includePoseImages: true})).toHaveLength(1);
		expect(await store.meta(local.id)).toMatchObject({
			hash: row.hash,
			ownerCharacter: 'mira'
		});
		expect(await bytesOf(store, local.id)).toEqual(next);
		expect(await store.getCharacter('mira')).toEqual(before);
	});
});
