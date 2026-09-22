/**
 * One press of Left is one LINE back, not one beat back.
 *
 * The distinction is the whole feature: a scene is mostly machinery (`set`, `fx`, `wait`)
 * between the few beats a reader actually stands on, and a back key that counted machinery
 * would need four presses to undo a line and would spend three of them changing nothing
 * visible.
 */

import type {Beat} from '@sliders/scene-types';
import {
	SCENE_START,
	currentStop,
	lastStop,
	previousStop,
	stopIndices
} from '../beat-steps';

/** Just enough beat to have a `kind`. The step math reads nothing else. */
function beats(...kinds: string[]): Beat[] {
	return kinds.map(kind => ({kind} as unknown as Beat));
}

describe('stopIndices', () => {
	it('keeps only the beats a reader stands on', () => {
		expect(
			stopIndices(beats('set', 'say', 'fx', 'box', 'wait', 'say'))
		).toEqual([1, 3, 5]);
	});

	it('is empty for a scene that only stages things', () => {
		expect(stopIndices(beats('set', 'fx'))).toEqual([]);
		expect(stopIndices([])).toEqual([]);
	});
});

describe('currentStop', () => {
	// `beatIndex` is the beat that has NOT run yet, so the line on screen is the last stop
	// strictly before it.
	it('is the last stop before the player cursor', () => {
		const stops = [1, 3, 5];

		expect(currentStop(stops, 2)).toBe(1);
		expect(currentStop(stops, 4)).toBe(3);
		expect(currentStop(stops, 6)).toBe(5);
	});

	it('is the scene start before anything has been said', () => {
		expect(currentStop([1, 3], 0)).toBe(SCENE_START);
		expect(currentStop([], 4)).toBe(SCENE_START);
	});
});

describe('previousStop', () => {
	it('walks back one line at a time', () => {
		const stops = [1, 3, 5];

		expect(previousStop(stops, 5)).toBe(3);
		expect(previousStop(stops, 3)).toBe(1);
	});

	it('lands on the scene start from the first line', () => {
		expect(previousStop([1, 3, 5], 1)).toBe(SCENE_START);
		expect(previousStop([1, 3, 5], SCENE_START)).toBe(SCENE_START);
	});
});

describe('lastStop', () => {
	// Where a reader walking backwards INTO a scene arrives.
	it('is the last line of the scene', () => {
		expect(lastStop([1, 3, 5])).toBe(5);
	});

	it('is the scene start when nothing is ever said', () => {
		expect(lastStop([])).toBe(SCENE_START);
	});
});
