/**
 * `frames:` is now `poses:` (2026-09). A manifest written before the rename loads as
 * `poses:`, saves as `poses:`, and a second round trip changes nothing.
 */

import type {AssetMeta, Character} from '@sliders/scene-types';
import {MemoryBackend} from '../backends/memory-backend';
import {BackedAssetStore} from '../store';

const RIG = {bubble: {x: 0.5, y: 0.15}};

function meta(id: string): AssetMeta {
	return {
		animated: false,
		bytes: 1,
		h: 10,
		hash: `hash-${id}`,
		id,
		kind: 'frame',
		mime: 'image/png',
		name: `mira-${id}`,
		ownerCharacter: 'mira',
		tags: [],
		w: 10
	} as AssetMeta;
}

/** Mira as a library written before the rename left her. */
function oldMira(): Record<string, unknown> {
	return {
		frames: {
			angry: {anchors: RIG, asset: 'a_2'},
			idle: {anchors: RIG, asset: 'a_1', fit: {offset: {x: 0.1, y: 0}, scale: 1}}
		},
		id: 'mira',
		name: 'mira',
		origin: {x: 0.5, y: 1},
		size: {h: 1024, w: 512},
		tags: []
	};
}

async function seeded(characters: Record<string, unknown>) {
	const backend = new MemoryBackend();

	await backend.writeManifest({
		assets: {a_1: meta('a_1'), a_2: meta('a_2'), a_3: meta('a_3')},
		characters: characters as Record<string, Character>,
		version: 1
	});

	for (const id of ['a_1', 'a_2', 'a_3']) {
		await backend.writeBlob(id, new Blob(['x']));
	}

	return {backend, store: new BackedAssetStore(backend)};
}

describe('frames: -> poses: on read', () => {
	it('loads an old manifest as poses, nothing lost', async () => {
		const {store} = await seeded({mira: oldMira()});
		const mira = (await store.getCharacter('mira'))!;

		expect(mira).not.toHaveProperty('frames');
		expect(mira.poses).toEqual({
			angry: {anchors: RIG, asset: 'a_2'},
			idle: {anchors: RIG, asset: 'a_1', fit: {offset: {x: 0.1, y: 0}, scale: 1}}
		});
		expect((await store.listCharacters())[0].poses.idle.asset).toBe('a_1');
	});

	it('saves as poses, with no frames key left behind', async () => {
		const {backend, store} = await seeded({mira: oldMira()});

		await store.putCharacter((await store.getCharacter('mira'))!);

		const stored = (await backend.readManifest()).characters.mira as unknown as Record<
			string,
			unknown
		>;

		expect(stored).not.toHaveProperty('frames');
		expect(Object.keys(stored.poses as object).sort()).toEqual(['angry', 'idle']);
	});

	it('persists the new shape on ANY write, not only a character save', async () => {
		const {backend, store} = await seeded({mira: oldMira()});

		await store.update('a_3', {tags: ['x']});

		expect((await backend.readManifest()).characters.mira).not.toHaveProperty(
			'frames'
		);
	});

	it('is stable: a second load and save changes nothing', async () => {
		const {backend, store} = await seeded({mira: oldMira()});

		await store.putCharacter((await store.getCharacter('mira'))!);
		const once = await backend.readManifest();

		const again = new BackedAssetStore(backend);

		await again.putCharacter((await again.getCharacter('mira'))!);
		expect(await backend.readManifest()).toEqual(once);
	});

	it('lets poses win when a manifest somehow carries both', async () => {
		const {store} = await seeded({
			mira: {...oldMira(), poses: {idle: {anchors: RIG, asset: 'a_3'}}}
		});
		const mira = (await store.getCharacter('mira'))!;

		expect(mira.poses.idle.asset).toBe('a_3');
		expect(mira.poses.angry.asset).toBe('a_2');
	});
});

describe('a pose with steps in the store', () => {
	function stepped(): Record<string, unknown> {
		const {frames: _old, ...rest} = oldMira();

		return {
			...rest,
			poses: {
				idle: {anchors: RIG, asset: 'a_3'},
				walk: {
					anchors: RIG,
					steps: [
						{asset: 'a_1', dur: 0.1},
						{asset: 'a_2', dur: 0.1}
					]
				}
			}
		};
	}

	it('stamps every step image as owned by the character', async () => {
		const {store} = await seeded({});

		await store.update('a_1', {kind: 'bg', ownerCharacter: undefined});
		await store.putCharacter(stepped() as unknown as Character);

		expect(await store.meta('a_1')).toMatchObject({
			kind: 'frame',
			ownerCharacter: 'mira'
		});
		expect(await store.meta('a_2')).toMatchObject({
			kind: 'frame',
			ownerCharacter: 'mira'
		});
	});

	it('removing one step image shortens the pose; the last one removes it', async () => {
		const {store} = await seeded({mira: stepped()});

		await store.remove('a_1');
		expect((await store.getCharacter('mira'))!.poses.walk.steps).toEqual([
			{asset: 'a_2', dur: 0.1}
		]);

		await store.remove('a_2');
		expect((await store.getCharacter('mira'))!.poses).not.toHaveProperty('walk');
	});

	it('removing the character takes every step image with it', async () => {
		const {store} = await seeded({mira: stepped()});

		await store.removeCharacter('mira');

		for (const id of ['a_1', 'a_2', 'a_3']) {
			expect(await store.meta(id)).toBeUndefined();
		}
	});
});
