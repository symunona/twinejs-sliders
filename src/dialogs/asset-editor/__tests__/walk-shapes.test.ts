import type {WalkArea} from '@sliders/scene-types';
import {
	emptyWalk,
	frameToBaked,
	frameToSource,
	sameWalk,
	stageHeightOfSource,
	walkToBaked,
	walkToSource
} from '../walk-shapes';

const AREA: WalkArea = {
	depth: {far: {scale: 0.5, y: 0.4}, near: {scale: 1, y: 0.8}},
	shapes: [
		{
			id: 's1',
			op: 'walk',
			points: [
				{x: 0.25, y: 0.4},
				{x: 0.75, y: 0.4},
				{x: 0.75, y: 0.8},
				{x: 0.25, y: 0.8}
			]
		}
	]
};

describe('walk areas across a crop', () => {
	// A 1000x800 source, cropped to 200..800 x 200..800.
	const crop = {h: 600, w: 600, x: 200, y: 200};

	it('keeps every point on the same source pixel, out and back', () => {
		const baked = walkToBaked(AREA, crop, 1000, 800)!;
		const back = walkToSource(baked, crop, 1000, 800);

		back.shapes[0].points.forEach((p, i) => {
			expect(p.x * 1000).toBeCloseTo(AREA.shapes[0].points[i].x * 1000, 0);
			expect(p.y * 800).toBeCloseTo(AREA.shapes[0].points[i].y * 800, 0);
		});
		expect(back.depth!.near.y * 800).toBeCloseTo(0.8 * 800, 0);
	});

	it('clips the floor to what the crop keeps', () => {
		const tight = {h: 300, w: 300, x: 400, y: 400};
		const baked = walkToBaked(AREA, tight, 1000, 800)!;

		expect(
			baked.shapes[0].points.every(
				p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
			)
		).toBe(true);
	});

	it('writes nothing for an empty area', () => {
		expect(walkToBaked({shapes: []}, crop, 1000, 800)).toBeUndefined();
		expect(emptyWalk(undefined)).toBe(true);
	});

	it('is identity without a crop', () => {
		expect(walkToSource(AREA, undefined, 1000, 800)).toBe(AREA);
	});
});

describe('sameWalk', () => {
	it('reads absent and empty as the same', () => {
		expect(sameWalk(undefined, {shapes: []})).toBe(true);
	});

	it('sees a moved point and a new depth', () => {
		const moved = {
			...AREA,
			shapes: [{...AREA.shapes[0], points: [...AREA.shapes[0].points.slice(1), {x: 0, y: 0}]}]
		};

		expect(sameWalk(AREA, moved)).toBe(false);
		expect(sameWalk({shapes: AREA.shapes}, AREA)).toBe(false);
		expect(sameWalk(AREA, JSON.parse(JSON.stringify(AREA)))).toBe(true);
	});
});

describe('the frame', () => {
	it('maps a point into the crop and back', () => {
		const frame = {
			crop: {h: 450, w: 800, x: 100, y: 50},
			out: {height: 450, width: 800},
			sourceHeight: 600,
			sourceWidth: 1000
		};
		const p = {x: 0.3, y: 0.6};
		const back = frameToSource(frame, frameToBaked(frame, p));

		expect(back.x).toBeCloseTo(p.x);
		expect(back.y).toBeCloseTo(p.y);
	});

	it('puts the stage as tall as a 16:9 picture', () => {
		const frame = {
			crop: {h: 900, w: 1600, x: 0, y: 0},
			out: {height: 900, width: 1600},
			sourceHeight: 900,
			sourceWidth: 1600
		};

		expect(stageHeightOfSource(frame, 16 / 9)).toBeCloseTo(1);
	});

	it('makes the stage shorter than a 4:3 picture, which it crops top and bottom', () => {
		const frame = {
			crop: {h: 1200, w: 1600, x: 0, y: 0},
			out: {height: 1200, width: 1600},
			sourceHeight: 1200,
			sourceWidth: 1600
		};

		expect(stageHeightOfSource(frame, 16 / 9)).toBeCloseTo(900 / 1200);
	});
});
