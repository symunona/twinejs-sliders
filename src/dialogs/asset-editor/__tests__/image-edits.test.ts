import {
	anchorAfterCrop,
	anchorBeforeCrop,
	applyColorMatrix,
	applyLut,
	buildChannelLuts,
	buildColorMatrix,
	buildLut,
	clampCrop,
	cropFromDrag,
	defaultEdits,
	ImageEdits,
	isNeutral,
	isUnedited,
	sameEdits,
	sameTuning,
	ToneEdits
} from '../image-edits';

/** Tone edits with everything at rest, so a test only spells out what it is about. */
function tone(over: Partial<ToneEdits> = {}): ToneEdits {
	return {brightness: 0, contrast: 0, gamma: 1, ...over};
}

/** Fails if a curve ever comes back down, which would invert part of a gradient. */
function expectMonotonic(lut: Uint8ClampedArray) {
	for (let value = 1; value < 256; value++) {
		expect(lut[value]).toBeGreaterThanOrEqual(lut[value - 1]);
	}
}

describe('buildLut', () => {
	it('leaves every value alone when nothing is adjusted', () => {
		const lut = buildLut(tone());

		for (let value = 0; value < 256; value++) {
			expect(lut[value]).toBe(value);
		}
	});

	it('shifts values up and down with brightness', () => {
		expect(buildLut(tone({brightness: 50}))[100]).toBeGreaterThan(100);
		expect(buildLut(tone({brightness: -50}))[100]).toBeLessThan(100);
	});

	it('pushes values away from the midpoint with contrast', () => {
		const lut = buildLut(tone({contrast: 50}));

		expect(lut[200]).toBeGreaterThan(200);
		expect(lut[50]).toBeLessThan(50);
		expect(lut[128]).toBe(128);
	});

	it('lifts midtones as gamma rises, without moving the ends', () => {
		const lut = buildLut(tone({gamma: 2}));

		expect(lut[128]).toBeGreaterThan(128);
		expect(lut[0]).toBe(0);
		expect(lut[255]).toBe(255);
	});

	it('clamps instead of wrapping around', () => {
		const lut = buildLut(tone({brightness: 100, contrast: 100}));

		expect(lut[255]).toBe(255);
		expect(buildLut(tone({brightness: -100}))[0]).toBe(0);
	});

	it('lifts the dark end with shadows and leaves white where it is', () => {
		const lut = buildLut(tone({shadows: 100}));

		expect(lut[10]).toBeGreaterThan(10);
		expect(lut[255]).toBe(255);
		// A slider that reorders two tones turns a gradient inside out, so every one of
		// these curves has to stay monotonic at its limit.
		expectMonotonic(lut);
		expectMonotonic(buildLut(tone({shadows: -100})));
	});

	it('moves the bright end with highlights and leaves black where it is', () => {
		const lut = buildLut(tone({highlights: -100}));

		expect(lut[245]).toBeLessThan(245);
		expect(lut[0]).toBe(0);
		expectMonotonic(lut);
		expectMonotonic(buildLut(tone({highlights: 100})));
	});

	it('steepens the middle with pop, pinned at both ends', () => {
		const lut = buildLut(tone({pop: 100}));

		expect(lut[64]).toBeLessThan(64);
		expect(lut[192]).toBeGreaterThan(192);
		expect(lut[0]).toBe(0);
		expect(lut[255]).toBe(255);
		expectMonotonic(lut);
	});
});

describe('applyLut', () => {
	it('maps color channels but not alpha', () => {
		const lut = buildLut(tone());

		lut[10] = 200;

		const pixels = new Uint8ClampedArray([10, 10, 10, 10]);

		applyLut(pixels, lut);
		expect(Array.from(pixels)).toEqual([200, 200, 200, 10]);
	});
});

