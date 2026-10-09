import {sortByZ} from '@sliders/render-dom';
import {resolveStage} from '@sliders/scene-core';
import {FIT_Z} from '@sliders/scene-types';
import type {Stage, StageEntity} from '@sliders/scene-types';
import {extractSceneBlock} from '@sliders/scene-index';
import {
	autoZWrites,
	layerRows,
	reorderWrites,
	zPinBlock,
	zResetBlocks
} from '../layer-order';
import {Z_STEP} from '../scene-gestures';
import {parseSceneText} from '../use-scene-parse';
import {
	buildWriteEdits,
	previewEdits,
	type EntityKeyWrite
} from '../use-scene-writer';

/**
 * Most stages here are built by hand: the tie and rounding cases need exact z values and an
 * exact key order, and spelling those as YAML would test the parser instead. One parsed
 * scene checks the seeds (`fit:`, `layer:`) arrive the way the module comment says.
 */

function entity(id: string, props: Partial<StageEntity> = {}): StageEntity {
	return {
		at: {x: 0, y: 0},
		flip: false,
		id,
		kind: 'cast',
		opacity: 1,
		ref: id,
		scale: 1,
		...props
	};
}

function stageOf(...entities: StageEntity[]): Stage {
	const map: Record<string, StageEntity> = {};

	for (const e of entities) {
		map[e.id] = e;
	}

	return {camera: {at: {x: 0, y: 0}, zoom: 1}, entities: map, fx: []} as Stage;
}

/** What the renderer draws, front first — `DomRenderer.assignZ()` in miniature. */
function rendererOrder(stage: Stage): string[] {
	const resolved = resolveStage(stage);
	const items = Object.keys(resolved.entities).map((id, order) => {
		const e = resolved.entities[id];

		return {at: e.at, id, order, z: e.fit ? e.z ?? FIT_Z : e.z};
	});

	return sortByZ(items)
		.map(item => item.id)
		.reverse();
}

/** The stage after a set of z writes, as the text would re-parse it. */
function applyZ(
	stage: Stage,
	writes: {id: string; key: string; value: unknown}[]
): Stage {
	const entities = {...stage.entities};

	for (const w of writes) {
		expect(w.key).toBe('z');
		entities[w.id] = {...entities[w.id], z: w.value as number | undefined};
	}

	return {...stage, entities};
}

const ids = (stage: Stage) => layerRows(stage).map(r => r.id);

describe('layerRows()', () => {
	it('lists front-most first, auto rows by y and pinned rows by z', () => {
		const stage = stageOf(
			entity('high', {at: {x: 0, y: 0.5}}), // derived z 0.25
			entity('low', {at: {x: 0, y: -0.8}}), // derived z 0.9
			entity('pinned', {kind: 'prop', z: 2}),
			entity('behind', {z: -0.5})
		);
		const rows = layerRows(stage);

		expect(rows.map(r => r.id)).toEqual(['pinned', 'low', 'high', 'behind']);
		expect(rows.map(r => r.auto)).toEqual([false, true, true, false]);
		expect(rows[1].z).toBeCloseTo(0.9);
		expect(rows[2].z).toBeCloseTo(0.25);
		expect(rows[0]).toEqual({
			auto: false,
			id: 'pinned',
			kind: 'prop',
			locked: false,
			plane: false,
			ref: 'pinned',
			z: 2
		});
	});

	it('breaks ties on insertion order exactly as sortByZ does', () => {
		// All four on the default baseline: same derived z, so key order decides — later
		// listed paints later, so it is nearer the top of the panel.
		const stage = stageOf(
			entity('b'),
			entity('a'),
			entity('d', {z: 0.5}),
			entity('c')
		);

		expect(ids(stage)).toEqual(['c', 'd', 'a', 'b']);
		expect(ids(stage)).toEqual(rendererOrder(stage));
	});

	it('derives a child from its RESOLVED y, the way the renderer draws it', () => {
		// The child's own `at.y` is an offset of 0.5, which alone would put it BEHIND
		// `floor` (derived 0.25 vs 0.5). Resolved it stands at -0.9 -> 0.95, in front.
		const stage = stageOf(
			entity('parent', {at: {x: 0, y: -1.4}}),
			entity('floor'),
			entity('child', {at: {x: 0, y: 0.5}, of: 'parent'})
		);
		const rows = layerRows(stage);

		expect(rows.map(r => r.id)).toEqual(rendererOrder(stage));
		const child = rows.find(r => r.id === 'child')!;

		expect(child.parent).toBe('parent');
		expect(child.z).toBeCloseTo(0.95, 6);
		expect(rows.find(r => r.id === 'floor')!.parent).toBeUndefined();
	});

	it('marks planes and locks; a plane at its FIT_Z seed reads as auto', () => {
		const stage = stageOf(
			entity('sky', {fit: 'cover', kind: 'prop', z: FIT_Z}),
			entity('room', {fit: 'contain', kind: 'prop', z: 1}),
			entity('bare', {fit: 'cover', kind: 'prop'}), // hand-built, no seed
			entity('mira', {locked: true})
		);
		const rows = layerRows(stage);

		// sky and bare tie at FIT_Z; bare is listed later, so it paints in front.
		expect(rows.map(r => r.id)).toEqual(['room', 'mira', 'bare', 'sky']);
		expect(rows.map(r => r.plane)).toEqual([true, false, true, true]);
		expect(rows.map(r => r.auto)).toEqual([false, true, true, true]);
		expect(rows.map(r => r.locked)).toEqual([false, true, false, false]);
		expect(rows.find(r => r.id === 'bare')!.z).toBe(FIT_Z);
		expect(rows.map(r => r.id)).toEqual(rendererOrder(stage));
	});

	it('reads parser seeds: fit: is auto, layer: front is pinned (no way to tell)', () => {
		const stage = parseSceneText(
			[
				'[scene]',
				'cast:',
				'  mira: {at: -0.4}',
				'  joren: {at: 0.3, layer: front}',
				'props:',
				'  wall: {fit: cover}',
				'  candle: {at: 0.4, z: 3}'
			].join('\n')
		).states[0];
		const rows = layerRows(stage);

		expect(rows.map(r => r.id)).toEqual(['candle', 'joren', 'mira', 'wall']);
		expect(rows.map(r => r.auto)).toEqual([false, false, true, true]);
		expect(rows.map(r => r.id)).toEqual(rendererOrder(stage));
	});

	it('copes with an empty stage', () => {
		expect(layerRows(stageOf())).toEqual([]);
	});
});

