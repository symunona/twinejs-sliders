import {emptyStage} from '@sliders/scene-types';
import type {Stage, StageEntity, Transition} from '@sliders/scene-types';
import {DEFAULT_DURATIONS, diffStages} from '../diff-stages';

function entity(id: string, partial: Partial<StageEntity> = {}): StageEntity {
	return {
		at: {x: 0, y: 0},
		flip: false,
		id,
		kind: 'cast',
		layer: 'mid',
		opacity: 1,
		ref: id,
		scale: 1,
		...partial
	};
}

function stage(partial: Partial<Stage> = {}): Stage {
	return {...emptyStage(), ...partial};
}

function stageWith(...entities: StageEntity[]): Stage {
	const record: Record<string, StageEntity> = {};

	for (const e of entities) {
		record[e.id] = e;
	}

	return stage({entities: record});
}

function kinds(transitions: Transition[]): string[] {
	return transitions.map(t => t.kind);
}

function only(transitions: Transition[], kind: string): Transition[] {
	return transitions.filter(t => t.kind === kind);
}

describe('diffStages', () => {
	it('finds nothing between identical stages', () => {
		expect(diffStages(stageWith(entity('mira')), stageWith(entity('mira')))).toEqual([]);
	});

	it('finds nothing between two empty stages', () => {
		expect(diffStages(emptyStage(), emptyStage())).toEqual([]);
	});

	describe('enter and exit', () => {
		it('reports an entity that appears', () => {
			const next = entity('mira', {at: {x: -0.4, y: 0}});
			const transitions = diffStages(emptyStage(), stageWith(next));

			expect(transitions).toEqual([
				{
					duration: DEFAULT_DURATIONS.enter,
					entityId: 'mira',
					kind: 'enter',
					to: next
				}
			]);
		});

		it('reports an entity that disappears', () => {
			const prev = entity('mira');
			const transitions = diffStages(stageWith(prev), emptyStage());

			expect(transitions).toEqual([
				{
					duration: DEFAULT_DURATIONS.exit,
					entityId: 'mira',
					from: prev,
					kind: 'exit'
				}
			]);
		});

		it('separates the enter, exit and unchanged sets', () => {
			const prev = stageWith(entity('mira'), entity('joren'), entity('candle'));
			const next = stageWith(entity('mira'), entity('candle'), entity('sara'));
			const transitions = diffStages(prev, next);

			expect(only(transitions, 'exit').map(t => t.entityId)).toEqual(['joren']);
			expect(only(transitions, 'enter').map(t => t.entityId)).toEqual(['sara']);
			expect(transitions).toHaveLength(2);
		});

		it('treats a swapped ref under one id as an exit plus an enter', () => {
			const prev = stageWith(entity('speaker', {ref: 'mira'}));
			const next = stageWith(entity('speaker', {ref: 'joren'}));

			expect(kinds(diffStages(prev, next))).toEqual(['exit', 'enter']);
		});

		it('is deterministic in entity order regardless of insertion order', () => {
			const a = stageWith(entity('a'), entity('b'), entity('c'));
			const b = stageWith(entity('c'), entity('b'), entity('a'));

			expect(diffStages(emptyStage(), a)).toEqual(diffStages(emptyStage(), b));
			expect(diffStages(emptyStage(), a).map(t => t.entityId)).toEqual([
				'a',
				'b',
				'c'
			]);
		});
	});

	describe('per-entity changes', () => {
		it('reports a move when at changes', () => {
			const transitions = diffStages(
				stageWith(entity('mira', {at: {x: -0.4, y: 0}})),
				stageWith(entity('mira', {at: {x: 0.2, y: 0}}))
			);

			expect(transitions).toHaveLength(1);
			expect(transitions[0]).toMatchObject({
				entityId: 'mira',
				from: {at: {x: -0.4, y: 0}},
				kind: 'move',
				to: {at: {x: 0.2, y: 0}}
			});
		});

		it('reports a move when only y changes', () => {
			expect(
				kinds(
					diffStages(
						stageWith(entity('mira', {at: {x: 0, y: 0.4}})),
						stageWith(entity('mira', {at: {x: 0, y: -0.4}}))
					)
				)
			).toEqual(['move']);
		});

		it('reports a move when layer, z or opacity change', () => {
			const base = stageWith(entity('mira'));

			expect(kinds(diffStages(base, stageWith(entity('mira', {layer: 'front'}))))).toEqual(
				['move']
			);
			expect(kinds(diffStages(base, stageWith(entity('mira', {z: 3}))))).toEqual([
				'move'
			]);
			expect(kinds(diffStages(base, stageWith(entity('mira', {opacity: 0}))))).toEqual([
				'move'
			]);
		});

		it('reports a frame change', () => {
			const transitions = diffStages(
				stageWith(entity('mira', {frame: 'idle'})),
				stageWith(entity('mira', {frame: 'angry'}))
			);

			expect(transitions).toEqual([
				{
					duration: DEFAULT_DURATIONS.frame,
					entityId: 'mira',
					from: 'idle',
					kind: 'frame',
					to: 'angry'
				}
			]);
		});

		it('reports a frame change from nothing', () => {
			const transitions = diffStages(
				stageWith(entity('mira')),
				stageWith(entity('mira', {frame: 'wave'}))
			);

			expect(transitions[0]).toMatchObject({from: undefined, kind: 'frame', to: 'wave'});
		});

		it('reports a flip change', () => {
			const transitions = diffStages(
				stageWith(entity('mira', {flip: false})),
				stageWith(entity('mira', {flip: true}))
			);

			expect(transitions).toEqual([
				{
					duration: DEFAULT_DURATIONS.flip,
					entityId: 'mira',
					from: false,
					kind: 'flip',
					to: true
				}
			]);
		});

		it('reports a scale change', () => {
			const transitions = diffStages(
				stageWith(entity('mira', {scale: 1})),
				stageWith(entity('mira', {scale: 1.15}))
			);

			expect(transitions).toEqual([
				{
					duration: DEFAULT_DURATIONS.scale,
					entityId: 'mira',
					from: 1,
					kind: 'scale',
					to: 1.15
				}
			]);
		});

		it('keeps scale out of move, so a resize can be timed on its own', () => {
			const transitions = diffStages(
				stageWith(entity('mira', {at: {x: -0.4, y: 0}, scale: 1})),
				stageWith(entity('mira', {at: {x: 0.1, y: 0}, scale: 2}))
			);

			expect(kinds(transitions)).toEqual(['move', 'scale']);
			expect(only(transitions, 'move')[0].to).not.toHaveProperty('scale');
		});

		it('reports move, frame and flip together for one entity', () => {
			const transitions = diffStages(
				stageWith(entity('mira', {at: {x: -0.4, y: 0}, flip: false, frame: 'idle'})),
				stageWith(entity('mira', {at: {x: 0.1, y: 0}, flip: true, frame: 'angry'}))
			);

			expect(kinds(transitions)).toEqual(['move', 'frame', 'flip']);
			expect(transitions.every(t => t.entityId === 'mira')).toBe(true);
		});

		it('does not report a move for an entity that entered', () => {
			const transitions = diffStages(
				emptyStage(),
				stageWith(entity('mira', {at: {x: 0.5, y: 0}, frame: 'idle'}))
			);

			expect(kinds(transitions)).toEqual(['enter']);
		});
	});

	describe('stage-wide changes', () => {
		it('reports a bg change', () => {
			const transitions = diffStages(
				stage({bg: 'tavern/night'}),
				stage({bg: 'street/day'})
			);

			expect(transitions).toEqual([
				{
					duration: DEFAULT_DURATIONS.bg,
					from: 'tavern/night',
					kind: 'bg',
					to: 'street/day'
				}
			]);
		});

		it('reports a bg being cleared', () => {
			expect(diffStages(stage({bg: 'a'}), stage({}))[0]).toMatchObject({
				from: 'a',
				kind: 'bg',
				to: undefined
			});
		});

		it('reports a camera change', () => {
			const prev = stage();
			const next = stage({camera: {at: {x: 0.2, y: 0}, zoom: 1.5}});
			const transitions = diffStages(prev, next);

			expect(transitions).toHaveLength(1);
			expect(transitions[0]).toMatchObject({
				from: {at: {x: 0, y: 0}, zoom: 1},
				kind: 'camera',
				to: {at: {x: 0.2, y: 0}, zoom: 1.5}
			});
		});

		it('reports fx starting, changing and stopping', () => {
			const prev = stage({fx: [{amount: 0.6, id: 'rain'}, {amount: 1, id: 'fog'}]});
			const next = stage({
				fx: [{amount: 0.2, id: 'rain'}, {amount: 1, id: 'thunder'}]
			});
			const transitions = diffStages(prev, next);

			expect(transitions).toEqual([
				{
					duration: DEFAULT_DURATIONS.fx,
					from: {amount: 1, id: 'fog'},
					kind: 'fx',
					to: undefined
				},
				{
					duration: DEFAULT_DURATIONS.fx,
					from: {amount: 0.6, id: 'rain'},
					kind: 'fx',
					to: {amount: 0.2, id: 'rain'}
				},
				{
					duration: DEFAULT_DURATIONS.fx,
					from: undefined,
					kind: 'fx',
					to: {amount: 1, id: 'thunder'}
				}
			]);
		});

		it('ignores fx reordering', () => {
			const prev = stage({fx: [{amount: 1, id: 'a'}, {amount: 1, id: 'b'}]});
			const next = stage({fx: [{amount: 1, id: 'b'}, {amount: 1, id: 'a'}]});

			expect(diffStages(prev, next)).toEqual([]);
		});
	});

	it('orders bg, camera, entities then fx', () => {
		const prev = stage({bg: 'a', entities: {mira: entity('mira')}});
		const next = stage({
			bg: 'b',
			camera: {at: {x: 0.1, y: 0}, zoom: 1},
			entities: {mira: entity('mira', {frame: 'angry'})},
			fx: [{amount: 1, id: 'rain'}]
		});

		expect(kinds(diffStages(prev, next))).toEqual([
			'bg',
			'camera',
			'frame',
			'fx'
		]);
	});

	it('gives every transition a numeric duration', () => {
		const transitions = diffStages(
			stage({bg: 'a', entities: {joren: entity('joren'), mira: entity('mira')}}),
			stage({
				bg: 'b',
				entities: {mira: entity('mira', {at: {x: 1, y: 0}}), sara: entity('sara')},
				fx: [{amount: 1, id: 'rain'}]
			})
		);

		for (const transition of transitions) {
			expect(typeof transition.duration).toBe('number');
			expect(transition.duration).toBeGreaterThanOrEqual(0);
		}
	});

	it('never mutates either stage', () => {
		const prev = stageWith(entity('mira'));
		const next = stageWith(entity('joren'));
		const snapshot = [JSON.stringify(prev), JSON.stringify(next)];

		diffStages(prev, next);
		expect([JSON.stringify(prev), JSON.stringify(next)]).toEqual(snapshot);
	});
});
