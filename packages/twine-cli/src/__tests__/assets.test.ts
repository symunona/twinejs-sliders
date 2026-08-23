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
	frames: {
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
			asset('a_orphan', 'moon', 'object')
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
  mira: {at: -0.4, frame: arms-crossed}
props:
  candle: {at: [0.1, -0.2]}
beats:
  - mira: {frame: angry, say: "Get out."}
`;

// ---------------------------------------------------------------------------

describe('resolveSceneAssets', () => {
	it('resolves bg, props and only the frames the scene names', async () => {
		const rows = resolveSceneAssets(scene(TAVERN), await catalog());
		const byVia = new Map(rows.map(row => [row.via, row]));

		expect(byVia.get('bg:')).toMatchObject({id: 'a_bg', kind: 'bg', present: 'present'});
		expect(byVia.get('props/candle')).toMatchObject({
			id: 'a_candle',
			kind: 'object'
		});
		expect(byVia.get('cast/mira')).toMatchObject({id: 'a_crossed', kind: 'frame'});
		expect(byVia.get('beats/0 patch frame: angry')).toMatchObject({id: 'a_angry'});

		// The default frame is in (the renderer would fall back to it), but nothing else
		// of Mira's is — narrow resolution is the whole point of step 3.
		expect(rows.map(row => row.id).sort()).toEqual([
			'a_angry',
			'a_bg',
			'a_candle',
			'a_crossed',
			'a_idle'
		]);
	});

	it('reports a frame whose blob the store has lost', async () => {
		const rows = resolveSceneAssets(scene(TAVERN), await catalog(['a_angry']));
		const angry = rows.find(row => row.id === 'a_angry');

		expect(angry).toMatchObject({present: 'missing-blob', via: 'beats/0 patch frame: angry'});
		expect(angry?.path).toBeUndefined();
		expect(rows.find(row => row.id === 'a_bg')?.path).toBe('/data/assets/a_bg.webp');
	});

	it('marks a reference the manifest has never heard of', async () => {
		const rows = resolveSceneAssets(
			scene('id: x\nbg: tavern/dawn\nprops:\n  lantern: {at: 0}\n'),
			await catalog()
		);

		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({id: '', name: 'tavern/dawn', present: 'unknown', via: 'bg:'}),
				expect.objectContaining({name: 'lantern', present: 'unknown', via: 'props/lantern'})
			])
		);
	});

	it('names the pose when a character has no such frame', async () => {
		const rows = resolveSceneAssets(
			scene('id: x\ncast:\n  mira: {at: 0, frame: waving}\n'),
			await catalog()
		);

		expect(rows).toEqual(
			expect.arrayContaining([
				expect.objectContaining({name: 'mira/waving', present: 'unknown'})
			])
		);
	});

	it('--all-frames widens to the whole character', async () => {
		const rows = resolveSceneAssets(scene(TAVERN), await catalog(), {allFrames: true});

		expect(rows.map(row => row.id)).toEqual(
			expect.arrayContaining(['a_idle', 'a_crossed', 'a_angry'])
		);
	});

	it('walks the from: parent and marks what it brings in', async () => {
		const parent = scene(TAVERN);
		const child = scene('id: tavern-fight\nfrom: tavern-night@tense\ncast:\n  mira: {frame: angry}\n');
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
		const a = scene('id: a\nfrom: b\nbg: tavern/night\n');
		const b = scene('id: b\nfrom: a\n');
		const rows = resolveSceneAssets(a, await catalog(), {
			scenes: id => (id === 'a' ? a : id === 'b' ? b : undefined)
		});

		expect(rows.map(row => row.id)).toEqual(['a_bg']);
	});
});

describe('unusedAssets', () => {
	it('finds the blob nothing in the story names', async () => {
		const unused = unusedAssets([scene(TAVERN)], await catalog());

		// Every frame of a cast member counts as used, so only the prop nobody placed is
		// orphaned.
		expect(unused.map(row => row.id)).toEqual(['a_orphan']);
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
		expect(loaded.characters.get('mira')?.frames.idle.asset).toBe('a_idle');
		expect(loaded.paths.get('a_bg')).toBe('/blobs/a_bg');
		expect(loaded.missing.has('a_angry')).toBe(true);
	});
});
