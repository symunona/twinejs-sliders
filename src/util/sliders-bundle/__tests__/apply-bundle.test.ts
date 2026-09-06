import {
	BackedAssetStore,
	MemoryBackend,
	blobBytes,
	contentHash
} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {
	apngBytes,
	gifBytes,
	jpegBytes,
	pngBytes,
	webpBytes
} from '../../../../packages/asset-store/src/test-fixtures';
import type {BundleAsset, BundleContents} from '../bundle.types';
import {applyBundlePlan, planBundle} from '../apply-bundle';

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
	return new BackedAssetStore(new MemoryBackend());
}

async function meta(
	bytes: Uint8Array,
	overrides: Partial<AssetMeta> = {}
): Promise<AssetMeta> {
	return {
		id: 'a_8f21',
		name: 'tavern/night',
		kind: 'bg',
		tags: [],
		animated: false,
		w: 640,
		h: 360,
		bytes: bytes.length,
		hash: await contentHash(bytes),
		mime: 'image/webp',
		...overrides
	};
}

async function asset(
	bytes: Uint8Array,
	overrides: Partial<AssetMeta> = {}
): Promise<BundleAsset> {
	return {meta: await meta(bytes, overrides), blob: new Blob([bytes])};
}

function character(overrides: Partial<Character> = {}): Character {
	return {
		id: 'mira',
		name: 'Mira',
		size: {w: 512, h: 1024},
		origin: {x: 0.5, y: 1},
		frames: {},
		tags: [],
		...overrides
	};
}

function contents(overrides: Partial<BundleContents> = {}): BundleContents {
	return {
		manifest: {
			format: 'sliders-bundle',
			version: 1,
			creator: {name: 'Twine', version: '2.10.0'},
			story: {id: 's_1', ifid: 'IFID', name: 'Tavern'},
			assets: [],
			characters: [],
			unresolved: []
		},
		stories: [],
		assets: [],
		characters: [],
		warnings: [],
		...overrides
	};
}

async function bytesOf(blob: Blob | undefined): Promise<number[]> {
	if (!blob) {
		throw new Error('Expected a blob.');
	}

	return Array.from(new Uint8Array(await blobBytes(blob)));
}

/**
 * Metadata *and* pixels. Comparing only the manifest would miss the worst outcome an apply
 * can have: the entries all still there, with somebody else's bytes behind one of them.
 *
 * Copies the metadata rather than holding the store's own objects. `list()` hands back the
 * live manifest entries and `putCharacter` stamps `ownerCharacter`/`kind` onto them in
 * place, so a snapshot of references would compare equal to itself however badly the import
 * had mangled it.
 */
async function librarySnapshot(
	store: BackedAssetStore
): Promise<{bytes: number[]; meta: AssetMeta}[]> {
	const rows: {bytes: number[]; meta: AssetMeta}[] = [];

	for (const meta of await store.list({includeFrames: true})) {
		rows.push({
			bytes: await bytesOf(await store.get(meta.id)),
			meta: {...meta, tags: [...meta.tags]}
		});
	}

	return rows;
}