describe('reorderWrites()', () => {
	// Front first: a(0.9) b(0.6) c(0.3) d(0)
	const base = stageOf(
		entity('d', {z: 0}),
		entity('c', {z: 0.3}),
		entity('b', {z: 0.6}),
		entity('a', {z: 0.9})
	);

	function check(
		stage: Stage,
		moved: string[],
		to: number,
		expected: string[]
	) {
		const writes = reorderWrites(stage, moved, to);
		const after = applyZ(stage, writes);

		expect(ids(after)).toEqual(expected);
		expect(rendererOrder(after)).toEqual(expected);
		// Only the moved rows are written.
		expect(writes.map(w => w.id).sort()).toEqual([...moved].sort());
		return writes;
	}

	it('moves to the top: front-most z + Z_STEP', () => {
		const writes = check(base, ['c'], 0, ['c', 'a', 'b', 'd']);

		expect(writes).toEqual([
			{id: 'c', key: 'z', kind: 'cast', ref: 'c', value: 1}
		]);
	});

	it('moves to the bottom: back-most z - Z_STEP', () => {
		const writes = check(base, ['b'], 4, ['a', 'c', 'd', 'b']);

		expect(writes[0].value).toBe(-Z_STEP);
	});

	it('moves into the middle at the midpoint', () => {
		// a to the gap between c and d.
		const writes = check(base, ['a'], 3, ['b', 'c', 'a', 'd']);

		expect(writes[0].value).toBe(0.15);
	});

	it('moves several, keeping their PANEL order, spread evenly', () => {
		// ids given in reverse: panel order (a before d) is what is kept.
		const writes = check(base, ['d', 'a'], 2, ['b', 'a', 'd', 'c']);

		expect(writes.map(w => [w.id, w.value])).toEqual([
			['a', 0.5],
			['d', 0.4]
		]);
	});

	it('stacks several at the top a Z_STEP apiece', () => {
		const writes = check(base, ['c', 'd'], 0, ['c', 'd', 'a', 'b']);

		expect(writes.map(w => w.value)).toEqual([1.1, 1]);
	});

	it('returns [] for a no-op move', () => {
		expect(reorderWrites(base, ['b'], 1)).toEqual([]); // the gap above itself
		expect(reorderWrites(base, ['b'], 2)).toEqual([]); // the gap below itself
		expect(reorderWrites(base, ['a'], 0)).toEqual([]);
		expect(reorderWrites(base, ['d'], 4)).toEqual([]);
		expect(reorderWrites(base, ['a', 'b', 'c', 'd'], 0)).toEqual([]);
		expect(reorderWrites(base, ['nobody'], 0)).toEqual([]);
		expect(reorderWrites(base, [], 2)).toEqual([]);
	});

	it('clamps an out-of-range index', () => {
		check(base, ['c'], -5, ['c', 'a', 'b', 'd']);
		check(base, ['c'], 99, ['a', 'b', 'd', 'c']);
	});

	it('falls back to finer precision when 3 places collide', () => {
		const stage = stageOf(
			entity('lo', {z: 0.1001}),
			entity('hi', {z: 0.1002}),
			entity('top', {z: 1})
		);
		const writes = check(stage, ['top'], 2, ['hi', 'top', 'lo']);
		const z = writes[0].value as number;

		expect(z).toBeGreaterThan(0.1001);
		expect(z).toBeLessThan(0.1002);
		expect(String(z).length).toBeLessThanOrEqual(8); // 0.10015, not a float tail
	});

	it('works on auto rows, starting from their derived z', () => {
		const stage = stageOf(
			entity('back', {at: {x: 0, y: 0.6}}), // 0.2
			entity('front', {at: {x: 0, y: -0.6}}), // 0.8
			entity('mover', {at: {x: 0, y: 0.9}}) // 0.05
		);
		const writes = check(stage, ['mover'], 1, ['front', 'mover', 'back']);

		expect(writes[0].value).toBe(0.5);
	});

	it('moves a locked row and a plane like any other', () => {
		const stage = stageOf(
			entity('sky', {fit: 'cover', kind: 'prop', z: FIT_Z}),
			entity('mira', {locked: true})
		);

		check(stage, ['sky'], 0, ['sky', 'mira']);
		check(stage, ['mira'], 2, ['sky', 'mira']);
	});

	describe('the tie trap', () => {
		it('uses the tied z itself when insertion order already fits', () => {
			// lo, mover, hi in key order. lo and hi tie at 0.5; mover is pinned far behind.
			// At z 0.5 the key order puts mover between them, exactly where it was dropped.
			const stage = stageOf(
				entity('lo', {z: 0.5}),
				entity('mover', {z: -3}),
				entity('hi', {z: 0.5})
			);

			expect(ids(stage)).toEqual(['hi', 'lo', 'mover']);

			const writes = check(stage, ['mover'], 1, ['hi', 'mover', 'lo']);

			expect(writes[0].value).toBe(0.5);
		});

		it('snaps to the nearer edge of the tie run when insertion order says no', () => {
			// mover is listed FIRST, so at the tied z it would sort behind every tied row —
			// no z on mover alone can put it inside the run.
			const stage = stageOf(
				entity('mover', {z: -5}),
				entity('t1', {z: 0.5}),
				entity('t2', {z: 0.5}),
				entity('t3', {z: 0.5}),
				entity('t4', {z: 0.5}),
				entity('floor', {z: 0})
			);

			expect(ids(stage)).toEqual(['t4', 't3', 't2', 't1', 'floor', 'mover']);

			// Gap 1 = between t4 and t3: nearer the FRONT edge -> on top of the run.
			const front = reorderWrites(stage, ['mover'], 1);

			expect(front).toHaveLength(1);
			expect(front[0].value).toBe(0.6);
			expect(ids(applyZ(stage, front))).toEqual([
				'mover',
				't4',
				't3',
				't2',
				't1',
				'floor'
			]);

			// Gap 3 = between t2 and t1: nearer the BACK edge -> just behind t1.
			const back = reorderWrites(stage, ['mover'], 3);

			expect(back).toHaveLength(1);
			expect(back[0].value).toBe(0.25);
			expect(ids(applyZ(stage, back))).toEqual([
				't4',
				't3',
				't2',
				't1',
				'mover',
				'floor'
			]);
		});

		it('snaps to the front edge when both edges are equally near', () => {
			const stage = stageOf(
				entity('mover', {z: -5}),
				entity('top', {z: 2}),
				entity('t1', {z: 0.5}),
				entity('t2', {z: 0.5})
			);

			// Gap 2 = between t2 and t1, one from each edge.
			const writes = reorderWrites(stage, ['mover'], 2);

			expect(writes[0].value).toBe(1.25);
			expect(ids(applyZ(stage, writes))).toEqual(['top', 'mover', 't2', 't1']);
		});
	});

	it('every gap, every row: the result always matches the renderer', () => {
		// A messy stage: ties, auto rows, a plane, a child. Whatever the drop, what the
		// panel shows afterwards is what the renderer draws.
		const stage = stageOf(
			entity('sky', {fit: 'cover', kind: 'prop', z: FIT_Z}),
			entity('a'),
			entity('b'),
			entity('c', {z: 0.5}),
			entity('d', {at: {x: 0, y: 0.3}, of: 'a'}),
			entity('e', {z: 0.5}),
			entity('f', {at: {x: 0, y: -0.7}})
		);
		const rows = ids(stage);

		for (const id of rows) {
			for (let gap = 0; gap <= rows.length; gap++) {
				const after = applyZ(stage, reorderWrites(stage, [id], gap));

				expect(ids(after)).toEqual(rendererOrder(after));
			}
		}
	});
});

