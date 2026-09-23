import type {
	AssetId,
	AssetMask,
	AssetMeta,
	ImageEdits
} from '@sliders/scene-types';
import {AssetManifest} from '../asset-store.types';
import {MemoryBackend} from '../backends/memory-backend';
import {blobBytes} from '../blob-bytes';
import {contentHash, sidecarKey} from '../ids';
import {migrateSidecars} from '../migrate-sidecars';
import {BackedAssetStore, sidecarSyncs} from '../store';
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

function mask(overrides: Partial<AssetMask['shapes'][number]> = {}): AssetMask {
	return {
		shapes: [
			{
				feather: 0.02,
				id: 'm1',
				op: 'cut',
				points: [
					{x: 0.1, y: 0.1},
					{x: 0.9, y: 0.12},
					{x: 0.5, y: 0.8}
				],
				...overrides
			}
		]
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

	it('replaces the cutout every time', async () => {
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

	it('drops a cutout the save spells out as null, and keeps the src beside it', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {
				cutout: new Blob(['mask'], {type: 'image/png'}),
				src: new Blob([pngBytes()], {type: 'image/png'})
			},
			tuning: {softness: 0.3, threshold: 0.5}
		});

		// What the editor sends once the author undoes the background removal.
		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {cutout: null, src: new Blob([pngBytes()], {type: 'image/png'})}
		});

		const meta = await store.meta(id);

		// Both halves, because the manifest entry is the one that matters twice over:
		// `sidecar()` trusts it, and it is what keeps the server's orphan sweep off the
		// blob. Left behind, the bytes are wanted forever by nobody.
		expect(meta?.sidecars?.cutout).toBeUndefined();
		expect(await store.sidecar(id, 'cutout')).toBeUndefined();
		expect(meta?.tuning).toBeUndefined();

		// The re-edit base is untouched: undoing a cutout is not a re-upload.
		expect(meta?.sidecars?.src).toBeDefined();
		expect(await store.sidecar(id, 'src')).toBeDefined();
	});

	it('drops a null kind even when nothing else is offered', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {
				cutout: new Blob(['mask'], {type: 'image/png'}),
				src: new Blob([pngBytes()], {type: 'image/png'})
			}
		});

		// A deletion is something the call MENTIONS, so this is not the bare re-upload
		// below -- it must not take the src down with it.
		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			sidecars: {cutout: null}
		});

		expect(await store.sidecar(id, 'cutout')).toBeUndefined();
		expect(await store.sidecar(id, 'src')).toBeDefined();
	});

	it('leaves a cutout alone when the save names it undefined', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {cutout: new Blob(['mask'], {type: 'image/png'})},
			tuning: {softness: 0.3, threshold: 0.5}
		});

		// An edit that did not touch the cutout. The difference from `null` is the whole
		// point of the three-way split.
		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {cutout: undefined},
			tuning: {softness: 0.3, threshold: 0.5}
		});

		expect(await store.sidecar(id, 'cutout')).toBeDefined();
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

	it('carries the hand mask onto a newly uploaded asset', async () => {
		const store = newStore();
		const drawn = mask();
		const saved = await store.putAsset(
			file(jpegBytes(), 'tavern-hole.jpg', 'image/jpeg'),
			{
				edits: edits(),
				kind: 'bg',
				mask: drawn,
				sidecars: {src: new Blob([pngBytes()], {type: 'image/png'})}
			}
		);

		// Metadata, so it comes back off the manifest rather than out of a sidecar.
		expect(saved.meta.mask).toEqual(drawn);
		expect((await store.meta(saved.id))?.mask).toEqual(drawn);
	});

	it('overwrites the hand mask on a replace, and clears it on a re-upload', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			mask: mask(),
			sidecars: {src: new Blob([pngBytes()], {type: 'image/png'})}
		});

		expect((await store.meta(id))?.mask).toEqual(mask());

		const moved = mask({
			op: 'keep',
			points: [
				{x: 0.2, y: 0.2},
				{x: 0.8, y: 0.2},
				{x: 0.5, y: 0.7}
			]
		});

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			mask: moved,
			sidecars: {src: new Blob([pngBytes()], {type: 'image/png'})}
		});

		expect((await store.meta(id))?.mask).toEqual(moved);

		// Same rule as `edits` and `tuning`: a replace naming none of them is a
		// re-upload, and holes drawn on the old picture do not belong on this one.
		await store.replace(id, file(pngBytes(), 'different.png', 'image/png'));

		expect((await store.meta(id))?.mask).toBeUndefined();
	});

	it('keeps the base sidecar for a save that carries nothing but a mask', async () => {
		const {id, store} = await seeded();
		const base = new Blob([pngBytes()], {type: 'image/png'});

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {src: base}
		});

		// A mask is metadata, not a sidecar -- but its points are fractions OF the base.
		// Treating this as a re-upload would drop the base and leave holes that can only
		// ever be re-cut into bytes that already have them.
		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			mask: mask()
		});

		const meta = await store.meta(id);

		expect(meta?.mask).toEqual(mask());
		expect(Object.keys(meta?.sidecars ?? {})).toEqual(['src']);
		expect(await blobBytes((await store.sidecar(id, 'src'))!)).toEqual(
			await blobBytes(base)
		);
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
				mask: mask(),
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
		// The mask for the same reason: the bundle's bytes already have the hole in them.
		expect(stored.mask).toBeUndefined();
	});
});

