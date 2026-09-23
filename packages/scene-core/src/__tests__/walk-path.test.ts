import type {Character, Frac2, WalkArea} from '@sliders/scene-types';
import {
	clipRingToUnit,
	compileWalk,
	defaultWalkDepth,
	depthScale,
	findWalkPath,
	imageToStage,
	isWalkable,
	remapWalkArea,
	snapToWalk,
	stageToImage,
	walkPathLength
} from '../walk-path';

const SQUARE = {h: 1000, w: 1000};
const WIDE = {h: 900, w: 1600};

function rect(x0: number, y0: number, x1: number, y1: number): Frac2[] {
	return [
		{x: x0, y: y0},
		{x: x1, y: y0},
		{x: x1, y: y1},
		{x: x0, y: y1}
	];
}

/** A floor with a table in the middle of it. */
const ROOM: WalkArea = {
	shapes: [
		{id: 's1', op: 'walk', points: rect(0.1, 0.5, 0.9, 0.95)},
		{id: 's2', op: 'block', points: rect(0.4, 0.6, 0.6, 0.85)}
	]
};

/** Two floors that do not touch. */
const ISLANDS: WalkArea = {
	shapes: [
		{id: 's1', op: 'walk', points: rect(0.1, 0.5, 0.4, 0.9)},
		{id: 's2', op: 'walk', points: rect(0.6, 0.5, 0.9, 0.9)}
	]
};

describe('isWalkable', () => {
	it('is true on the floor, false in a hole and outside', () => {
		expect(isWalkable(ROOM, {x: 0.2, y: 0.7})).toBe(true);
		expect(isWalkable(ROOM, {x: 0.5, y: 0.7})).toBe(false);
		expect(isWalkable(ROOM, {x: 0.5, y: 0.2})).toBe(false);
	});

	it('is false with no floor at all', () => {
		expect(isWalkable(undefined, {x: 0.5, y: 0.5})).toBe(false);
		expect(isWalkable({shapes: []}, {x: 0.5, y: 0.5})).toBe(false);
	});
});

describe('snapToWalk', () => {
	it('leaves a point on the floor alone', () => {
		expect(snapToWalk(ROOM, {x: 0.2, y: 0.7}, SQUARE)).toEqual({x: 0.2, y: 0.7});
	});

	it('pulls a point above the floor down onto its edge, just inside', () => {
		const snapped = snapToWalk(ROOM, {x: 0.3, y: 0.2}, SQUARE)!;

		expect(snapped.x).toBeCloseTo(0.3, 3);
		expect(snapped.y).toBeGreaterThan(0.5);
		expect(snapped.y).toBeLessThan(0.505);
		expect(isWalkable(ROOM, snapped)).toBe(true);
	});

	it('pushes a point in a hole out to the nearest hole edge', () => {
		const snapped = snapToWalk(ROOM, {x: 0.42, y: 0.7}, SQUARE)!;

		expect(snapped.x).toBeLessThan(0.4);
		expect(snapped.x).toBeGreaterThan(0.395);
		expect(isWalkable(ROOM, snapped)).toBe(true);
	});

	it('moves a point exactly on an edge onto the floor', () => {
		const snapped = snapToWalk(ROOM, {x: 0.1, y: 0.7}, SQUARE)!;

		expect(isWalkable(ROOM, snapped)).toBe(true);
	});

	it('is undefined with no floor', () => {
		expect(snapToWalk({shapes: []}, {x: 0.5, y: 0.5})).toBeUndefined();
	});
});

describe('findWalkPath', () => {
	it('goes straight when the goal is in sight', () => {
		const path = findWalkPath(ROOM, {x: 0.2, y: 0.6}, {x: 0.2, y: 0.9}, SQUARE)!;

		expect(path.points).toEqual([
			{x: 0.2, y: 0.6},
			{x: 0.2, y: 0.9}
		]);
		expect(path.reached).toBe(true);
	});

	it('goes round a block', () => {
		const path = findWalkPath(ROOM, {x: 0.3, y: 0.7}, {x: 0.7, y: 0.7}, SQUARE)!;

		expect(path.reached).toBe(true);
		expect(path.points.length).toBeGreaterThan(2);
		expect(path.points[path.points.length - 1]).toEqual({x: 0.7, y: 0.7});

		// Every leg stays on the floor: sample each one.
		for (let i = 1; i < path.points.length; i++) {
			const a = path.points[i - 1];
			const b = path.points[i];

			for (let t = 0; t <= 1; t += 0.05) {
				expect(
					isWalkable(ROOM, {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t})
				).toBe(true);
			}
		}

		// Round the short side of the table: over the top (y 0.6) beats under (y 0.85).
		const straight = 0.4;
		const length = walkPathLength(path.points, SQUARE);

		expect(length).toBeGreaterThan(straight);
		expect(length).toBeLessThan(0.5);
	});

	it('snaps a click in the hole to its edge', () => {
		const path = findWalkPath(ROOM, {x: 0.2, y: 0.7}, {x: 0.45, y: 0.7}, SQUARE)!;

		expect(path.reached).toBe(true);
		expect(isWalkable(ROOM, path.goal)).toBe(true);
		expect(path.goal.x).toBeLessThan(0.4);
	});

	it('walks to the nearest reachable point when the click is on another island', () => {
		const path = findWalkPath(ISLANDS, {x: 0.2, y: 0.7}, {x: 0.8, y: 0.7}, SQUARE)!;

		expect(path.reached).toBe(false);
		expect(path.goal.x).toBeGreaterThan(0.39);
		expect(path.goal.x).toBeLessThan(0.4);
		expect(path.goal.y).toBeCloseTo(0.7, 2);
	});

	it('is undefined with no floor', () => {
		expect(findWalkPath(undefined, {x: 0, y: 0}, {x: 1, y: 1})).toBeUndefined();
	});
});

