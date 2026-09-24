/** @jest-environment node */

import {parseScene} from '@sliders/scene-schema';
import type {Character, Scene} from '@sliders/scene-types';
import {
	catalogFromManifest,
	loadCatalog,
	resolveSceneAssets,
	unusedAssets
} from '../assets';
import type {AssetCatalog} from '../assets';
import type {AssetMetaRow, Manifest, Source, StoryBody, StoryMeta} from '../types';

// ---------------------------------------------------------------------------
// Fixtures. Everything is plain data — nothing here needs a store running.
// ---------------------------------------------------------------------------

function asset(id: string, name: string, kind: string): AssetMetaRow {
	return {
		bytes: 1024,
		h: 720,
		hash: `h_${id}`,
		id,
		kind,
		mime: 'image/webp',
		name,
		tags: [],
		w: 1280
	};
}

const mira: Character = {
	poses: {
		angry: {asset: 'a_angry'},
		'arms-crossed': {asset: 'a_crossed'},
		idle: {asset: 'a_idle'}
	},
	id: 'mira',
	name: 'Mira',
	origin: {x: 0.5, y: 1},
	size: {h: 1024, w: 512},
	tags: []
};

function manifest(missing: string[] = []): Manifest {
	return {
		assets: [
			asset('a_bg', 'tavern/night', 'bg'),
			asset('a_idle', 'mira/idle', 'frame'),
			asset('a_crossed', 'mira/arms-crossed', 'frame'),
			asset('a_angry', 'mira/angry', 'frame'),
			asset('a_candle', 'candle', 'object'),
			asset('a_orphan', 'moon', 'object'),
			asset('a_bed', 'tavern-loop', 'sound'),
			asset('a_slam', 'door-slam', 'sound')
		],
		characters: [mira],
		missing,
		rev: 3,
		version: 1
	};
}

async function catalog(missing: string[] = []): Promise<AssetCatalog> {
	return catalogFromManifest(manifest(missing), async id =>
		missing.includes(id) ? undefined : `/data/assets/${id}.webp`
	);
}

function scene(yaml: string): Scene {
	return parseScene(yaml).scene;
}

const TAVERN = `id: tavern-night
bg: tavern/night
cast:
  mira: {at: -0.4, pose: arms-crossed}
props:
  candle: {at: [0.1, -0.2]}
beats:
  - mira: {pose: angry, say: "Get out."}
`;

// ---------------------------------------------------------------------------

