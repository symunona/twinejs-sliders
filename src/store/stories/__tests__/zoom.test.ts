import {clampZoom, maxZoom, minZoom, steppedZoom} from '../zoom';

describe('clampZoom', () => {
	it('holds a zoom between the minimum and maximum', () => {
		expect(clampZoom(0.01)).toBe(minZoom);
		expect(clampZoom(10)).toBe(maxZoom);
		expect(clampZoom(0.8)).toBe(0.8);
	});
});

describe('steppedZoom', () => {
	it('steps between levels', () => {
		expect(steppedZoom(1, 1)).toBe(1.25);
		expect(steppedZoom(1, -1)).toBe(0.9);
	});

	it('steps from between levels to the next one in that direction', () => {
		expect(steppedZoom(0.93, 1)).toBe(1);
		expect(steppedZoom(0.93, -1)).toBe(0.9);
	});

	it('treats a zoom a hair off a level as that level', () => {
		expect(steppedZoom(0.6000001, 1)).toBe(0.75);
	});

	it('stays put at either end', () => {
		expect(steppedZoom(maxZoom, 1)).toBe(maxZoom);
		expect(steppedZoom(minZoom, -1)).toBe(minZoom);
	});
});
