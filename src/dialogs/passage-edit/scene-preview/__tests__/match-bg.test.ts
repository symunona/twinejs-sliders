import {buildChannelLuts} from '@sliders/scene-types';
import {
	OPAQUE_ALPHA,
	colourStats,
	sourceRect,
	suggestGrade,
	type ColourStats
} from '../match-bg';

/** An RGBA buffer of `n` copies of one pixel. */
function fill(n: number, r: number, g: number, b: number, a = 255) {
	const out = new Uint8ClampedArray(n * 4);

	for (let i = 0; i < n; i++) {
		out.set([r, g, b, a], i * 4);
	}

	return out;
}

function stats(r: number, g: number, b: number): ColourStats {
	return colourStats(fill(4, r, g, b))!;
}

describe('colourStats', () => {
	it('averages channels, luma and chroma', () => {
		const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
		const out = colourStats(pixels)!;

		expect(out).toMatchObject({b: 127.5, count: 2, g: 0, r: 127.5});
		expect(out.chroma).toBe(255);
		expect(out.luma).toBeCloseTo(0.213 * 127.5 + 0.072 * 127.5);
	});

	it('leaves transparent pixels out when asked, and says so when none are left', () => {
		const pixels = new Uint8ClampedArray([
			...fill(1, 200, 100, 50),
			...fill(3, 0, 0, 0, OPAQUE_ALPHA - 1)
		]);

		expect(colourStats(pixels, true)).toMatchObject({count: 1, r: 200});
		expect(colourStats(pixels)!.count).toBe(4);
		expect(colourStats(fill(2, 9, 9, 9, 0), true)).toBeUndefined();
	});
});

describe('suggestGrade', () => {
	it('suggests nothing for a sprite that already matches', () => {
		expect(suggestGrade(stats(120, 110, 100), stats(120, 110, 100))).toBeUndefined();
	});

	it('warms a neutral sprite towards a sunset, half way', () => {
		const grade = suggestGrade(stats(128, 128, 128), stats(220, 130, 60))!;

		// r-b gap of 160 → warmth 160/0.8 = 200, halved = 100, capped at 60.
		expect(grade.warmth).toBe(60);
		expect(grade.brightness).toBeGreaterThan(0);
	});

	it('darkens a bright sprite on a dark backdrop, capped', () => {
		const grade = suggestGrade(stats(230, 230, 230), stats(20, 20, 30))!;

		expect(grade.brightness).toBe(-40);
		expect(grade.warmth).toBeLessThan(0);
	});

	it('greens towards a forest with tint, and cools towards moonlight', () => {
		// Green over the red/blue average: 60 → tint 60/0.6 = 100, halved = 50.
		expect(suggestGrade(stats(128, 128, 128), stats(100, 160, 100))!.tint).toBe(50);
		expect(suggestGrade(stats(128, 128, 128), stats(90, 110, 170))!.warmth).toBeLessThan(0);
	});

	it('desaturates a vivid sprite on a grey backdrop, and leaves a grey sprite alone', () => {
		expect(suggestGrade(stats(250, 40, 40), stats(120, 110, 115))!.saturation).toBeLessThan(0);
		expect(
			suggestGrade(stats(128, 128, 128), stats(128, 128, 128))?.saturation
		).toBeUndefined();
	});

	it('really does move the sprite towards the backdrop, through the editor maths', () => {
		const sprite = stats(128, 128, 128);
		const bg = stats(200, 150, 90);
		const grade = suggestGrade(sprite, bg)!;
		const luts = buildChannelLuts(grade);
		const graded = stats(luts.r[128], luts.g[128], luts.b[128]);
		const gap = (a: ColourStats) => Math.abs(a.r - a.b - (bg.r - bg.b));

		expect(gap(graded)).toBeLessThan(gap(sprite));
		expect(Math.abs(graded.luma - bg.luma)).toBeLessThan(Math.abs(sprite.luma - bg.luma));
	});
});

describe('sourceRect', () => {
	it('maps a screen box into a covered picture, centred', () => {
		// 1600x900 element showing a 1000x1000 picture: cover scale 1.6, 100 px cropped off
		// the top and bottom of the SOURCE (350 screen px each side).
		const rect = sourceRect(
			{h: 900, w: 1600, x: 0, y: 0},
			{h: 160, w: 160, x: 800, y: 450},
			{h: 1000, w: 1000}
		)!;

		expect(rect.x).toBeCloseTo(500);
		expect(rect.y).toBeCloseTo(500);
		expect(rect.w).toBeCloseTo(100);
		expect(rect.h).toBeCloseTo(100);
	});

	it('clips to the picture, and is undefined off it', () => {
		const element = {h: 100, w: 100, x: 10, y: 10};

		expect(
			sourceRect(element, {h: 50, w: 50, x: 0, y: 0}, {h: 100, w: 100})
		).toEqual({h: 40, w: 40, x: 0, y: 0});
		expect(
			sourceRect(element, {h: 5, w: 5, x: 500, y: 500}, {h: 100, w: 100})
		).toBeUndefined();
		expect(
			sourceRect(element, {h: 5, w: 5, x: 20, y: 20}, {h: 0, w: 100})
		).toBeUndefined();
	});

	it('letterboxes with contain', () => {
		const rect = sourceRect(
			{h: 100, w: 200, x: 0, y: 0},
			{h: 100, w: 200, x: 0, y: 0},
			{h: 100, w: 100},
			'contain'
		)!;

		expect(rect).toEqual({h: 100, w: 100, x: 0, y: 0});
	});
});
