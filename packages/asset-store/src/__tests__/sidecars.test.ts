import type {AssetId, AssetMeta, ImageEdits} from '@sliders/scene-types';
import {AssetManifest} from '../asset-store.types';
import {MemoryBackend} from '../backends/memory-backend';
import {blobBytes} from '../blob-bytes';
import {sidecarKey} from '../ids';
import {migrateSidecars} from '../migrate-sidecars';
import {BackedAssetStore} from '../store';
import {jpegBytes, pngBytes} from '../test-fixtures';

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

function edits(overrides: Partial<ImageEdits> = {}): ImageEdits {
	return {
		brightness: -40,
		contrast: 0,
		crop: {h: 150, w: 300, x: 0, y: 0},
		gamma: 1,
		height: 150,
		width: 300,
		...overrides
	};
}

async function seeded() {
	const store = newStore();
	const id = await store.put(file(pngBytes(), 'tavern.png', 'image/png'), {
		kind: 'bg'
	});

	return {id, store};
}

describe('sidecarKey', () => {
	it('suffixes the asset id with the kind', () => {
		expect(sidecarKey('a_8f21', 'src')).toBe('a_8f21.src');
		expect(sidecarKey('a_8f21', 'cutout')).toBe('a_8f21.cutout');
	});

	it('cannot collide with an asset id', () => {
		// Ids are `a_` plus hex and names are slugged to [a-z0-9/_-], neither of which can
		// hold a dot, so a sidecar never lands on another asset's blob.
		expect(sidecarKey('a_8f21', 'cutout')).not.toMatch(/^a_[0-9a-f]+$/);
	});

	it('refuses a kind that is not a slug', () => {
		// The kind becomes a filename on both sides of the wire, and the server's ValidID
		// would refuse these -- a release later, with the blob already written.
		expect(() => sidecarKey('a_8f21', 'Cut Out')).toThrow();
		expect(() => sidecarKey('a_8f21', '../escape')).toThrow();
		expect(() => sidecarKey('a_8f21', '')).toThrow();
	});
});

