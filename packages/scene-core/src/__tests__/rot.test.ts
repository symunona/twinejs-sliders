/**
 * `rot` through the merge and the differ.
 *
 * The one rule worth pinning: absent and 0 are the SAME rotation, so an entity that gains
 * an explicit `rot: 0` has not turned and must produce no transition — while an entity that
 * gains `rot: 15` must produce one of its own kind, not a `move`.
 */

import {emptyStage} from '@sliders/scene-types';
import type {Stage, StageEntity} from '@sliders/scene-types';
import {diffStages} from '../diff-stages';
import {materialize, mergePatch} from '../stage';

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

function stage(mira: StageEntity): Stage {
	return {...emptyStage(), entities: {mira}};
}

describe('mergePatch', () => {
	it('sets a tilt', () => {
		expect(mergePatch(entity(), {rot: 15}).rot).toBe(15);
	});

	it('leaves an existing tilt alone when the patch says nothing', () => {
		expect(mergePatch(entity({rot: 15}), {at: {x: 0.3, y: -0.85}}).rot).toBe(15);
	});

	it('takes an explicit zero back to upright', () => {
		expect(mergePatch(entity({rot: 15}), {rot: 0}).rot).toBe(0);
	});
});

describe('materialize', () => {
	it('leaves rot absent rather than defaulting it', () => {
		expect(materialize('tankard', {kind: 'prop', ref: 'tankard'}).rot).toBeUndefined();
	});

	it('carries a tilt from the patch', () => {
		expect(materialize('sign', {kind: 'prop', ref: 'sign', rot: -6}).rot).toBe(-6);
	});
});

describe('diffStages', () => {
	it('reports a rot transition of its own kind', () => {
		const out = diffStages(stage(entity()), stage(entity({rot: 15})));

		expect(out).toEqual([
			{duration: 0.3, entityId: 'mira', from: 0, kind: 'rot', to: 15}
		]);
	});

	it('says nothing when an absent tilt becomes an explicit zero', () => {
		const out = diffStages(stage(entity()), stage(entity({rot: 0})));

		expect(out).toEqual([]);
	});

	it('reports a move and a rot separately when both change', () => {
		const out = diffStages(
			stage(entity()),
			stage(entity({at: {x: 0.4, y: -0.85}, rot: 10}))
		);

		expect(out.map(t => t.kind)).toEqual(['move', 'rot']);
	});
});
