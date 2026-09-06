import {
	ANCHOR_PRESETS,
	DEFAULT_ANCHOR,
	anchorPreset,
	roundAnchor,
	sameAnchor
} from '../anchor-presets';

describe('ANCHOR_PRESETS', () => {
	it('lays the nine spots out in grid order', () => {
		expect(ANCHOR_PRESETS.map(preset => preset.id)).toEqual([
			'top-left',
			'top-center',
			'top-right',
			'middle-left',
			'middle-center',
			'middle-right',
			'bottom-left',
			'bottom-center',
			'bottom-right'
		]);
	});

	it('names the default anchor', () => {
		expect(anchorPreset(DEFAULT_ANCHOR)).toBe('bottom-center');
	});
});

describe('anchorPreset', () => {
	it('matches an anchor a rounding step away from a preset', () => {
		expect(anchorPreset({x: 0.5, y: 0})).toBe('top-center');
		expect(anchorPreset({x: 0.5, y: 0.0004})).toBe('top-center');
	});

	it('leaves a hand-placed anchor unnamed', () => {
		expect(anchorPreset({x: 0.42, y: 0.9})).toBeUndefined();
		// Three decimals is the storage precision, so this is a point you can actually see
		// beside the preset, not a rounding artifact.
		expect(anchorPreset({x: 0.5, y: 0.002})).toBeUndefined();
	});

	it('has nothing to name without an anchor', () => {
		expect(anchorPreset(undefined)).toBeUndefined();
	});
});

describe('roundAnchor', () => {
	it('keeps three decimals', () => {
		expect(roundAnchor({x: 0.123456, y: 0.987654})).toEqual({x: 0.123, y: 0.988});
	});

	it('clamps to the frame', () => {
		expect(roundAnchor({x: -0.4, y: 3})).toEqual({x: 0, y: 1});
	});

	it('turns a non-number into a zero rather than passing it on', () => {
		expect(roundAnchor({x: NaN, y: 0.5})).toEqual({x: 0, y: 0.5});
	});
});

describe('sameAnchor', () => {
	it('compares by value, not identity', () => {
		expect(sameAnchor({x: 0.5, y: 1}, {x: 0.5, y: 1})).toBe(true);
		expect(sameAnchor({x: 0.5, y: 1}, {x: 0.5, y: 0.5})).toBe(false);
	});

	it('treats two missing anchors as the same and one as different', () => {
		expect(sameAnchor(undefined, undefined)).toBe(true);
		expect(sameAnchor(undefined, DEFAULT_ANCHOR)).toBe(false);
	});
});