describe('resolveSceneAssets', () => {
	it('resolves bg, props and only the poses the scene names', async () => {
		const rows = resolveSceneAssets(scene(TAVERN), await catalog());
		const byVia = new Map(rows.map(row => [row.via, row]));

		expect(byVia.get('bg:')).toMatchObject({id: 'a_bg', kind: 'bg', present: 'present'});
		expect(byVia.get('props/candle')).toMatchObject({
			id: 'a_candle',
			kind: 'object'
		});
		expect(byVia.get('cast/mira')).toMatchObject({id: 'a_crossed', kind: 'frame'});
		expect(byVia.get('beats/0 patch pose: angry')).toMatchObject({id: 'a_angry'});

		// The default pose is in (the renderer would fall back to it), but nothing else
		// of Mira's is — narrow resolution is the whole point of step 3.
		expect(rows.map(row => row.id).sort()).toEqual([
			'a_angry',
			'a_bg',
			'a_candle',
			'a_crossed',
			'a_idle'
		]);
	});

	it('reports a pose whose blob the store has lost', async () => {
		const rows = resolveSceneAssets(scene(TAVERN), await catalog(['a_angry']));
		const angry = rows.find(row => row.id === 'a_angry');

		expect(angry).toMatchObject({present: 'missing-blob', via: 'beats/0 patch pose: angry'});
		expect(angry?.path).toBeUndefined();
		expect(rows.find(row => row.id === 'a_bg')?.path).toBe('/data/assets/a_bg.webp');
	});

	it('marks a reference the manifest has never heard of', async () => {
		const rows = resolveSceneAssets(
			scene('bg: tavern/dawn\nprops:\n  lantern: {at: 0}\n'),
			await catalog()
		);

		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({id: '', name: 'tavern/dawn', present: 'unknown', via: 'bg:'}),
				expect.objectContaining({name: 'lantern', present: 'unknown', via: 'props/lantern'})
			])
		);
	});

	it('names the pose when a character has no such pose', async () => {
		const rows = resolveSceneAssets(
			scene('cast:\n  mira: {at: 0, pose: waving}\n'),
			await catalog()
		);

		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({name: 'mira/waving', present: 'unknown'})
			])
		);
	});

	it('--all-poses widens to the whole character', async () => {
		const rows = resolveSceneAssets(scene(TAVERN), await catalog(), {allPoses: true});

		expect(rows.map(row => row.id)).toEqual(
			expect.arrayContaining(['a_idle', 'a_crossed', 'a_angry'])
		);
	});

	it('reads walk#n as one image of a stepped pose, as the renderer does', async () => {
		const kid: Character = {
			id: 'kid',
			name: 'Kid',
			origin: {x: 0.5, y: 1},
			poses: {
				idle: {asset: 'a_kid'},
				walk: {steps: [{asset: 'a_w1'}, {asset: 'a_w2'}, {asset: 'a_w3'}]}
			},
			size: {h: 1024, w: 512},
			tags: []
		};
		const kids = await catalogFromManifest({
			assets: [
				asset('a_kid', 'kid-idle', 'frame'),
				asset('a_w1', 'kid-walk-1', 'frame'),
				asset('a_w2', 'kid-walk-2', 'frame'),
				asset('a_w3', 'kid-walk-3', 'frame')
			],
			characters: [kid],
			missing: [],
			rev: 1,
			version: 1
		});
		const rows = resolveSceneAssets(
			scene(
				'cast:\n  kid: {at: 0, pose: idle}\nbeats:\n' +
					'  - kid: {pose: [{name: walk#2}, {name: idle#1}, {name: walk#9}], poseLoop: once}\n'
			),
			kids
		);

		expect(rows.filter(row => row.present === 'present').map(row => row.id).sort()).toEqual(
			['a_kid', 'a_w2']
		);
		// Past the end draws a placeholder, so it stays an unknown reference.
		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({name: 'kid/walk#9', present: 'unknown'})
			])
		);
	});

	it('reaches the bed and the one-shots a beat fires', async () => {
		const rows = resolveSceneAssets(
			scene(
				`id: tavern-night
music: tavern-loop@0.4
beats:
  - sfx: door-slam
  - mira: {say: "Oh.", sfx: door-slam}
`
			),
			await catalog()
		);
		const byVia = new Map(rows.map(row => [row.via, row]));

		expect(byVia.get('music:')).toMatchObject({id: 'a_bed', kind: 'sound'});
		expect(byVia.get('beats/0 sfx:')).toMatchObject({id: 'a_slam', kind: 'sound'});

		// Same sound twice is one row, like any other repeated reference.
		expect(rows.filter(row => row.id === 'a_slam')).toHaveLength(1);
	});

	it('calls an unknown sound missing, unlike an fx token', async () => {
		const rows = resolveSceneAssets(
			scene('music: no-such-bed\nfx: [rain@0.6]\n'),
			await catalog()
		);

		expect(rows).toEqual([
			expect.objectContaining({name: 'no-such-bed', present: 'unknown', via: 'music:'})
		]);
	});

	it('walks the from: parent and marks what it brings in', async () => {
		const parent = scene(TAVERN);
		const child = scene('from: tavern-night@tense\ncast:\n  mira: {pose: angry}\n');
		const rows = resolveSceneAssets(child, await catalog(), {
			scenes: id => (id === 'tavern-night' ? parent : undefined)
		});

		expect(rows.find(row => row.id === 'a_angry')).toMatchObject({inherited: false});
		expect(rows.find(row => row.id === 'a_bg')).toMatchObject({
			inherited: true,
			via: 'bg:'
		});
		expect(rows.find(row => row.id === 'a_candle')).toMatchObject({inherited: true});
	});

	it('survives a from: cycle instead of recursing forever', async () => {
		const a = scene('from: b\nbg: tavern/night\n');
		const b = scene('from: a\n');
		const rows = resolveSceneAssets(a, await catalog(), {
			scenes: id => (id === 'a' ? a : id === 'b' ? b : undefined)
		});

		expect(rows.map(row => row.id)).toEqual(['a_bg']);
	});
});

describe('unusedAssets', () => {
	it('finds the blob nothing in the story names', async () => {
		const unused = unusedAssets([scene(TAVERN)], await catalog());

		// Every pose of a cast member counts as used, so only the prop nobody placed is
		// orphaned.
		expect(unused.map(row => row.id)).toEqual(['a_orphan', 'a_bed', 'a_slam']);
		expect(unused[0]).toMatchObject({kind: 'object', name: 'moon'});
	});
});

describe('loadCatalog', () => {
	it('reads through a Source without caring which side answered', async () => {
		const source: Source = {
			assetBytes: async () => Buffer.from(''),
			assetPath: async (_story, id) => (id === 'a_angry' ? undefined : `/blobs/${id}`),
			body: async () => ({}) as StoryBody,
			list: async () => [],
			manifest: async () => manifest(['a_angry']),
			meta: async () => ({}) as StoryMeta,
			mode: 'local',
			revisions: async () => []
		};
		const loaded = await loadCatalog(source, 'story-1');

		expect(loaded.byName.get('tavern/night')?.id).toBe('a_bg');
		expect(loaded.characters.get('mira')?.poses.idle.asset).toBe('a_idle');
		expect(loaded.paths.get('a_bg')).toBe('/blobs/a_bg');
		expect(loaded.missing.has('a_angry')).toBe(true);
	});
});