describe('editing sidecars', () => {
	it('stores the edit settings and the pixels it was rendered from', async () => {
		const {id, store} = await seeded();
		const settings = edits();

		await store.replace(id, file(jpegBytes(), 'tavern.jpg', 'image/jpeg'), {
			edits: settings,
			sidecars: {src: new Blob([pngBytes()], {type: 'image/png'})}
		});

		const meta = await store.meta(id);

		expect(meta?.edits).toEqual(settings);
		expect(Object.keys(meta?.sidecars ?? {})).toEqual(['src']);
		expect(await store.sidecar(id, 'src')).toBeDefined();
		expect(await store.sidecar(id, 'cutout')).toBeUndefined();
	});

	it('measures every sidecar it writes, so sync can diff it', async () => {
		const {id, store} = await seeded();
		const cutout = new Blob(['mask'], {type: 'image/png'});
		const src = new Blob([pngBytes()], {type: 'image/webp'});

		await store.replace(id, file(jpegBytes(), 'tavern.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {cutout, src},
			tuning: {softness: 0.3, threshold: 0.5}
		});

		const meta = await store.meta(id);

		expect(await blobBytes((await store.sidecar(id, 'src'))!)).toEqual(
			await blobBytes(src)
		);
		expect(await blobBytes((await store.sidecar(id, 'cutout'))!)).toEqual(
			await blobBytes(cutout)
		);
		expect(meta?.sidecars?.cutout).toEqual({
			bytes: cutout.size,
			hash: expect.stringMatching(/^[0-9a-f]{64}$/),
			mime: 'image/png',
			sync: true
		});
		expect(meta?.sidecars?.src).toEqual({
			bytes: src.size,
			hash: expect.stringMatching(/^[0-9a-f]{64}$/),
			mime: 'image/webp',
			sync: false
		});
		expect(meta?.sidecars?.cutout?.hash).not.toBe(meta?.sidecars?.src?.hash);
	});

	it('leaves an unknown kind out of sync until somebody opts it in', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'tavern.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {depth: new Blob(['depth'], {type: 'image/png'})}
		});

		// Opt-in: a sidecar added later cannot quietly start pushing megabytes off every
		// author's machine.
		expect((await store.meta(id))?.sidecars?.depth?.sync).toBe(false);
		expect(await store.sidecar(id, 'depth')).toBeDefined();
	});

	it('records no mime when the blob carries none', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'tavern.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {cutout: new Blob(['mask'])}
		});

		expect((await store.meta(id))?.sidecars?.cutout?.mime).toBeUndefined();
	});

	it('keeps the first src through later edits', async () => {
		const {id, store} = await seeded();
		const first = new Blob([pngBytes()], {type: 'image/png'});

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {src: first}
		});

		const before = (await store.meta(id))?.sidecars?.src;

		// A second pass offers its own base -- which is the first one read back. Storing it
		// would be harmless here but wrong the moment the two ever differ, so the store
		// keeps what it has, entry included.
		await store.replace(id, file(pngBytes(), 'b.png', 'image/png'), {
			edits: edits({brightness: 10}),
			sidecars: {src: new Blob([jpegBytes()], {type: 'image/jpeg'})}
		});

		const stored = await store.sidecar(id, 'src');

		expect(await blobBytes(stored!)).toEqual(await blobBytes(first));
		expect((await store.meta(id))?.sidecars?.src).toEqual(before);
		expect((await store.meta(id))?.edits?.brightness).toBe(10);
	});

	it('replaces the cutout every time, and drops it when the removal is undone', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {
				cutout: new Blob(['first'], {type: 'image/png'}),
				src: new Blob([pngBytes()], {type: 'image/png'})
			},
			tuning: {softness: 0.3, threshold: 0.5}
		});

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {
				cutout: new Blob(['second'], {type: 'image/png'}),
				src: new Blob([pngBytes()], {type: 'image/png'})
			},
			tuning: {softness: 0.1, threshold: 0.7}
		});

		expect(await blobBytes((await store.sidecar(id, 'cutout'))!)).toEqual(
			await blobBytes(new Blob(['second'], {type: 'image/png'}))
		);
		expect((await store.meta(id))?.tuning).toEqual({
			softness: 0.1,
			threshold: 0.7
		});
	});

	it('takes the sidecars down when bytes are replaced without an edit', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {
				cutout: new Blob(['mask'], {type: 'image/png'}),
				src: new Blob([pngBytes()], {type: 'image/png'})
			},
			tuning: {softness: 0.3, threshold: 0.5}
		});

		// A plain replace is a re-upload: a different picture under the same id. The old
		// src describes pixels that have just been thrown away, and leaving it would
		// hand the editor a base belonging to something else.
		await store.replace(id, file(pngBytes(), 'different.png', 'image/png'));

		const meta = await store.meta(id);

		expect(meta?.sidecars).toBeUndefined();
		expect(meta?.edits).toBeUndefined();
		expect(meta?.tuning).toBeUndefined();
		expect(await store.sidecar(id, 'src')).toBeUndefined();
	});

	it('treats a sidecar spelled out as absent the same as one left out', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {src: new Blob([pngBytes()], {type: 'image/png'})}
		});

		await store.replace(id, file(pngBytes(), 'different.png', 'image/png'), {
			sidecars: {cutout: undefined, src: undefined}
		});

		expect((await store.meta(id))?.sidecars).toBeUndefined();
	});

	it('gives a saved-as-new asset its own base', async () => {
		const store = newStore();
		const saved = await store.putAsset(
			file(jpegBytes(), 'tavern-night.jpg', 'image/jpeg'),
			{
				edits: edits(),
				kind: 'bg',
				sidecars: {src: new Blob([pngBytes()], {type: 'image/png'})},
				sourceAsset: 'a_8f21'
			}
		);

		expect(Object.keys(saved.meta.sidecars ?? {})).toEqual(['src']);
		expect(saved.meta.sourceAsset).toBe('a_8f21');
		expect(await store.sidecar(saved.id, 'src')).toBeDefined();
	});

	it('deletes the sidecars along with the asset', async () => {
		const backend = new MemoryBackend();
		const store = new BackedAssetStore(backend);
		const id = await store.put(file(pngBytes(), 'tavern.png', 'image/png'), {
			kind: 'bg'
		});

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {
				cutout: new Blob(['mask'], {type: 'image/png'}),
				depth: new Blob(['depth'], {type: 'image/png'}),
				src: new Blob([pngBytes()], {type: 'image/png'})
			}
		});

		await store.remove(id);

		// Straight at the backend: `sidecar` reads the manifest, and the manifest entry is
		// gone either way, so it would report success over a set of leaked blobs.
		for (const kind of ['src', 'cutout', 'depth']) {
			expect(await backend.readBlob(sidecarKey(id, kind))).toBeUndefined();
		}
	});

	it('reports no sidecar for an asset that never had one', async () => {
		const {id, store} = await seeded();

		expect(await store.sidecar(id, 'src')).toBeUndefined();
		expect((await store.meta(id))?.sidecars).toBeUndefined();
	});
});

