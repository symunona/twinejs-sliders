import type {AssetMask, ImageEdits} from '@sliders/scene-types';
import {MemoryBackend} from '../backends/memory-backend';
import {blobBytes} from '../blob-bytes';
import {sidecarKey} from '../ids';
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
	it('cannot collide with an asset id', () => {
		// Ids are `a_` plus hex and names are slugged to [a-z0-9/_-], so a `#` in the key
		// is what guarantees a sidecar never lands on another asset's blob.
		expect(sidecarKey('a_8f21', 'source')).toBe('a_8f21#src');
		expect(sidecarKey('a_8f21', 'cutout')).toBe('a_8f21#cutout');
	});
});

describe('editing sidecars', () => {
	it('stores the edit settings and the pixels it was rendered from', async () => {
		const {id, store} = await seeded();
		const settings = edits();

		await store.replace(id, file(jpegBytes(), 'tavern.jpg', 'image/jpeg'), {
			edits: settings,
			source: new Blob([pngBytes()], {type: 'image/png'})
		});

		const meta = await store.meta(id);

		expect(meta?.edits).toEqual(settings);
		expect(meta?.sidecars).toEqual(['source']);
		expect(await store.sidecar(id, 'source')).toBeDefined();
		expect(await store.sidecar(id, 'cutout')).toBeUndefined();
	});

	it('keeps the first source through later edits', async () => {
		const {id, store} = await seeded();
		const first = new Blob([pngBytes()], {type: 'image/png'});

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			edits: edits(),
			source: first
		});

		// A second pass offers its own base -- which is the first one read back. Storing it
		// would be harmless here but wrong the moment the two ever differ, so the store
		// keeps what it has.
		await store.replace(id, file(pngBytes(), 'b.png', 'image/png'), {
			edits: edits({brightness: 10}),
			source: new Blob([jpegBytes()], {type: 'image/jpeg'})
		});

		const stored = await store.sidecar(id, 'source');

		expect(await blobBytes(stored!)).toEqual(await blobBytes(first));
		expect((await store.meta(id))?.edits?.brightness).toBe(10);
	});

	it('replaces the cutout every time, and drops it when the removal is undone', async () => {
		const {id, store} = await seeded();

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			cutout: new Blob(['first'], {type: 'image/png'}),
			edits: edits(),
			source: new Blob([pngBytes()], {type: 'image/png'}),
			tuning: {softness: 0.3, threshold: 0.5}
		});

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			cutout: new Blob(['second'], {type: 'image/png'}),
			edits: edits(),
			source: new Blob([pngBytes()], {type: 'image/png'}),
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
			cutout: new Blob(['mask'], {type: 'image/png'}),
			edits: edits(),
			source: new Blob([pngBytes()], {type: 'image/png'}),
			tuning: {softness: 0.3, threshold: 0.5}
		});

		// A plain replace is a re-upload: a different picture under the same id. The old
		// source describes pixels that have just been thrown away, and leaving it would
		// hand the editor a base belonging to something else.
		await store.replace(id, file(pngBytes(), 'different.png', 'image/png'));

		const meta = await store.meta(id);

		expect(meta?.sidecars).toBeUndefined();
		expect(meta?.edits).toBeUndefined();
		expect(meta?.tuning).toBeUndefined();
		expect(await store.sidecar(id, 'source')).toBeUndefined();
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
				source: new Blob([pngBytes()], {type: 'image/png'})
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
			source: new Blob([pngBytes()], {type: 'image/png'})
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
			source: new Blob([pngBytes()], {type: 'image/png'})
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
			source: base
		});

		// A mask is metadata, not a sidecar -- but its points are fractions OF the base.
		// Treating this as a re-upload would drop the base and leave holes that can only
		// ever be re-cut into bytes that already have them.
		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			mask: mask()
		});

		const meta = await store.meta(id);

		expect(meta?.mask).toEqual(mask());
		expect(meta?.sidecars).toEqual(['source']);
		expect(await blobBytes((await store.sidecar(id, 'source'))!)).toEqual(
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
				source: new Blob([pngBytes()], {type: 'image/png'}),
				sourceAsset: 'a_8f21'
			}
		);

		expect(saved.meta.sidecars).toEqual(['source']);
		expect(saved.meta.sourceAsset).toBe('a_8f21');
		expect(await store.sidecar(saved.id, 'source')).toBeDefined();
	});

	it('deletes the sidecars along with the asset', async () => {
		const backend = new MemoryBackend();
		const store = new BackedAssetStore(backend);
		const id = await store.put(file(pngBytes(), 'tavern.png', 'image/png'), {
			kind: 'bg'
		});

		await store.replace(id, file(jpegBytes(), 'a.jpg', 'image/jpeg'), {
			cutout: new Blob(['mask'], {type: 'image/png'}),
			edits: edits(),
			source: new Blob([pngBytes()], {type: 'image/png'})
		});

		await store.remove(id);

		// Straight at the backend: `sidecar` reads the manifest, and the manifest entry is
		// gone either way, so it would report success over a pair of leaked blobs.
		expect(await backend.readBlob(sidecarKey(id, 'source'))).toBeUndefined();
		expect(await backend.readBlob(sidecarKey(id, 'cutout'))).toBeUndefined();
	});

	it('reports no sidecar for an asset that never had one', async () => {
		const {id, store} = await seeded();

		expect(await store.sidecar(id, 'source')).toBeUndefined();
		expect((await store.meta(id))?.sidecars).toBeUndefined();
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
				sidecars: ['source'],
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