describe('autoZWrites()', () => {
	it('removes z only from rows that have one', () => {
		const stage = stageOf(
			entity('mira', {z: 0.4}),
			entity('joren'),
			entity('sky', {fit: 'cover', kind: 'prop', z: FIT_Z}),
			entity('room', {fit: 'cover', kind: 'prop', z: 1})
		);

		expect(
			autoZWrites(stage, ['mira', 'joren', 'sky', 'room', 'nobody'])
		).toEqual([
			{id: 'room', key: 'z', kind: 'prop', ref: 'room', value: undefined},
			{id: 'mira', key: 'z', kind: 'cast', ref: 'mira', value: undefined}
		]);
		expect(autoZWrites(stage, ['joren'])).toEqual([]);
	});
});

describe('zPinBlock()', () => {
	// Beat 1 is mira's own line and pins her; beat 2 is joren's; beat 3 is mira's again and
	// pins her once more. Joren is pinned only by his entry.
	const passage = [
		'[scene]',
		'cast:',
		'  mira: {at: 0}',
		'  joren: {at: 0.3, z: 2}',
		'beats:',
		'  - mira: {at: 0, z: 1}',
		'  - joren: {at: 0.4}',
		'  - mira: {at: 0.1, z: 3}'
	].join('\n');
	const parse = parseSceneText(passage);
	const scene = parse.result?.scene;
	const opening = (id: string) => parse.states[0].entities[id];

	it('lets the entry reset at the start, and only there', () => {
		expect(zPinBlock(scene, 0, 'joren', opening('joren'))).toBeUndefined();
		// On his own beat the writer aims at the beat, which has no z: to drop.
		expect(zPinBlock(scene, 2, 'joren', opening('joren'))).toBe('entry');
		// On mira's beat the writer splices a new, empty beat: nothing lands.
		expect(zPinBlock(scene, 1, 'joren', opening('joren'))).toBe('entry');
	});

	it('lets the beat on screen reset when it is the only thing pinning', () => {
		expect(zPinBlock(scene, 1, 'mira', opening('mira'))).toBeUndefined();
	});

	it('blocks a pin set by an earlier beat', () => {
		// Scrubber on joren's beat: mira's z comes from beat 1.
		expect(zPinBlock(scene, 2, 'mira', opening('mira'))).toBe('beat');
	});

	it('blocks the beat on screen when an earlier beat would still pin', () => {
		expect(zPinBlock(scene, 3, 'mira', opening('mira'))).toBe('beat');
	});

	it('names the entry when it is what a beat reset would uncover', () => {
		const twice = parseSceneText(
			[
				'[scene]',
				'cast:',
				'  mira: {at: 0, z: 2}',
				'beats:',
				'  - mira: {z: 1}'
			].join('\n')
		);

		expect(
			zPinBlock(twice.result?.scene, 1, 'mira', twice.states[0].entities.mira)
		).toBe('entry');
	});

	it('calls a pin this scene never wrote inherited', () => {
		expect(zPinBlock(scene, 0, 'mira', {...opening('mira'), z: 4})).toBe(
			'inherited'
		);
	});
});