describe('sidecarSyncs', () => {
	it('answers per kind, and denies by default', () => {
		expect(sidecarSyncs('cutout')).toBe(true);
		// The un-edited original: routinely 16 MB, wanted by nothing but this device.
		expect(sidecarSyncs('src')).toBe(false);
		// Opting in is a deliberate act, so a kind somebody adds next year cannot
		// quietly start pushing megabytes off every author's machine.
		expect(sidecarSyncs('depth')).toBe(false);
	});
});

describe('applySyncedProvenance', () => {
	/** An asset that has been edited here: a local `src`, a local `cutout`, settings. */
	async function edited() {
		const backend = new MemoryBackend();
		const store = new BackedAssetStore(backend);
		const id = await store.put(file(pngBytes(), 'tavern.png', 'image/png'), {
			kind: 'bg'
		});

		await store.replace(id, file(jpegBytes(), 'tavern.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {
				cutout: new Blob(['local mask'], {type: 'image/png'}),
				src: new Blob([pngBytes()], {type: 'image/png'})
			},
			tuning: {softness: 0.3, threshold: 0.5}
		});

		return {backend, id, store};
	}

	it('lands the far side’s hand-drawn mask, and clears one they erased', async () => {
		const {id, store} = await edited();
		const drawn = mask();

		// A mask is metadata, so it rides the manifest rather than a blob -- but only
		// because it is in the compared surface. Left out, the far side would draw a
		// hole and this machine would never hear about it.
		expect((await store.applySyncedProvenance(id, {mask: drawn})).mask).toEqual(
			drawn
		);

		// Absent means erased, the same as every other field here: provenance replaces
		// wholesale rather than merging.
		expect((await store.applySyncedProvenance(id, {})).mask).toBeUndefined();
	});

	it('lands the far side’s settings without touching the bytes', async () => {
		const {id, store} = await edited();
		const before = await store.meta(id);
		const incoming = edits({brightness: 25, gamma: 1.4});

		const meta = await store.applySyncedProvenance(id, {
			edits: incoming,
			origin: {x: 0.25, y: 0.75},
			tuning: {softness: 0.1, threshold: 0.9}
		});

		expect(meta.edits).toEqual(incoming);
		expect(meta.tuning).toEqual({softness: 0.1, threshold: 0.9});
		expect(meta.origin).toEqual({x: 0.25, y: 0.75});

		// The precondition of the whole call: these bytes were already right, which is
		// why provenance may land on them at all.
		expect(meta.hash).toBe(before?.hash);
		expect(meta.bytes).toBe(before?.bytes);
		expect(await blobBytes((await store.get(id))!)).toEqual(
			await blobBytes(new Blob([jpegBytes()]))
		);
		expect(await store.meta(id)).toEqual(meta);
	});

	it('writes an arriving cutout and measures it like any other', async () => {
		const {id, store} = await edited();
		const cutout = new Blob(['their mask'], {type: 'image/png'});

		const meta = await store.applySyncedProvenance(id, {
			sidecars: {cutout},
			tuning: {softness: 0.2, threshold: 0.4}
		});

		// Same `{bytes, hash, mime, sync}` a local save records -- sync diffs sidecars
		// on exactly that pair, so a landed one has to be diffable too.
		expect(meta.sidecars?.cutout).toEqual({
			bytes: cutout.size,
			hash: expect.stringMatching(/^[0-9a-f]{64}$/),
			mime: 'image/png',
			sync: true
		});
		expect(await blobBytes((await store.sidecar(id, 'cutout'))!)).toEqual(
			await blobBytes(cutout)
		);
	});

	it('deletes a cutout the pull no longer carries, blob and entry', async () => {
		const {backend, id, store} = await edited();

		// What arrives once the author undid the background removal on the other
		// machine. Omission is the only way that fact can travel.
		const meta = await store.applySyncedProvenance(id, {edits: edits()});

		expect(meta.sidecars?.cutout).toBeUndefined();
		expect(await store.sidecar(id, 'cutout')).toBeUndefined();
		// Straight at the backend: `sidecar()` reads the manifest, so it would report
		// success over a leaked blob.
		expect(await backend.readBlob(sidecarKey(id, 'cutout'))).toBeUndefined();
	});

	it('keeps a hashless cutout the far side has never seen', async () => {
		const {backend, id, store} = await edited();

		// A migrated entry: `migrateSidecars` names the blob and nothing else, because
		// nothing ever measured it. Without a hash it cannot be diffed, so it has never
		// crossed the wire and the sender cannot have meant to drop it.
		await store.update(id, {
			sidecars: {...(await store.meta(id))?.sidecars, cutout: {}}
		});

		// A pull about something else entirely -- the settings moved, the cutout was
		// never mentioned either way.
		const meta = await store.applySyncedProvenance(id, {
			edits: edits({brightness: 25})
		});

		expect(meta.sidecars?.cutout).toEqual({});
		expect(await backend.readBlob(sidecarKey(id, 'cutout'))).toBeDefined();
		// Still hashless, so still invisible to the compare: landing this twice cannot
		// mint a difference for the next round to chase.
		expect(meta.sidecars?.cutout?.hash).toBeUndefined();
	});

	it('leaves the local src alone through every one of those', async () => {
		const {id, store} = await edited();
		const src = await blobBytes((await store.sidecar(id, 'src'))!);
		const before = (await store.meta(id))?.sidecars?.src;

		// A landing cutout, a cutout deletion, and a bare settings change in turn. None
		// of them says anything about `src`: its blob has `sync: false` and therefore
		// never crossed the wire, so the sender could neither have sent it nor have
		// meant to drop it. Claiming or dropping it here is what makes this device's
		// next push disagree with its own manifest forever.
		await store.applySyncedProvenance(id, {
			sidecars: {cutout: new Blob(['theirs'], {type: 'image/png'})}
		});
		await store.applySyncedProvenance(id, {edits: edits()});
		const meta = await store.applySyncedProvenance(id, {});

		expect(meta.sidecars?.src).toEqual(before);
		expect(await blobBytes((await store.sidecar(id, 'src'))!)).toEqual(src);
	});

	it('ignores a src somebody offered anyway', async () => {
		const {id, store} = await edited();
		const src = await blobBytes((await store.sidecar(id, 'src'))!);

		// A non-syncable kind cannot have come off the wire, so one turning up here is
		// a mistake upstream -- and writing it would overwrite this device's un-edited
		// original with another picture's base.
		await store.applySyncedProvenance(id, {
			sidecars: {src: new Blob([jpegBytes()], {type: 'image/jpeg'})}
		});

		expect(await blobBytes((await store.sidecar(id, 'src'))!)).toEqual(src);
	});

	it('drops the manifest entry entirely when only syncable kinds were there', async () => {
		const backend = new MemoryBackend();
		const store = new BackedAssetStore(backend);
		const id = await store.put(file(pngBytes(), 'tavern.png', 'image/png'), {
			kind: 'bg'
		});

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			sidecars: {cutout: new Blob(['mask'], {type: 'image/png'})},
			tuning: {softness: 0.3, threshold: 0.5}
		});

		// Undefined rather than an empty record, so an asset carrying nothing reads the
		// same as one that never had a sidecar at all.
		expect(
			(await store.applySyncedProvenance(id, {})).sidecars
		).toBeUndefined();
	});

	it('clears settings the pull does not carry', async () => {
		const {id, store} = await edited();

		await store.update(id, {origin: {x: 0.5, y: 1}});

		// Wholesale, the way `replace` treats them: absent means the far side cleared
		// it, not that it said nothing.
		const meta = await store.applySyncedProvenance(id, {});

		expect(meta.edits).toBeUndefined();
		expect(meta.tuning).toBeUndefined();
		expect(meta.origin).toBeUndefined();
	});

	it('keeps the author’s own identity fields', async () => {
		const {id, store} = await edited();

		await store.update(id, {name: 'tavern-night', tags: ['night']});

		const meta = await store.applySyncedProvenance(id, {edits: edits()});

		// Name, kind and tags are the library compare's business, not provenance's.
		expect(meta.name).toBe('tavern-night');
		expect(meta.tags).toEqual(['night']);
		expect(meta.kind).toBe('bg');
	});

	it('throws on an id nothing answers to', async () => {
		const {store} = await edited();

		// Same as `update` and `replace`: the bytes being already here is the
		// precondition, so a missing asset is a caller bug, not a silent insert.
		await expect(
			store.applySyncedProvenance('a_0000', {edits: edits()})
		).rejects.toThrow('a_0000');
	});
});

