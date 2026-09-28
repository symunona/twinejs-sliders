/**
 * @jest-environment node
 */
/**
 * Old per-story art → library (`scripts/lib-import-legacy`). Real engine + HttpTransport
 * over the FakeLibServer.
 */
import type {AssetMeta, Character} from '@sliders/scene-types';
import {png} from '../../../../packages/asset-library/src/testing/fixtures';
import {World} from '../../../../packages/asset-library/src/testing/world';
import {sha256Hex} from '@sliders/asset-library';
import {importLegacyStory, LegacyBackup, remapPoses} from '../legacy-import';
import {LibraryAssetStore} from '../story-asset-store';

beforeAll(() => {
	if (!globalThis.crypto?.subtle) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const {webcrypto} = require('crypto');

		Object.defineProperty(globalThis, 'crypto', {configurable: true, value: webcrypto});
	}
});

async function backup(): Promise<LegacyBackup> {
	const bytes: Record<string, Uint8Array> = {
		a_bg: png('red', 8, 4),
		a_bg2: png('blue', 8, 4),
		a_pose: png('green', 4, 8)
	};
	const hash = async (id: string) => sha256Hex(bytes[id]);
	const assets: AssetMeta[] = [
		// Derived first on purpose: its source must still be created before it.
		{
			id: 'a_bg2',
			name: 'street-glitch',
			kind: 'bg',
			tags: ['night'],
			animated: false,
			w: 8,
			h: 4,
			bytes: bytes.a_bg2.length,
			hash: await hash('a_bg2'),
			mime: 'image/png',
			sourceAsset: 'a_bg',
			origin: {x: 0.5, y: 1},
			effect: {kind: 'glitch', amount: 0} as AssetMeta['effect'],
			edits: {brightness: 0, contrast: 0, gamma: 1} as AssetMeta['edits']
		},
		{
			id: 'a_bg',
			name: 'street',
			kind: 'bg',
			tags: [],
			animated: false,
			w: 8,
			h: 4,
			bytes: bytes.a_bg.length,
			hash: await hash('a_bg'),
			mime: 'image/png'
		},
		{
			id: 'a_pose',
			name: 'bob-happy',
			kind: 'frame',
			tags: [],
			animated: false,
			w: 4,
			h: 8,
			bytes: bytes.a_pose.length,
			hash: await hash('a_pose'),
			mime: 'image/png',
			ownerCharacter: 'bob',
			origin: {x: 0.487, y: 1}
		}
	];
	const characters = [
		{
			id: 'bob',
			name: 'bob',
			size: {w: 512, h: 1024},
			origin: {x: 0.5, y: 1},
			tags: [],
			poses: {
				happy: {asset: 'a_pose', anchors: {bubble: {x: 0.1, y: 0.1}}},
				gone: {asset: 'a_nope', anchors: {bubble: {x: 0.1, y: 0.1}}}
			}
		}
	] as unknown as Character[];

	return {
		assets,
		characters,
		story: {
			id: 'story-1',
			name: 'Desert',
			passages: [{text: '[scene]\nbg: street\n[continue]\nhello'}]
		},
		blob: async meta => bytes[meta.id]
	};
}

