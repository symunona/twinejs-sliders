/**
 * A frame cycle through the scene -> stage path — the one the PLAYER walks.
 *
 * `frame` and `frames` are two halves of one YAML key, and `mergePatch` is where that costs
 * something: `frames` is absent both when the author wrote nothing and when they wrote a
 * still pose, and those two mean opposite things under `from:` and from beat to beat. The
 * rule is read off `frame`, so that is what is pinned here.
 */

import {emptyStage} from '@sliders/scene-types';
import type {Scene, StageEntity} from '@sliders/scene-types';
import {applyScene} from '../apply-scene';
import {diffStages} from '../diff-stages';
import {materialize, mergePatch} from '../stage';

const WALK = [
	{name: 'walk_1', dur: 0.1},
	{name: 'walk_2', dur: 0.1}
];

function scene(over: Partial<Scene> = {}): Scene {
	return {beats: [], entities: {}, links: {}, ...over};
}

function entity(over: Partial<StageEntity> = {}): StageEntity {
	return {
		at: {x: 0, y: -0.85},
		flip: false,
		id: 'mira',
		kind: 'cast',
		opacity: 1,
		ref: 'mira',
		scale: 1,
		...over
	};
}

describe('frame cycles through applyScene', () => {
	it('carries a cycle onto the stage', () => {
		const out = applyScene(
			emptyStage(),
			scene({
				entities: {
					mira: {frame: 'walk_1', frames: WALK, kind: 'cast', ref: 'mira'}
				}
			})
		);

		expect(out.entities.mira.frames).toEqual(WALK);
		expect(out.entities.mira.frame).toBe('walk_1');
	});

	it('inherits a cycle through from:', () => {
		const base = applyScene(
			emptyStage(),
			scene({
				entities: {
					mira: {frame: 'walk_1', frames: WALK, kind: 'cast', ref: 'mira'}
				}
			})
		);
		const out = applyScene(
			base,
			scene({
				entities: {
					mira: {at: {x: 0.5, y: -0.85}, kind: 'cast', ref: 'mira'}
				},
				from: 'other'
			})
		);

		expect(out.entities.mira.frames).toEqual(WALK);
		expect(out.entities.mira.at.x).toBe(0.5);
	});

	it('stops a cycle when a patch names a still pose', () => {
		const walking = entity({frame: 'walk_1', frames: WALK});
		const out = mergePatch(walking, {frame: 'idle'});

		expect(out.frame).toBe('idle');
		// Otherwise the pose would swap while the legs kept walking: the renderer's own
		// clock would overwrite `idle` on its next tick.
		expect(out.frames).toBeUndefined();
	});

	it('leaves a cycle alone when a patch says nothing about frames', () => {
		const walking = entity({frame: 'walk_1', frames: WALK});
		const out = mergePatch(walking, {at: {x: 0.2, y: -0.85}});

		expect(out.frames).toEqual(WALK);
	});

	it('never shares a step object with the patch it came from', () => {
		const patch = {frame: 'walk_1', frames: WALK, kind: 'cast' as const, ref: 'mira'};
		const made = materialize('mira', patch);

		expect(made.frames).toEqual(WALK);
		expect(made.frames?.[0]).not.toBe(WALK[0]);
	});

	it('reports a frame transition when only the cycle changed', () => {
		// Both stages say `frame: walk_1`, so comparing that string alone would report
		// nothing and the renderer would never restart the cycle.
		const before = {...emptyStage(), entities: {mira: entity({frame: 'walk_1', frames: WALK})}};
		const after = {
			...emptyStage(),
			entities: {
				mira: entity({
					frame: 'walk_1',
					frames: [{name: 'walk_1'}, {name: 'walk_3'}]
				})
			}
		};

		expect(diffStages(before, after).map(t => t.kind)).toContain('frame');
	});

	it('reports nothing when the cycle is unchanged', () => {
		const one = {...emptyStage(), entities: {mira: entity({frame: 'walk_1', frames: WALK})}};
		const two = {
			...emptyStage(),
			entities: {mira: entity({frame: 'walk_1', frames: [...WALK.map(s => ({...s}))]})}
		};

		expect(diffStages(one, two)).toEqual([]);
	});
});