describe('zResetBlocks()', () => {
	function blocksFor(passage: string, beat: number) {
		const parse = parseSceneText(passage);
		const block = extractSceneBlock(passage)!;
		const context = {
			beat,
			blockOffset: block.offset,
			blockText: block.text,
			scene: parse.result?.scene
		};

		return zResetBlocks(
			parse.states[beat],
			parse.result?.scene,
			beat,
			parse.states[0],
			(writes: EntityKeyWrite[]) =>
				previewEdits(block.text, buildWriteEdits(context, writes)) !==
				block.text
		);
	}

	it('asks the writer, which finds no z: to drop under a layer: seed', () => {
		const blocks = blocksFor(
			[
				'[scene]',
				'cast:',
				'  mira: {at: 0, layer: front}',
				'  joren: {at: 0.3, z: 2}',
				'  bram: {at: 0.1}'
			].join('\n'),
			0
		);

		expect([...blocks]).toEqual([['mira', 'seed']]);
	});

	it('carries the scene-side reason for the rest', () => {
		const blocks = blocksFor(
			[
				'[scene]',
				'cast:',
				'  mira: {at: 0}',
				'  joren: {at: 0.3, z: 2}',
				'beats:',
				'  - mira: {z: 1}',
				'  - joren: {at: 0.4}'
			].join('\n'),
			2
		);

		expect(blocks.get('mira')).toBe('beat');
		expect(blocks.get('joren')).toBe('entry');
	});
});