describe('planBundle asset clashes', () => {
	it('reuses a local asset with the same content hash', async () => {
		const store = newStore();
		const local = await asset(webpBytes(), {id: 'a_local', name: 'my/tavern'});

		await store.importAsset(local.meta, local.blob);

		// Same bytes, different id and name -- the hash is what decides.
		const incoming = await asset(webpBytes(), {id: 'a_8f21'});
		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].outcome).toBe('reused');
		expect(plan.assets[0].targetId).toBe('a_local');
		expect(plan.assets[0].bundleId).toBe('a_8f21');

		await applyBundlePlan(store, plan);

		const library = await store.list({includeFrames: true});

		expect(library).toHaveLength(1);
		expect(library[0].name).toBe('my/tavern');
	});

	it('reuses an asset that clashes by name as well as by hash, silently', async () => {
		const store = newStore();
		const local = await asset(webpBytes(), {id: 'a_local'});

		await store.importAsset(local.meta, local.blob);

		// Same name and same bytes: the one collision that must stay quiet, and the only
		// version of this scenario where a warning is even reachable. Checking the name
		// before the hash would make every re-import claim the author's art was kept over
		// an identical copy of itself.
		const incoming = await asset(webpBytes(), {id: 'a_8f21'});

		expect(incoming.meta.name).toBe(local.meta.name);

		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].outcome).toBe('reused');
		expect(plan.warnings).toEqual([]);
	});

	it('does not reuse a frame for a loose asset with the same bytes', async () => {
		const store = newStore();
		const local = await asset(webpBytes(), {
			id: 'a_local',
			name: 'mira/happy',
			kind: 'frame',
			ownerCharacter: 'mira'
		});

		await store.importAsset(local.meta, local.blob);

		const incoming = await asset(webpBytes(), {
			id: 'a_8f21',
			name: 'tavern/night'
		});
		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].outcome).toBe('imported');
	});

	it('does not reuse a loose asset for a frame with the same bytes', async () => {
		const store = newStore();
		const local = await asset(webpBytes(), {
			id: 'a_local',
			name: 'tavern/night'
		});

		await store.importAsset(local.meta, local.blob);

		// The mirror of the case above, and the direction that actually costs something:
		// `putCharacter` stamps ownerCharacter/kind onto whatever a frame points at, so
		// reusing this loose background would drag it into the imported character.
		const incoming = await asset(webpBytes(), {
			id: 'a_8f21',
			name: 'mira/happy',
			kind: 'frame',
			ownerCharacter: 'mira'
		});
		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].outcome).toBe('imported');
		expect(plan.assets[0].targetId).toBe('a_8f21');
	});

	it('does not let an incoming frame swallow a loose asset with the same name', async () => {
		const store = newStore();
		const local = await asset(pngBytes(), {id: 'a_local', name: 'mira/happy'});

		await store.importAsset(local.meta, local.blob);

		// A background the author happened to call `mira/happy`, and a bundle whose
		// character has a frame under that name. Nothing addresses a frame by name, so
		// these two are not competing for anything.
		const incoming = await asset(webpBytes(), {
			id: 'a_8f21',
			name: 'mira/happy',
			kind: 'frame',
			ownerCharacter: 'mira'
		});
		const plan = await planBundle(
			store,
			contents({
				assets: [incoming],
				characters: [character({frames: {happy: {asset: 'a_8f21'}}})]
			})
		);

		expect(plan.assets[0].outcome).toBe('imported');
		expect(plan.assets[0].targetId).toBe('a_8f21');

		await applyBundlePlan(store, plan);

		const kept = await store.meta('a_local');

		// Letting the frame "keep" the contested name would hand its id to the imported
		// character, and putCharacter would stamp ownerCharacter/kind onto the author's
		// background: gone from the asset grid, and deleted outright by removeCharacter.
		expect(kept?.kind).toBe('bg');
		expect(kept?.ownerCharacter).toBeUndefined();
		expect((await store.list()).map(meta => meta.id)).toEqual(['a_local']);
		expect(await bytesOf(await store.get('a_local'))).toEqual(
			Array.from(pngBytes())
		);
		expect(await store.getCharacter('mira')).toMatchObject({
			frames: {happy: {asset: 'a_8f21'}}
		});
	});

	it('imports as-is when name and id are both free', async () => {
		const store = newStore();
		// Not an empty library: a plan that cannot see anything cannot warn about anything,
		// so the silence below only means something with art already here.
		const other = await asset(pngBytes(), {id: 'a_0001', name: 'tavern/day'});

		await store.importAsset(other.meta, other.blob);

		const incoming = await asset(webpBytes(), {id: 'a_8f21'});
		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].outcome).toBe('imported');
		expect(plan.assets[0].targetId).toBe('a_8f21');
		expect(plan.warnings).toEqual([]);

		await applyBundlePlan(store, plan);

		expect(await store.meta('a_8f21')).toMatchObject({
			id: 'a_8f21',
			name: 'tavern/night'
		});
		expect(await bytesOf(await store.get('a_8f21'))).toEqual(
			Array.from(webpBytes())
		);
		expect(await bytesOf(await store.get('a_0001'))).toEqual(
			Array.from(pngBytes())
		);
	});

	it('mints a new id when the name is free but the id is taken', async () => {
		const store = newStore();
		const local = await asset(pngBytes(), {id: 'a_8f21', name: 'other/thing'});

		await store.importAsset(local.meta, local.blob);

		const incoming = await asset(webpBytes(), {id: 'a_8f21'});
		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].outcome).toBe('new-id');
		expect(plan.assets[0].bundleId).toBe('a_8f21');
		expect(plan.assets[0].targetId).not.toBe('a_8f21');
		expect(plan.assets[0].meta.id).toBe(plan.assets[0].targetId);

		await applyBundlePlan(store, plan);

		// The local asset keeps its id and its bytes; the incoming one lands beside it.
		expect(await bytesOf(await store.get('a_8f21'))).toEqual(
			Array.from(pngBytes())
		);
		expect(await bytesOf(await store.get(plan.assets[0].targetId))).toEqual(
			Array.from(webpBytes())
		);
		expect(await store.list({includeFrames: true})).toHaveLength(2);
	});

	it('keeps the local asset when the name is taken by different bytes', async () => {
		const store = newStore();
		const local = await asset(pngBytes(), {
			id: 'a_local',
			name: 'tavern/night'
		});

		await store.importAsset(local.meta, local.blob);

		const incoming = await asset(webpBytes(), {
			id: 'a_8f21',
			name: 'tavern/night'
		});
		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].outcome).toBe('kept-existing');
		expect(plan.assets[0].targetId).toBe('a_local');
		expect(plan.warnings).toHaveLength(1);
		expect(plan.warnings[0]).toMatch(/tavern\/night/);

		await applyBundlePlan(store, plan);

		// The whole point: the local pixels survive, under the name the imported story
		// writes in its scenes.
		expect(await bytesOf(await store.get('a_local'))).toEqual(
			Array.from(pngBytes())
		);
		expect(await store.list({includeFrames: true})).toHaveLength(1);
		expect(await store.meta('a_8f21')).toBeUndefined();
	});

	it('writes nothing at all for a bundle of reused and kept-existing assets', async () => {
		const store = newStore();
		const same = await asset(webpBytes(), {id: 'a_same', name: 'a/same'});
		const clash = await asset(pngBytes(), {id: 'a_mine', name: 'a/clash'});

		await store.importAsset(same.meta, same.blob);
		await store.importAsset(clash.meta, clash.blob);

		const before = await librarySnapshot(store);
		const plan = await planBundle(
			store,
			contents({
				assets: [
					await asset(webpBytes(), {id: 'a_0001', name: 'their/same'}),
					await asset(jpegBytes(), {id: 'a_0002', name: 'a/clash'})
				]
			})
		);

		expect(plan.assets.map(item => item.outcome)).toEqual([
			'reused',
			'kept-existing'
		]);

		await applyBundlePlan(store, plan);

		expect(await librarySnapshot(store)).toEqual(before);
	});

	it('collapses two bundle assets that carry the same bytes', async () => {
		const store = newStore();
		const plan = await planBundle(
			store,
			contents({
				assets: [
					await asset(webpBytes(), {id: 'a_0001', name: 'one'}),
					await asset(webpBytes(), {id: 'a_0002', name: 'two'})
				]
			})
		);

		expect(plan.assets.map(item => item.outcome)).toEqual([
			'imported',
			'reused'
		]);
		expect(plan.assets[1].targetId).toBe('a_0001');

		await applyBundlePlan(store, plan);
		expect(await store.list({includeFrames: true})).toHaveLength(1);
	});
});