describe('importLegacyStory', () => {
	it('maps meta → record like the facade, repoints poses and sourceAsset, sets refs', async () => {
		const [world, ana] = await World.create(['ana']);
		const legacy = await backup();
		const report = await importLegacyStory(ana.engine, legacy);

		await world.settle();

		expect(report.assets.created.sort()).toEqual(['bob-happy', 'street', 'street-glitch']);
		expect(report.assets.failed).toEqual([]);
		expect(report.characters.created).toEqual(['bob']);
		expect(report.collection).toMatchObject({name: 'Desert', created: true});
		expect(report.warnings).toEqual(['pose image lost: bob.gone: a_nope']);

		const ids = report.idMap;
		const glitch = world.server.record('asset', ids.a_bg2);

		expect(glitch).toMatchObject({
			collection: report.collection.id,
			name: 'street-glitch',
			kind: 'bg',
			tags: ['night'],
			blob: legacy.assets[0].hash,
			mime: 'image/png',
			sourceAsset: ids.a_bg,
			recipe: {
				origin: {x: 0.5, y: 1},
				effect: {kind: 'glitch', amount: 0},
				edits: {brightness: 0, contrast: 0, gamma: 1}
			}
		});

		// Round trip through the facade: the app reads back the old meta.
		const store = new LibraryAssetStore('story-1', async () => ana.engine);
		const back = await store.meta(ids.a_bg2);
		const rest: Partial<AssetMeta> = {...legacy.assets[0]};

		delete rest.id;
		delete rest.sourceAsset;
		expect(back).toMatchObject(rest);
		expect(back!.id).toBe(ids.a_bg2);
		expect(back!.sourceAsset).toBe(ids.a_bg);
		expect(await store.meta(ids.a_pose)).toMatchObject({
			kind: 'frame',
			ownerCharacter: 'bob',
			origin: {x: 0.487, y: 1}
		});

		const bob = await store.getCharacter('bob');

		expect(Object.keys(bob!.poses)).toEqual(['happy']);
		expect(bob!.poses.happy.asset).toBe(ids.a_pose);
		expect(world.server.record('binding', 'story-1')).toMatchObject({
			own: report.collection.id,
			refs: [ids.a_bg]
		});
	});

	it('re-run skips everything and writes nothing', async () => {
		const [world, ana] = await World.create(['ana']);
		const legacy = await backup();
		const first = await importLegacyStory(ana.engine, legacy);

		await world.settle();

		const mark = ana.mark();
		const again = await importLegacyStory(ana.engine, legacy);

		await world.settle();

		expect(again.assets.created).toEqual([]);
		expect(again.assets.skipped).toHaveLength(3);
		expect(again.characters.skipped).toEqual(['bob']);
		expect(again.collection.created).toBe(false);
		expect(again.idMap).toEqual(first.idMap);
		expect(ana.since(mark).filter(r => r.method !== 'GET')).toEqual([]);
	});

	it('dry run writes nothing; a taken collection name is numbered', async () => {
		const [world, ana] = await World.create(['ana']);

		ana.engine.createCollection({name: 'Desert', kind: 'shared'});
		await world.settle();

		const legacy = await backup();
		const dry = await importLegacyStory(ana.engine, legacy, {dryRun: true});

		expect(dry.assets.created).toHaveLength(3);
		expect(ana.engine.binding('story-1')).toBeUndefined();

		const real = await importLegacyStory(ana.engine, legacy);

		expect(real.collection.name).toBe('Desert-2');
	});

	it('folds exact duplicates; a pose image named like its character becomes -pose', async () => {
		const [world, ana] = await World.create(['ana']);
		const pic = png('green', 4, 8);
		const hash = await sha256Hex(pic);
		const frame = (id: string, name: string): AssetMeta => ({
			id,
			name,
			kind: 'frame',
			tags: [],
			animated: false,
			w: 4,
			h: 8,
			bytes: pic.length,
			hash,
			mime: 'image/png',
			ownerCharacter: 'mira'
		});
		const legacy: LegacyBackup = {
			assets: [frame('a_1', 'mira'), frame('a_2', 'mira')],
			characters: [
				{
					id: 'mira',
					name: 'mira',
					// Old shape: `frames`, migrated to `poses` before the remap.
					frames: {
						idle: {asset: 'a_1'},
						walk: {steps: [{asset: 'a_2'}]}
					}
				} as unknown as Character
			],
			story: {id: 'story-2', name: 'Mira', passages: [{text: '[scene]\nmira: {at: 0.5}\n[continue]\nx'}]},
			blob: async () => pic
		};
		const report = await importLegacyStory(ana.engine, legacy);

		await world.settle();

		expect(report.assets.created).toEqual(['mira-pose']);
		expect(report.assets.merged).toEqual(['mira']);
		expect(report.characters.created).toEqual(['mira']);
		expect(report.idMap.a_1).toBe(report.idMap.a_2);

		const store = new LibraryAssetStore('story-2', async () => ana.engine);
		const mira = await store.getCharacter('mira');

		expect(mira!.poses.idle.asset).toBe(report.idMap.a_1);
		expect(mira!.poses.walk.steps![0].asset).toBe(report.idMap.a_1);

		const again = await importLegacyStory(ana.engine, legacy);

		expect(again.assets.created).toEqual([]);
		expect(again.assets.skipped).toEqual(['mira-pose']);
		expect(again.characters.skipped).toEqual(['mira']);
	});

	it('remapPoses repoints steps and drops unknown images', () => {
		const lost: string[] = [];
		const out = remapPoses(
			{
				id: 'c',
				poses: {
					walk: {steps: [{asset: 'a_1'}, {asset: 'a_x'}], loop: true},
					dead: {steps: [{asset: 'a_x'}]}
				}
			} as unknown as Character,
			new Map([['a_1', 'u-1']]),
			lost
		);

		expect(out.poses).toEqual({walk: {steps: [{asset: 'u-1'}], loop: true}});
		expect(lost).toEqual(['c.walk step: a_x', 'c.dead step: a_x']);
	});
});
