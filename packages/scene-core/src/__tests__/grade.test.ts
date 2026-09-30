/**
 * `grade` through the merge and the differ.
 *
 * The rule: a beat's grade MERGES per key over the one the entity has. A key at rest resets
 * that key, `null` clears the lot, and a change is a `grade` transition of its own so the
 * renderer can fade it.
 */

import {emptyStage} from '@sliders/scene-types';
import type {Stage, StageEntity} from '@sliders/scene-types';
import {parseScene} from '@sliders/scene-schema';
import {applyScene} from '../apply-scene';
import {diffStages} from '../diff-stages';
import {runBeats} from '../run-beats';
import {materialize, mergePatch} from '../stage';

function entity(over: Partial<StageEntity> = {}): StageEntity {
	return {
		at: {x: 0, y: -0.85},
		flip: false,
		id: 'hero',
		kind: 'cast',
		opacity: 1,
		ref: 'hero',
		scale: 1,
		...over
	};
}

function stage(hero: StageEntity): Stage {
	return {...emptyStage(), entities: {hero}};
}

describe('mergePatch', () => {
	it('merges a beat grade over the current one, key by key', () => {
		expect(
			mergePatch(entity({grade: {brightness: -15, warmth: 30}}), {
				grade: {hue: -10, warmth: 60}
			}).grade
		).toEqual({brightness: -15, hue: -10, warmth: 60});
	});

	it('resets one key with its rest value, and drops it', () => {
		expect(
			mergePatch(entity({grade: {brightness: -15, warmth: 30}}), {
				grade: {warmth: 0}
			}).grade
		).toEqual({brightness: -15});
	});

	it('clears the whole grade on null', () => {
		expect(
			mergePatch(entity({grade: {warmth: 30}}), {grade: null}).grade
		).toBeUndefined();
	});

	it('leaves the grade alone when the patch says nothing', () => {
		expect(
			mergePatch(entity({grade: {warmth: 30}}), {at: {x: 1, y: 0}}).grade
		).toEqual({warmth: 30});
	});

	it('does not share the grade object with the entity it came from', () => {
		const before = entity({grade: {warmth: 30}});
		const after = mergePatch(before, {at: {x: 1, y: 0}});

		after.grade!.warmth = 99;
		expect(before.grade).toEqual({warmth: 30});
	});
});

describe('materialize', () => {
	it('drops keys at rest, and an empty grade altogether', () => {
		expect(
			materialize('hero', {grade: {gamma: 1, warmth: 0}, kind: 'cast', ref: 'hero'})
				.grade
		).toBeUndefined();
		expect(
			materialize('hero', {grade: {gamma: 1.2, warmth: 0}, kind: 'cast', ref: 'hero'})
				.grade
		).toEqual({gamma: 1.2});
	});
});

describe('diffStages', () => {
	it('reports a grade transition of its own kind', () => {
		expect(
			diffStages(stage(entity()), stage(entity({grade: {warmth: 30}})))
		).toEqual([
			{
				duration: 0.5,
				entityId: 'hero',
				from: undefined,
				kind: 'grade',
				to: {warmth: 30}
			}
		]);
	});

	it('says nothing when absent becomes all-at-rest', () => {
		expect(
			diffStages(stage(entity()), stage(entity({grade: {warmth: 0}})))
		).toEqual([]);
	});

	it('reports a move and a grade separately when both change', () => {
		const out = diffStages(
			stage(entity({grade: {warmth: 30}})),
			stage(entity({at: {x: 0.4, y: -0.85}, grade: {warmth: 60}}))
		);

		expect(out.map(t => t.kind)).toEqual(['move', 'grade']);
	});
});

describe('a scene', () => {
	it('carries the grade from cast: through its beats', () => {
		const {scene} = parseScene(
			[
				'cast:',
				'  hero: {at: 0, grade: {warmth: 30, brightness: -15, saturation: -20}}',
				'beats:',
				'  - hero: {grade: {warmth: 60, hue: -10}}',
				'  - hero: {say: "Still warm."}',
				'  - hero: {grade: {brightness: 0}}',
				'  - hero: {grade: ~}'
			].join('\n')
		);
		const start = applyScene(emptyStage(), scene);
		const states = runBeats(start, scene.beats);

		expect(start.entities.hero.grade).toEqual({
			brightness: -15,
			saturation: -20,
			warmth: 30
		});
		expect(states.map(state => state.entities.hero.grade)).toEqual([
			{brightness: -15, saturation: -20, warmth: 30},
			{brightness: -15, hue: -10, saturation: -20, warmth: 60},
			{brightness: -15, hue: -10, saturation: -20, warmth: 60},
			{hue: -10, saturation: -20, warmth: 60},
			undefined
		]);
		expect(
			diffStages(states[0], states[1]).map(t => t.kind)
		).toEqual(['grade']);
		expect(diffStages(states[1], states[2])).toEqual([]);
	});
});