describe('depthScale', () => {
	const depth = {far: {scale: 0.5, y: 0.5}, near: {scale: 1, y: 1}};

	it('is each line’s own scale on the line', () => {
		expect(depthScale(depth, 0.5)).toBe(0.5);
		expect(depthScale(depth, 1)).toBe(1);
	});

	it('is linear between', () => {
		expect(depthScale(depth, 0.75)).toBeCloseTo(0.75);
	});

	it('clamps past both lines', () => {
		expect(depthScale(depth, 0.1)).toBe(0.5);
		expect(depthScale(depth, 1.3)).toBe(1);
	});

	it('is 1 with no depth', () => {
		expect(depthScale(undefined, 0.3)).toBe(1);
	});

	it('defaults to the floor’s bounding box', () => {
		expect(defaultWalkDepth(ROOM)).toEqual({
			far: {scale: 0.5, y: 0.5},
			near: {scale: 1, y: 0.95}
		});
	});
});

describe('imageToStage / stageToImage', () => {
	it('maps a 16:9 backdrop one to one', () => {
		expect(imageToStage({x: 0, y: 0}, WIDE)).toEqual({x: -1, y: 1});
		expect(imageToStage({x: 1, y: 1}, WIDE)).toEqual({x: 1, y: -1});
		expect(imageToStage({x: 0.5, y: 0.5}, WIDE)).toEqual({x: 0, y: 0});
	});

	it('crops a 4:3 backdrop top and bottom, as object-fit: cover does', () => {
		const img = {h: 1200, w: 1600};
		const top = imageToStage({x: 0.5, y: 0}, img);

		// Wider than tall by less than the stage, so it fills the width and overflows up.
		expect(top.y).toBeGreaterThan(1);
		expect(imageToStage({x: 0, y: 0.5}, img).x).toBeCloseTo(-1);
	});

	it.each([
		['16:9', WIDE],
		['4:3', {h: 1200, w: 1600}],
		['tall', {h: 1600, w: 900}]
	])('round trips on %s', (_name, img) => {
		for (const p of [
			{x: 0.1, y: 0.2},
			{x: 0.5, y: 0.9},
			{x: 0.83, y: 0.41}
		]) {
			const back = stageToImage(imageToStage(p, img), img);

			expect(back.x).toBeCloseTo(p.x, 9);
			expect(back.y).toBeCloseTo(p.y, 9);
		}
	});
});

describe('crop remap', () => {
	it('keeps points on the same pixels', () => {
		// A 1000x1000 source cropped to x 200..800, y 100..700.
		const crop = {h: 600, w: 600, x: 200, y: 100};
		const toCrop = (p: Frac2) => ({
			x: (p.x * 1000 - crop.x) / crop.w,
			y: (p.y * 1000 - crop.y) / crop.h
		});
		const fromCrop = (p: Frac2) => ({
			x: (crop.x + p.x * crop.w) / 1000,
			y: (crop.y + p.y * crop.h) / 1000
		});
		const source: WalkArea = {
			depth: {far: {scale: 0.5, y: 0.4}, near: {scale: 1, y: 0.7}},
			shapes: [{id: 's1', op: 'walk', points: rect(0.3, 0.4, 0.7, 0.6)}]
		};
		const baked = remapWalkArea(source, toCrop);

		expect(baked.shapes[0].points[0]).toEqual({x: 0.167, y: 0.5});
		expect(baked.depth!.far.y).toBe(0.5);
		expect(baked.depth!.near.y).toBe(1);

		// And back: same source pixels, to the rounding.
		const back = remapWalkArea(baked, fromCrop, false);

		back.shapes[0].points.forEach((p, i) => {
			expect(p.x).toBeCloseTo(source.shapes[0].points[i].x, 2);
			expect(p.y).toBeCloseTo(source.shapes[0].points[i].y, 2);
		});
	});

	it('clips a ring that the crop cut through, and drops one it removed', () => {
		const area: WalkArea = {
			shapes: [
				{id: 's1', op: 'walk', points: rect(-0.5, 0.2, 0.5, 0.8)},
				{id: 's2', op: 'block', points: rect(1.2, 0.2, 1.5, 0.4)}
			]
		};
		const clipped = remapWalkArea(area, p => p);

		expect(clipped.shapes).toHaveLength(1);
		expect(clipped.shapes[0].points.every(p => p.x >= 0 && p.x <= 1)).toBe(true);
		expect(clipRingToUnit(rect(0.2, 0.2, 0.4, 0.4))).toEqual(rect(0.2, 0.2, 0.4, 0.4));
	});
});