describe('buildChannelLuts', () => {
	const edits = () => defaultEdits(10, 10);

	it('hands the same table to all three channels when nothing pulls them apart', () => {
		const luts = buildChannelLuts({...edits(), contrast: 20});

		expect(luts.r).toBe(luts.g);
		expect(luts.g).toBe(luts.b);
	});

	it('trades blue for red with warmth, and back again', () => {
		const warm = buildChannelLuts({...edits(), warmth: 100});

		expect(warm.r[128]).toBeGreaterThan(128);
		expect(warm.b[128]).toBeLessThan(128);
		expect(warm.g[128]).toBe(128);

		const cool = buildChannelLuts({...edits(), warmth: -100});

		expect(cool.r[128]).toBeLessThan(128);
		expect(cool.b[128]).toBeGreaterThan(128);
	});

	it('trades magenta for green with tint, without moving the brightness much', () => {
		const luts = buildChannelLuts({...edits(), tint: 100});

		expect(luts.g[128]).toBeGreaterThan(128);
		expect(luts.r[128]).toBeLessThan(128);
		// Red and blue move together, so the shift is a hue and not a tilt towards one
		// corner of the picture's colour space.
		expect(luts.r[128]).toBe(luts.b[128]);
	});

	it('grades on top of the tone curve rather than instead of it', () => {
		const luts = buildChannelLuts({...edits(), brightness: 20, warmth: 100});

		expect(luts.g[128]).toBe(buildLut(tone({brightness: 20}))[128]);
		expect(luts.r[128]).toBeGreaterThan(luts.g[128]);
	});
});

