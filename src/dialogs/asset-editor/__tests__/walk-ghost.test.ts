import {SceneStep} from '@sliders/scene-types';
import {facingAfter} from '../walk-ghost';

function step(flip?: boolean): SceneStep {
	return {dur: 0.1, flip, name: 'walk#1'};
}

describe('facingAfter', () => {
	it('keeps the way the last step faced', () => {
		expect(facingAfter([step(false), step(true)], false)).toBe(true);
		expect(facingAfter([step(true), step(false)], true)).toBe(false);
	});

	it('keeps the old facing when there is nothing to read', () => {
		expect(facingAfter([], true)).toBe(true);
		expect(facingAfter([step(undefined)], true)).toBe(true);
	});
});