describe('compileWalk', () => {
	const walker: Pick<Character, 'poses' | 'faces' | 'walkSpeed'> = {
		poses: {
			idle: {asset: 'a_idle'},
			walk: {
				steps: [
					{asset: 'a_w1', dur: 0.1},
					{asset: 'a_w2', dur: 0.1},
					{asset: 'a_w3', dur: 0.1},
					{asset: 'a_w4', dur: 0.1}
				]
			}
		},
		walkSpeed: 0.6
	};

	it('takes about length / speed × fps steps, and ends in idle', () => {
		// Straight across half the stage: scene x from -0.5 to 0.5, one unit.
		const {seconds, steps, walkPose} = compileWalk({
			character: walker,
			img: WIDE,
			path: [
				{x: 0.25, y: 0.8},
				{x: 0.75, y: 0.8}
			]
		});

		expect(walkPose).toBe(true);
		expect(seconds).toBeCloseTo(1 / 0.6, 3);
		// 1.667 s at 10 fps, plus the idle.
		expect(steps.length).toBeGreaterThanOrEqual(17);
		expect(steps.length).toBeLessThanOrEqual(18);
		expect(steps[0].name).toBe('walk#1');
		expect(steps[1].name).toBe('walk#2');
		expect(steps[4].name).toBe('walk#1');

		const last = steps[steps.length - 1];

		expect(last.name).toBe('idle');
		expect(last.at).toEqual({x: 0.5, y: -0.6});
		expect(steps.every(step => step.ease === 'linear')).toBe(true);
	});

	it('flips when the direction changes, from the way the art faces', () => {
		const path = [
			{x: 0.5, y: 0.8},
			{x: 0.7, y: 0.8},
			{x: 0.3, y: 0.8}
		];
		const right = compileWalk({character: walker, img: WIDE, path}).steps;

		expect(right[0].flip).toBe(false);
		expect(right[right.length - 2].flip).toBe(true);

		const left = compileWalk({
			character: {...walker, faces: 'left'},
			img: WIDE,
			path
		}).steps;

		expect(left[0].flip).toBe(true);
		expect(left[left.length - 2].flip).toBe(false);
	});

	it('ends a step at every corner', () => {
		const corner = {x: 0.5, y: 0.6};
		const {steps} = compileWalk({
			character: walker,
			img: WIDE,
			path: [{x: 0.3, y: 0.9}, corner, {x: 0.7, y: 0.9}]
		});
		const at = imageToStage(corner, WIDE);

		expect(
			steps.some(
				step =>
					Math.abs(step.at!.x - at.x) < 1e-3 && Math.abs(step.at!.y - at.y) < 1e-3
			)
		).toBe(true);
	});

	it('scales by depth on top of the entity’s own scale, and slows with it', () => {
		const depth = {far: {scale: 0.5, y: 0.5}, near: {scale: 1, y: 1}};
		const near = compileWalk({
			character: walker,
			depth,
			img: WIDE,
			path: [
				{x: 0.25, y: 1},
				{x: 0.75, y: 1}
			],
			scale: 1.2
		});
		const far = compileWalk({
			character: walker,
			depth,
			img: WIDE,
			path: [
				{x: 0.25, y: 0.5},
				{x: 0.75, y: 0.5}
			],
			scale: 1.2
		});

		expect(near.steps[0].scale).toBeCloseTo(1.2);
		expect(far.steps[0].scale).toBeCloseTo(0.6);
		expect(far.seconds).toBeCloseTo(near.seconds * 2, 2);
	});

	it('glides in idle without a walk pose', () => {
		const {steps, walkPose} = compileWalk({
			character: {poses: {idle: {asset: 'a_idle'}}},
			img: WIDE,
			path: [
				{x: 0.4, y: 0.8},
				{x: 0.6, y: 0.8}
			]
		});

		expect(walkPose).toBe(false);
		expect(steps.every(step => step.name === 'idle')).toBe(true);
	});

	it('repeats an animated-file walk by name', () => {
		const {steps} = compileWalk({
			character: {poses: {idle: {asset: 'a_i'}, walk: {asset: 'a_walk'}}},
			img: WIDE,
			path: [
				{x: 0.4, y: 0.8},
				{x: 0.6, y: 0.8}
			]
		});

		expect(steps.slice(0, -1).every(step => step.name === 'walk')).toBe(true);
	});
});