describe('planBundle against a local character id', () => {
	// Asset names and character ids are one namespace — a scene resolves an `entities:`
	// entry against both — and a character id cannot be renamed: it is written literally
	// into every scene that casts it. So the incoming ASSET is the one that has to move.

	it('numbers the incoming asset and says so', async () => {
		const store = newStore();

		await store.putCharacter({
			frames: {},
			id: 'lamp',
			name: 'Lamp',
			origin: {x: 0.5, y: 1},
			size: {w: 100, h: 200},
			tags: []
		});

		const incoming = await asset(webpBytes(), {id: 'a_8f21', name: 'lamp'});
		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].meta.name).toBe('lamp-2');
		expect(plan.warnings.join(' ')).toContain('already has a character called "lamp"');

		await applyBundlePlan(store, plan);

		const library = await store.list({includeFrames: true});

		expect(library.map(item => item.name)).toEqual(['lamp-2']);
	});

	it('leaves a name alone when no character answers to it', async () => {
		const store = newStore();
		const incoming = await asset(webpBytes(), {id: 'a_8f21', name: 'lamp'});
		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].meta.name).toBe('lamp');
		expect(plan.warnings).toEqual([]);
	});

	it('does not move a frame — a frame is reached through its character, not by name', async () => {
		const store = newStore();

		await store.putCharacter({
			frames: {},
			id: 'lamp',
			name: 'Lamp',
			origin: {x: 0.5, y: 1},
			size: {w: 100, h: 200},
			tags: []
		});

		const incoming = await asset(webpBytes(), {
			id: 'a_8f21',
			name: 'lamp',
			ownerCharacter: 'someone'
		});
		const plan = await planBundle(store, contents({assets: [incoming]}));

		expect(plan.assets[0].meta.name).toBe('lamp');
	});
});

