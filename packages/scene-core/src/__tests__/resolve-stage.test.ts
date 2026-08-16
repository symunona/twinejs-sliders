import {emptyStage} from '@sliders/scene-types';
import type {Stage, StageEntity} from '@sliders/scene-types';
import {applyScene} from '../apply-scene';
import {diffStages} from '../diff-stages';
import {parentOffsets, resolveStage, worldPositions} from '../resolve-stage';

function entity(
	id: string,
	at: {x: number; y: number},
	of?: string
): StageEntity {
	return {
		at,
		flip: false,
		id,
		kind: 'prop',
		layer: 'mid',
		of,
		opacity: 1,
		ref: id,
		scale: 1
	};
}

function stageOf(...entities: StageEntity[]): Stage {
	const out = emptyStage();

	for (const e of entities) {
		out.entities[e.id] = e;
	}

	return out;
}

describe('worldPositions', () => {
	it('leaves a world-space entity where it is', () => {
		const stage = stageOf(entity('table', {x: -0.3, y: -0.85}));

		expect(worldPositions(stage)).toEqual({table: {x: -0.3, y: -0.85}});
	});

	it('adds a child to its parent', () => {
		const stage = stageOf(
			entity('table', {x: -0.3, y: -0.85}),
			entity('candle', {x: 0.1, y: 0.2}, 'table')
		);

		expect(worldPositions(stage).candle.x).toBeCloseTo(-0.2, 10);
		expect(worldPositions(stage).candle.y).toBeCloseTo(-0.65, 10);
	});

	it('follows a chain of any depth', () => {
		const stage = stageOf(
			entity('a', {x: 1, y: 1}),
			entity('b', {x: 1, y: 1}, 'a'),
			entity('c', {x: 1, y: 1}, 'b'),
			entity('d', {x: 1, y: 1}, 'c')
		);

		expect(worldPositions(stage).d).toEqual({x: 4, y: 4});
	});

	it('resolves independently of key insertion order', () => {
		const child = entity('candle', {x: 0.1, y: 0}, 'table');
		const parent = entity('table', {x: -0.3, y: 0});

		expect(worldPositions(stageOf(child, parent)).candle).toEqual(
			worldPositions(stageOf(parent, child)).candle
		);
	});

	// The net for everything the parser cannot see: a parent removed by a patch that left
	// its child behind, or a graph assembled across `from:`.
	it('drops an edge to a parent that is not on stage', () => {
		const stage = stageOf(entity('candle', {x: 0.1, y: 0.2}, 'ghost'));

		expect(worldPositions(stage).candle).toEqual({x: 0.1, y: 0.2});
	});

	it('drops a self-reference', () => {
		const stage = stageOf(entity('candle', {x: 0.1, y: 0.2}, 'candle'));

		expect(worldPositions(stage).candle).toEqual({x: 0.1, y: 0.2});
	});

	it('breaks a two-entity cycle instead of hanging', () => {
		const stage = stageOf(
			entity('a', {x: 1, y: 0}, 'b'),
			entity('b', {x: 2, y: 0}, 'a')
		);
		const world = worldPositions(stage);

		// `a` sorts first, so its edge is the one cut; `b` then hangs off it.
		expect(world.a).toEqual({x: 1, y: 0});
		expect(world.b).toEqual({x: 3, y: 0});
	});

	it('breaks a three-entity cycle instead of hanging', () => {
		const stage = stageOf(
			entity('a', {x: 1, y: 0}, 'c'),
			entity('b', {x: 2, y: 0}, 'a'),
			entity('c', {x: 4, y: 0}, 'b')
		);
		const world = worldPositions(stage);

		expect(world.a).toEqual({x: 1, y: 0});
		expect(world.b).toEqual({x: 3, y: 0});
		expect(world.c).toEqual({x: 7, y: 0});
	});
});

describe('resolveStage', () => {
	it('returns the same stage by identity when nothing uses of:', () => {
		const stage = stageOf(entity('table', {x: -0.3, y: 0}));

		expect(resolveStage(stage)).toBe(stage);
	});

	it('rewrites at to absolute and consumes of', () => {
		const stage = stageOf(
			entity('table', {x: -0.25, y: 0}),
			entity('candle', {x: 0.5, y: 0.25}, 'table')
		);
		const resolved = resolveStage(stage);

		expect(resolved.entities.candle.at).toEqual({x: 0.25, y: 0.25});
		expect(resolved.entities.candle.of).toBeUndefined();
	});

	// The reason `of` is stripped rather than left on for information: something further
	// down the pipeline resolving again must not offset twice.
	it('is idempotent', () => {
		const stage = stageOf(
			entity('table', {x: -0.3, y: 0}),
			entity('candle', {x: 0.1, y: 0.2}, 'table')
		);
		const once = resolveStage(stage);

		expect(resolveStage(once)).toEqual(once);
	});

	it('does not mutate the stage it was given', () => {
		const stage = stageOf(
			entity('table', {x: -0.3, y: 0}),
			entity('candle', {x: 0.1, y: 0.2}, 'table')
		);

		resolveStage(stage);

		expect(stage.entities.candle.at).toEqual({x: 0.1, y: 0.2});
		expect(stage.entities.candle.of).toBe('table');
	});

	it('keeps every other key', () => {
		const stage = stageOf(entity('table', {x: 0, y: 0}));

		stage.entities.candle = {
			...entity('candle', {x: 0.1, y: 0}, 'table'),
			flip: true,
			frame: 'lit',
			layer: 'front',
			opacity: 0.5,
			scale: 2,
			z: 3
		};

		expect(resolveStage(stage).entities.candle).toMatchObject({
			flip: true,
			frame: 'lit',
			kind: 'prop',
			layer: 'front',
			opacity: 0.5,
			ref: 'candle',
			scale: 2,
			z: 3
		});
	});

	// Translation only (D17). A parent's scale must not reach the child, or resolution
	// would need sprite metrics and could not live in scene-core at all.
	it('does not let a parent scale reach its child', () => {
		const stage = stageOf(entity('table', {x: 0, y: 0}), entity('candle', {x: 0.1, y: 0}, 'table'));

		stage.entities.table.scale = 4;

		const resolved = resolveStage(stage);

		expect(resolved.entities.candle.at).toEqual({x: 0.1, y: 0});
		expect(resolved.entities.candle.scale).toBe(1);
	});
});