describe('applySyncedBytes', () => {
	/** What a pull hands over: the far side's row for the same asset, new bytes. */
	async function farRow(
		bytes: Uint8Array,
		overrides: Partial<AssetMeta> = {}
	): Promise<AssetMeta> {
		return {
			animated: false,
			bytes: bytes.length,
			h: 150,
			hash: await contentHash(bytes),
			id: 'a_far',
			kind: 'frame',
			mime: 'image/jpeg',
			name: 'far-name',
			tags: ['far'],
			w: 300,
			...overrides
		};
	}

	it('writes the new bytes under the local id, keeping identity and provenance', async () => {
		const store = newStore();
		const id = await store.put(file(pngBytes(), 'tavern.png', 'image/png'), {
			kind: 'bg',
			tags: ['night']
		});

		await store.applySyncedProvenance(id, {
			edits: edits(),
			walk: {shapes: []}
		});

		const bytes = jpegBytes();
		const meta = await store.applySyncedBytes(
			id,
			await farRow(bytes),
			new Blob([bytes], {type: 'image/jpeg'})
		);

		// Identity and provenance stay local; the pull lands provenance separately.
		expect(meta).toMatchObject({
			bytes: bytes.length,
			edits: edits(),
			h: 150,
			hash: await contentHash(bytes),
			id,
			kind: 'bg',
			mime: 'image/jpeg',
			name: 'tavern',
			tags: ['night'],
			w: 300,
			walk: {shapes: []}
		});
		expect(await store.meta(id)).toEqual(meta);
		expect(
			new Uint8Array(await blobBytes((await store.get(id)) as Blob))
		).toEqual(bytes);
	});

	it('drops the local src, keeps the syncable cutout', async () => {
		const backend = new MemoryBackend();
		const store = new BackedAssetStore(backend);
		const id = await store.put(file(pngBytes(), 'tavern.png', 'image/png'), {
			kind: 'bg'
		});

		await store.replace(id, file(jpegBytes(), 'tavern.jpg', 'image/jpeg'), {
			edits: edits(),
			sidecars: {
				cutout: new Blob(['local mask'], {type: 'image/png'}),
				src: new Blob([pngBytes()], {type: 'image/png'})
			}
		});

		const bytes = pngBytes(64, 32);
		const meta = await store.applySyncedBytes(
			id,
			await farRow(bytes, {mime: 'image/png'}),
			new Blob([bytes], {type: 'image/png'})
		);

		// `src` is the original of the OLD pixels; paired with the far side's edits it
		// would re-edit from the wrong base. The cutout is the provenance landing's call.
		expect(meta.sidecars?.src).toBeUndefined();
		expect(await store.sidecar(id, 'src')).toBeUndefined();
		expect(await backend.readBlob(sidecarKey(id, 'src'))).toBeUndefined();
		expect(meta.sidecars?.cutout).toBeDefined();
		expect(await store.sidecar(id, 'cutout')).toBeDefined();
	});

	it('refuses bytes that do not match the row’s hash', async () => {
		const store = newStore();
		const id = await store.put(file(pngBytes(), 'tavern.png', 'image/png'), {
			kind: 'bg'
		});
		const before = await store.meta(id);

		// A blob overwritten between the manifest GET and this one must not land under
		// a hash it does not have.
		await expect(
			store.applySyncedBytes(
				id,
				await farRow(jpegBytes()),
				new Blob([pngBytes(10, 10)], {type: 'image/png'})
			)
		).rejects.toThrow(id);
		expect(await store.meta(id)).toEqual(before);
	});
});
