import {
	GRADE_KEYS,
	GRADE_RANGES,
	clampGradeValue,
	gradeDelta,
	mergeGrade,
	normalizeGrade,
	sameGrade
} from '../grade';

describe('grade helpers', () => {
	it('has a range for every key', () => {
		expect(Object.keys(GRADE_RANGES).sort()).toEqual([...GRADE_KEYS].sort());
	});

	it('normalizes: drops keys at rest, orders by slider, empty is undefined', () => {
		expect(normalizeGrade({gamma: 1, hue: 5, warmth: 0, brightness: 3})).toEqual({
			brightness: 3,
			hue: 5
		});
		expect(Object.keys(normalizeGrade({hue: 5, brightness: 3})!)).toEqual([
			'brightness',
			'hue'
		]);
		expect(normalizeGrade({gamma: 1})).toBeUndefined();
		expect(normalizeGrade(null)).toBeUndefined();
	});

	it('merges per key, a key at rest resetting it', () => {
		expect(mergeGrade({warmth: 30, brightness: -15}, {warmth: 60, hue: -10})).toEqual(
			{brightness: -15, hue: -10, warmth: 60}
		);
		expect(mergeGrade({warmth: 30}, {warmth: 0})).toBeUndefined();
	});

	it('compares absent and at rest as the same picture', () => {
		expect(sameGrade(undefined, {gamma: 1, warmth: 0})).toBe(true);
		expect(sameGrade({warmth: 1}, {warmth: 2})).toBe(false);
	});

	it('clamps into the range, NaN to rest', () => {
		expect(clampGradeValue('warmth', 150)).toBe(100);
		expect(clampGradeValue('gamma', 0)).toBe(0.1);
		expect(clampGradeValue('gamma', NaN)).toBe(1);
	});

	it('deltas: what a beat must say to get from base to next', () => {
		expect(
			gradeDelta({warmth: 30, brightness: -15}, {warmth: 60, brightness: -15, hue: -10})
		).toEqual({hue: -10, warmth: 60});
		// Back to rest is said out loud, because a beat inherits what it leaves out.
		expect(gradeDelta({warmth: 30}, undefined)).toEqual({warmth: 0});
		expect(gradeDelta({warmth: 30}, {warmth: 30})).toBeUndefined();
		expect(mergeGrade({warmth: 30}, gradeDelta({warmth: 30}, {hue: 4}))).toEqual({
			hue: 4
		});
	});
});