describe('planBundle sourceAsset', () => {
	it('remaps a sourceAsset that travelled with the bundle', async () => {
		const store = newStore();
		const local = await asset(pngBytes(), {id: 'a_0001', name: 'squatter'});

		await store.importAsset(local.meta, local.blob);

		const plan = await planBundle(
			store,
			contents({
				assets: [
					await asset(webpBytes(), {id: 'a_0001', name: 'original'}),
					await asset(jpegBytes(), {
						id: 'a_0002',
						name: 'edited',
						sourceAsset: 'a_0001'
					})
				]
			})
		);

		expect(plan.assets[0].outcome).toBe('new-id');
		expect(plan.assets[1].meta.sourceAsset).toBe(plan.assets[0].targetId);
	});

	it('drops a sourceAsset that points outside the bundle', async () => {
		const store = newStore();
		const plan = await planBundle(
			store,
			contents({
				assets: [
					await asset(webpBytes(), {
						id: 'a_0002',
						name: 'edited',
						sourceAsset: 'a_9999'
					})
				]
			})
		);

		expect('sourceAsset' in plan.assets[0].meta).toBe(false);

		await applyBundlePlan(store, plan);
		expect(await store.meta('a_0002')).not.toHaveProperty('sourceAsset');
	});
});

describe('planBundle characters', () => {
	it('imports a character whose id is free', async () => {
		const store = newStore();
		const frame = await asset(webpBytes(), {
			id: 'a_f1',
			name: 'mira/happy',
			kind: 'frame',
			ownerCharacter: 'mira'
		});
		const plan = await planBundle(
			store,
			contents({
				assets: [frame],
				characters: [character({frames: {happy: {asset: 'a_f1'}}})]
			})
		);

		expect(plan.characters[0].outcome).toBe('imported');
		expect(plan.characters[0].addedFrames).toEqual(['happy']);
		expect(plan.characters[0].keptFrames).toEqual([]);

		await applyBundlePlan(store, plan);

		expect(await store.getCharacter('mira')).toMatchObject({
			frames: {happy: {asset: 'a_f1'}}
		});
	});

	it('remaps frame asset ids when the asset id collides', async () => {
		const store = newStore();
		const squatter = await asset(pngBytes(), {id: 'a_f1', name: 'unrelated'});

		await store.importAsset(squatter.meta, squatter.blob);

		const frame = await asset(webpBytes(), {
			id: 'a_f1',
			name: 'mira/happy',
			kind: 'frame',
			ownerCharacter: 'mira'
		});
		const plan = await planBundle(
			store,
			contents({
				assets: [frame],
				characters: [character({frames: {happy: {asset: 'a_f1'}}})]
			})
		);
		const targetId = plan.assets[0].targetId;

		expect(plan.assets[0].outcome).toBe('new-id');
		expect(plan.characters[0].character.frames.happy.asset).toBe(targetId);

		await applyBundlePlan(store, plan);

		expect(await store.getCharacter('mira')).toMatchObject({
			frames: {happy: {asset: targetId}}
		});
		// The unrelated local asset was not dragged into the character.
		expect(await store.meta('a_f1')).toMatchObject({name: 'unrelated'});
		expect((await store.meta('a_f1'))?.ownerCharacter).toBeUndefined();
	});

	it('merges into an existing character, keeping its frames and adding the missing ones', async () => {
		const store = newStore();
		const mine = await asset(pngBytes(), {
			id: 'a_mine',
			name: 'mira/happy',
			kind: 'frame',
			ownerCharacter: 'mira'
		});

		await store.importAsset(mine.meta, mine.blob);
		await store.putCharacter(
			character({name: 'My Mira', frames: {happy: {asset: 'a_mine'}}})
		);

		const plan = await planBundle(
			store,
			contents({
				assets: [
					await asset(gifBytes({frames: 2}), {
						id: 'a_theirs',
						name: 'their/happy',
						kind: 'frame',
						ownerCharacter: 'mira'
					}),
					await asset(apngBytes(), {
						id: 'a_sad',
						name: 'mira/sad',
						kind: 'frame',
						ownerCharacter: 'mira'
					})
				],
				characters: [
					character({
						name: 'Their Mira',
						frames: {happy: {asset: 'a_theirs'}, sad: {asset: 'a_sad'}}
					})
				]
			})
		);

		expect(plan.characters[0].outcome).toBe('merged');
		expect(plan.characters[0].addedFrames).toEqual(['sad']);
		expect(plan.characters[0].keptFrames).toEqual(['happy']);
		// Identity beyond frames stays local.
		expect(plan.characters[0].character.name).toBe('My Mira');
		expect(plan.characters[0].character.frames.happy.asset).toBe('a_mine');
		expect(plan.warnings.some(warning => /merged/.test(warning))).toBe(true);

		await applyBundlePlan(store, plan);

		const stored = await store.getCharacter('mira');

		expect(Object.keys(stored?.frames ?? {}).sort()).toEqual(['happy', 'sad']);
		expect(stored?.frames.happy.asset).toBe('a_mine');
		expect(await bytesOf(await store.get('a_mine'))).toEqual(
			Array.from(pngBytes())
		);
		// The losing frame's image was not written: nothing would ever reference it.
		expect(await store.meta('a_theirs')).toBeUndefined();
		expect(await bytesOf(await store.get('a_sad'))).toEqual(
			Array.from(apngBytes())
		);
	});

	it('drops a frame whose image did not travel with the bundle', async () => {
		const store = newStore();
		const plan = await planBundle(
			store,
			contents({
				assets: [
					await asset(webpBytes(), {
						id: 'a_f1',
						name: 'mira/happy',
						kind: 'frame',
						ownerCharacter: 'mira'
					})
				],
				characters: [
					character({
						frames: {happy: {asset: 'a_f1'}, sad: {asset: 'a_gone'}}
					})
				]
			})
		);

		expect(Object.keys(plan.characters[0].character.frames)).toEqual(['happy']);
		expect(plan.warnings.some(warning => /"sad"/.test(warning))).toBe(true);
	});
});

describe('applyBundlePlan', () => {
	it('repoints frames when the store hands back a different id', async () => {
		const store = newStore();
		const frame = await asset(webpBytes(), {
			id: 'a_f1',
			name: 'mira/happy',
			kind: 'frame',
			ownerCharacter: 'mira'
		});
		const plan = await planBundle(
			store,
			contents({
				assets: [frame],
				characters: [character({frames: {happy: {asset: 'a_f1'}}})]
			})
		);

		// Someone else takes a_f1 between planning and applying.
		const squatter = await asset(pngBytes(), {
			id: 'a_f1',
			name: 'late/arrival'
		});

		await store.importAsset(squatter.meta, squatter.blob);
		await applyBundlePlan(store, plan);

		const stored = await store.getCharacter('mira');

		expect(stored?.frames.happy.asset).not.toBe('a_f1');
		expect(await bytesOf(await store.get(stored!.frames.happy.asset))).toEqual(
			Array.from(webpBytes())
		);
	});
});
