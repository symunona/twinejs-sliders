import {
	applyLut,
	buildLut,
	clampCrop,
	cropFromDrag,
	defaultEdits,
	isNeutral,
	isUnedited
} from '../image-edits';

describe('buildLut', () => {
	it('leaves every value alone when nothing is adjusted', () => {
		const lut = buildLut(0, 0, 1);

		for (let value = 0; value < 256; value++) {
			expect(lut[value]).toBe(value);
		}
	});

	it('shifts values up and down with brightness', () => {
		expect(buildLut(50, 0, 1)[100]).toBeGreaterThan(100);
		expect(buildLut(-50, 0, 1)[100]).toBeLessThan(100);
	});

	it('pushes values away from the midpoint with contrast', () => {
		const lut = buildLut(0, 50, 1);

		expect(lut[200]).toBeGreaterThan(200);
		expect(lut[50]).toBeLessThan(50);
		expect(lut[128]).toBe(128);
	});

	it('lifts midtones as gamma rises, without moving the ends', () => {
		const lut = buildLut(0, 0, 2);

		expect(lut[128]).toBeGreaterThan(128);
		expect(lut[0]).toBe(0);
		expect(lut[255]).toBe(255);
	});

	it('clamps instead of wrapping around', () => {
		const lut = buildLut(100, 100, 1);

		expect(lut[255]).toBe(255);
		expect(buildLut(-100, 0, 1)[0]).toBe(0);
	});
});

describe('applyLut', () => {
	it('maps color channels but not alpha', () => {
		const lut = buildLut(0, 0, 1);

		lut[10] = 200;

		const pixels = new Uint8ClampedArray([10, 10, 10, 10]);

		applyLut(pixels, lut);
		expect(Array.from(pixels)).toEqual([200, 200, 200, 10]);
	});
});

describe('clampCrop', () => {
	it('keeps the rectangle inside the image', () => {
		expect(clampCrop({h: 500, w: 500, x: -10, y: 90}, 100, 100)).toEqual({
			h: 10,
			w: 100,
			x: 0,
			y: 90
		});
	});

	it('never shrinks below a pixel', () => {
		expect(clampCrop({h: 0, w: 0, x: 10, y: 10}, 100, 100)).toEqual({
			h: 1,
			w: 1,
			x: 10,
			y: 10
		});
	});
});

describe('cropFromDrag', () => {
	it('works in whichever direction the drag went', () => {
		const forward = cropFromDrag({x: 10, y: 20}, {x: 60, y: 80}, 100, 100);

		expect(forward).toEqual({h: 60, w: 50, x: 10, y: 20});
		expect(cropFromDrag({x: 60, y: 80}, {x: 10, y: 20}, 100, 100)).toEqual(
			forward
		);
	});
});

describe('isNeutral and isUnedited', () => {
	it('recognize an untouched image', () => {
		const edits = defaultEdits(320, 240);

		expect(isNeutral(edits)).toBe(true);
		expect(isUnedited(edits, 320, 240)).toBe(true);
	});

	it('notice a crop even when the sliders are at rest', () => {
		const edits = {
			...defaultEdits(320, 240),
			crop: {h: 100, w: 100, x: 0, y: 0}
		};

		expect(isNeutral(edits)).toBe(true);
		expect(isUnedited(edits, 320, 240)).toBe(false);
	});

	it('notice an adjustment', () => {
		const edits = {...defaultEdits(320, 240), gamma: 1.5};

		expect(isNeutral(edits)).toBe(false);
		expect(isUnedited(edits, 320, 240)).toBe(false);
	});
});
