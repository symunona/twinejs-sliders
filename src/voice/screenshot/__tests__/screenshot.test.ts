/** @jest-environment node */

import {SCREENSHOT_LONG_EDGE, scaleFor} from '../rasterise';
import {stateForBeat} from '../use-scene-screenshot';

describe('scaleFor', () => {
	it('shrinks a wide canvas to the long edge', () => {
		expect(scaleFor(1280, 720)).toBeCloseTo(768 / 1280, 5);
	});

	it('shrinks a tall canvas by its height', () => {
		expect(scaleFor(720, 1280)).toBeCloseTo(768 / 1280, 5);
	});

	it('never enlarges — a 320px stage is sent at 320px', () => {
		expect(scaleFor(320, 180)).toBe(1);
	});

	it('defaults to the documented long edge', () => {
		expect(SCREENSHOT_LONG_EDGE).toBe(768);
	});
});

describe('stateForBeat', () => {
	// States are S0..Sn: S0 is the stage before any beat ran, so beat N is state N+1.
	it('puts beat 0 on state 1', () => {
		expect(stateForBeat(0, 4)).toBe(1);
	});

	it('puts beat 2 on state 3', () => {
		expect(stateForBeat(2, 4)).toBe(3);
	});

	it('defaults to the opening SHOT, not the empty stage before it', () => {
		expect(stateForBeat(undefined, 4)).toBe(1);
	});

	it('defaults to state 0 for a scene that has no beats at all', () => {
		expect(stateForBeat(undefined, 1)).toBe(0);
	});

	it('clamps past the end rather than erroring', () => {
		expect(stateForBeat(9, 4)).toBe(3);
	});

	it('clamps a negative beat to the empty stage', () => {
		expect(stateForBeat(-5, 4)).toBe(0);
	});
});