describe('buildColorMatrix and applyColorMatrix', () => {
	const edits = () => defaultEdits(10, 10);

	/** One pixel, graded. */
	function graded(over: Partial<ImageEdits>, rgb: number[]) {
		const pixels = new Uint8ClampedArray([...rgb, 128]);

		applyColorMatrix(pixels, buildColorMatrix({...edits(), ...over}));

		return Array.from(pixels);
	}

	it('is the identity when nothing is set', () => {
		const matrix = buildColorMatrix(edits());

		[1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((expected, index) =>
			expect(matrix[index]).toBeCloseTo(expected)
		);
	});

	it('drains all the colour at -100 saturation, keeping the luminance', () => {
		const [r, g, b, a] = graded({saturation: -100}, [200, 100, 50]);

		expect(r).toBe(g);
		expect(g).toBe(b);
		// The CSS spec's luminance weights, which is what makes this grey and not an
		// average of the three.
		expect(r).toBeCloseTo(
			Math.round(0.213 * 200 + 0.715 * 100 + 0.072 * 50),
			0
		);
		expect(a).toBe(128);
	});

	it('pushes colour further apart at +100 saturation', () => {
		const [r, , b] = graded({saturation: 100}, [200, 100, 50]);

		expect(r).toBeGreaterThan(200);
		expect(b).toBeLessThan(50);
	});

	it('leaves grey alone whatever the hue is, and turns red towards green', () => {
		expect(graded({hue: 120}, [128, 128, 128]).slice(0, 3)).toEqual([
			128, 128, 128
		]);

		const [r, g] = graded({hue: 120}, [255, 0, 0]);

		expect(g).toBeGreaterThan(r);
	});

	it('lifts saturation a little for pop as well as bending the curve', () => {
		const [r] = graded({pop: 100}, [200, 100, 50]);

		expect(r).toBeGreaterThan(200);
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

	it('notice each of the colour sliders on its own', () => {
		const sliders: Partial<ImageEdits>[] = [
			{shadows: 10},
			{highlights: -10},
			{pop: 10},
			{saturation: -10},
			{warmth: 10},
			{tint: -10},
			{hue: 90}
		];

		for (const slider of sliders) {
			const edits = {...defaultEdits(320, 240), ...slider};

			expect(isNeutral(edits)).toBe(false);
			expect(isUnedited(edits, 320, 240)).toBe(false);
		}
	});

	it('read an absent colour slider and a zeroed one as the same rest', () => {
		const edits = {
			...defaultEdits(320, 240),
			highlights: 0,
			hue: 0,
			pop: 0,
			saturation: 0,
			shadows: 0,
			tint: 0,
			warmth: 0
		};

		expect(isNeutral(edits)).toBe(true);
		expect(isUnedited(edits, 320, 240)).toBe(true);
		expect(sameEdits(edits, defaultEdits(320, 240))).toBe(true);
	});
});

describe('anchorAfterCrop', () => {
	it('leaves the anchor alone when the crop is the whole image', () => {
		expect(
			anchorAfterCrop({x: 0.25, y: 0.75}, {h: 240, w: 320, x: 0, y: 0}, 320, 240)
		).toEqual({x: 0.25, y: 0.75});
	});

	it('re-reads the anchor against the cropped pixels', () => {
		// The anchor sits at 160, 120 in the source; the crop starts at 80, 60 and is half
		// the image, so the same pixel is the middle of what is left.
		expect(
			anchorAfterCrop({x: 0.5, y: 0.5}, {h: 120, w: 160, x: 80, y: 60}, 320, 240)
		).toEqual({x: 0.5, y: 0.5});
		expect(
			anchorAfterCrop({x: 0.5, y: 1}, {h: 120, w: 160, x: 0, y: 0}, 320, 240)
		).toEqual({x: 1, y: 1});
	});

	it('clamps an anchor the crop cut away to the nearest edge', () => {
		expect(
			anchorAfterCrop({x: 0.9, y: 0.1}, {h: 120, w: 160, x: 0, y: 120}, 320, 240)
		).toEqual({x: 1, y: 0});
	});

	it('keeps the anchor when the crop is empty', () => {
		expect(
			anchorAfterCrop({x: 0.25, y: 0.75}, {h: 0, w: 0, x: 0, y: 0}, 320, 240)
		).toEqual({x: 0.25, y: 0.75});
	});
});

describe('anchorBeforeCrop', () => {
	it('undoes anchorAfterCrop, so a reopened edit does not re-apply its crop', () => {
		const crop = {h: 400, w: 300, x: 100, y: 200};
		// Inside the crop: 200,500 of the source is 100..400 x 200..600 of the picture the
		// author will actually see.
		const origin = {x: 0.25, y: 0.5};
		const stored = anchorAfterCrop(origin, crop, 800, 1000);

		expect(anchorBeforeCrop(stored, crop, 800, 1000)).toEqual(origin);
	});

	it('leaves an uncropped anchor alone', () => {
		const crop = {h: 1000, w: 800, x: 0, y: 0};

		expect(anchorBeforeCrop({x: 0.25, y: 0.9}, crop, 800, 1000)).toEqual({
			x: 0.25,
			y: 0.9
		});
	});

	it('cannot recover an anchor that was clamped away', () => {
		// The point was outside the crop, so saving it recorded an edge and the original
		// position is genuinely gone. It comes back on that edge rather than wandering.
		const crop = {h: 100, w: 100, x: 0, y: 0};
		const stored = anchorAfterCrop({x: 0.9, y: 0.9}, crop, 800, 1000);

		expect(stored).toEqual({x: 1, y: 1});
		expect(anchorBeforeCrop(stored, crop, 800, 1000)).toEqual({
			x: 0.125,
			y: 0.1
		});
	});
});

describe('sameEdits', () => {
	it('sees through a fresh object with the same numbers', () => {
		expect(sameEdits(defaultEdits(300, 150), defaultEdits(300, 150))).toBe(true);
	});

	it('notices a moved crop', () => {
		const edits = defaultEdits(300, 150);

		expect(
			sameEdits(edits, {...edits, crop: {...edits.crop, x: 1}})
		).toBe(false);
	});

	it('notices any of the colour sliders', () => {
		const base = defaultEdits(320, 240);

		expect(sameEdits(base, {...base, hue: 30})).toBe(false);
		expect(sameEdits(base, {...base, saturation: -30})).toBe(false);
		expect(sameEdits({...base, pop: 20}, {...base, pop: 21})).toBe(false);
	});

	it('notices a slider', () => {
		const edits = defaultEdits(300, 150);

		expect(sameEdits(edits, {...edits, gamma: 1.2})).toBe(false);
	});
});

describe('sameTuning', () => {
	it('counts absent on both sides as the same', () => {
		expect(sameTuning(undefined, undefined)).toBe(true);
	});

	it('counts a cutout appearing or going away as a change', () => {
		const tuning = {softness: 0.3, threshold: 0.5};

		expect(sameTuning(tuning, undefined)).toBe(false);
		expect(sameTuning(undefined, tuning)).toBe(false);
		expect(sameTuning(tuning, {...tuning})).toBe(true);
	});

	it('notices the cutout being inverted', () => {
		const tuning = {softness: 0.3, threshold: 0.5};

		expect(sameTuning(tuning, {...tuning, invert: true})).toBe(false);
	});

	it('reads an absent invert and a false one as the same cutout', () => {
		// Only one of the two is ever written: the toggle deletes the key rather than
		// storing `false`. A saved asset meets its unsaved self here, and calling those
		// two different would light up the save buttons on an untouched edit.
		const tuning = {softness: 0.3, threshold: 0.5};

		expect(sameTuning(tuning, {...tuning, invert: false})).toBe(true);
	});
});