describe('migrating the old sidecar shape', () => {
	/** A manifest as a build before the sidecar record wrote it: a list, and `#` keys. */
	function legacyManifest(id: AssetId, kinds: string[]): AssetManifest {
		return {
			assets: {
				[id]: {
					animated: false,
					bytes: 8,
					edits: edits(),
					h: 150,
					hash: 'a'.repeat(64),
					id,
					kind: 'bg',
					mime: 'image/png',
					name: 'tavern',
					sidecars: kinds,
					tags: [],
					w: 300
				} as unknown as AssetMeta
			},
			characters: {},
			version: 1
		};
	}

	async function legacyBackend(id: AssetId) {
		const backend = new MemoryBackend();

		await backend.writeManifest(legacyManifest(id, ['source', 'cutout']));
		await backend.writeBlob(
			`${id}#src`,
			new Blob([pngBytes()], {type: 'image/png'})
		);
		await backend.writeBlob(
			`${id}#cutout`,
			new Blob(['mask'], {type: 'image/png'})
		);

		return backend;
	}

	it('turns the list into entries and renames the blobs', async () => {
		const backend = await legacyBackend('a_8f21');
		const store = new BackedAssetStore(backend);

		// `source` was only ever the list's word for it; the blob key already said `src`.
		expect((await store.meta('a_8f21'))?.sidecars).toEqual({
			cutout: {},
			src: {}
		});
		expect(await blobBytes((await store.sidecar('a_8f21', 'src'))!)).toEqual(
			await blobBytes(new Blob([pngBytes()]))
		);
		expect(await blobBytes((await store.sidecar('a_8f21', 'cutout'))!)).toEqual(
			await blobBytes(new Blob(['mask']))
		);
	});

	it('leaves nothing behind under the old keys', async () => {
		const backend = await legacyBackend('a_8f21');
		const store = new BackedAssetStore(backend);

		await store.meta('a_8f21');

		// A blob left under `#` is orphaned: nothing looks there again, and the sync
		// server's ValidID would refuse the key anyway.
		expect(await backend.readBlob('a_8f21#src')).toBeUndefined();
		expect(await backend.readBlob('a_8f21#cutout')).toBeUndefined();
		expect(await backend.readBlob('a_8f21.src')).toBeDefined();
		expect(await backend.readBlob('a_8f21.cutout')).toBeDefined();
	});

	it('writes the migrated manifest straight back', async () => {
		const backend = await legacyBackend('a_8f21');

		await new BackedAssetStore(backend).meta('a_8f21');

		// Once, not on every read: the next open finds today's shape and moves no bytes.
		expect((await backend.readManifest()).assets['a_8f21'].sidecars).toEqual({
			cutout: {},
			src: {}
		});
	});

	it('carries no hash, so a migrated sidecar cannot claim to be diffable', async () => {
		const backend = await legacyBackend('a_8f21');
		const store = new BackedAssetStore(backend);
		const entry = (await store.meta('a_8f21'))?.sidecars?.cutout;

		// Nothing ever recorded one, and inventing it would mean reading every stored
		// original on first open. It syncs when the next save rewrites it.
		expect(entry?.hash).toBeUndefined();
		expect(entry?.bytes).toBeUndefined();
		expect(entry?.sync).toBeUndefined();
	});

	it('drops a listed kind whose blob has gone missing', async () => {
		const backend = new MemoryBackend();

		await backend.writeManifest(legacyManifest('a_8f21', ['source', 'cutout']));
		await backend.writeBlob(
			'a_8f21#cutout',
			new Blob(['mask'], {type: 'image/png'})
		);

		const store = new BackedAssetStore(backend);

		// The manifest is what `sidecar()` and `remove()` trust. An entry naming a blob
		// nobody can read is worse than no entry.
		expect((await store.meta('a_8f21'))?.sidecars).toEqual({cutout: {}});
	});

	it('leaves an asset with no sidecars exactly as it was', async () => {
		const manifest = legacyManifest('a_8f21', []);

		delete (manifest.assets['a_8f21'] as {sidecars?: unknown}).sidecars;

		expect(await migrateSidecars(manifest, new MemoryBackend())).toBe(false);
		expect(manifest.assets['a_8f21'].sidecars).toBeUndefined();
	});

	it('does not rewrite a manifest already in today’s shape', async () => {
		const manifest = legacyManifest('a_8f21', []);

		manifest.assets['a_8f21'].sidecars = {
			cutout: {hash: 'b'.repeat(64)}
		};

		expect(await migrateSidecars(manifest, new MemoryBackend())).toBe(false);
		expect(manifest.assets['a_8f21'].sidecars).toEqual({
			cutout: {hash: 'b'.repeat(64)}
		});
	});
});

describe('importAsset', () => {
	it('drops edit settings a bundle carried, because their sidecars did not travel', async () => {
		const store = newStore();

		const stored = await store.importAsset(
			{
				animated: false,
				bytes: 8,
				edits: edits(),
				h: 150,
				hash: 'deadbeef',
				id: 'a_8f21',
				kind: 'bg',
				mime: 'image/png',
				name: 'tavern',
				sidecars: {src: {hash: 'a'.repeat(64)}},
				tags: [],
				tuning: {softness: 0.3, threshold: 0.5},
				w: 300
			},
			new Blob([pngBytes()], {type: 'image/png'})
		);

		// Kept, they would tell the editor to render the edit a second time over bytes
		// that already are it.
		expect(stored.edits).toBeUndefined();
		expect(stored.tuning).toBeUndefined();
		expect(stored.sidecars).toBeUndefined();
	});
});