describe('parentOffsets', () => {
	it('reports only the entities that have an honoured parent', () => {
		const stage = stageOf(
			entity('table', {x: -0.3, y: -0.85}),
			entity('candle', {x: 0.1, y: 0.2}, 'table'),
			entity('ghosted', {x: 0, y: 0}, 'nobody')
		);

		expect(parentOffsets(stage)).toEqual({candle: {x: -0.3, y: -0.85}});
	});

	// This is the identity the editor relies on: absolute minus offset is what gets written,
	// and writing it back must land the sprite where the author dropped it.
	it('inverts worldPositions', () => {
		const stage = stageOf(
			entity('a', {x: 0.2, y: 0.1}),
			entity('b', {x: -0.4, y: 0.3}, 'a'),
			entity('c', {x: 0.05, y: -0.2}, 'b')
		);
		const world = worldPositions(stage);
		const offsets = parentOffsets(stage);

		for (const id of ['a', 'b', 'c']) {
			const offset = offsets[id] ?? {x: 0, y: 0};

			expect(world[id].x - offset.x).toBeCloseTo(stage.entities[id].at.x, 10);
			expect(world[id].y - offset.y).toBeCloseTo(stage.entities[id].at.y, 10);
		}
	});
});

describe('diffing resolved stages', () => {
	/**
	 * The whole reason resolution lives in scene-core. In authored space the child's `at`
	 * is identical before and after, so a differ that never saw absolute coordinates would
	 * emit nothing for it — the parent would glide and the child would jump.
	 */
	it('emits a move for a child whose parent moved', () => {
		const before = stageOf(
			entity('table', {x: -0.3, y: 0}),
			entity('candle', {x: 0.1, y: 0}, 'table')
		);
		const after = stageOf(
			entity('table', {x: 0.4, y: 0}),
			entity('candle', {x: 0.1, y: 0}, 'table')
		);

		const resolved = diffStages(resolveStage(before), resolveStage(after));

		expect(resolved.map(t => [t.kind, t.entityId])).toEqual(
			expect.arrayContaining([
				['move', 'table'],
				['move', 'candle']
			])
		);

		// The same diff without resolving: the candle's authored `at` is identical on both
		// sides, so nothing is emitted for it. This is the bug resolution exists to prevent.
		expect(diffStages(before, after).filter(t => t.entityId === 'candle')).toEqual(
			[]
		);
	});
});

describe('of: through the merge rules', () => {
	it('materializes of on a brand-new entity', () => {
		const stage = applyScene(emptyStage(), {
			beats: [],
			entities: {
				candle: {at: {x: 0.1, y: 0}, kind: 'prop', of: 'table', ref: 'candle'},
				table: {at: {x: -0.3, y: 0}, kind: 'prop', ref: 'table'}
			},
			links: {}
		});

		expect(stage.entities.candle.of).toBe('table');
	});

	it('inherits of through a patch that does not mention it', () => {
		const base = applyScene(emptyStage(), {
			beats: [],
			entities: {
				candle: {at: {x: 0.1, y: 0}, kind: 'prop', of: 'table', ref: 'candle'},
				table: {at: {x: -0.3, y: 0}, kind: 'prop', ref: 'table'}
			},
			links: {}
		});
		const patched = applyScene(base, {
			beats: [],
			entities: {candle: {at: {x: 0.2, y: 0}, kind: 'prop', ref: 'candle'}},
			from: 'base',
			links: {}
		});

		expect(patched.entities.candle.of).toBe('table');
		expect(patched.entities.candle.at).toEqual({x: 0.2, y: 0});
	});

	// `of: ~`. The one key a patch can clear, because "absent means inherited" leaves a
	// patch scene no other way to put a child back in world space.
	it('detaches on an explicit null', () => {
		const base = applyScene(emptyStage(), {
			beats: [],
			entities: {
				candle: {at: {x: 0.1, y: 0}, kind: 'prop', of: 'table', ref: 'candle'},
				table: {at: {x: -0.3, y: 0}, kind: 'prop', ref: 'table'}
			},
			links: {}
		});
		const patched = applyScene(base, {
			beats: [],
			entities: {candle: {kind: 'prop', of: null, ref: 'candle'}},
			from: 'base',
			links: {}
		});

		expect(patched.entities.candle.of).toBeUndefined();
		expect(resolveStage(patched).entities.candle.at).toEqual({x: 0.1, y: 0});
	});
});
