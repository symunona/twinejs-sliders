import {computeStageBox} from '@sliders/render-dom';
import {LAYER_BASELINE} from '@sliders/scene-types';
import type {Camera, Vec2} from '@sliders/scene-types';
import {
	DEFAULT_SNAP_TOLERANCE_PX,
	dragTo,
	gridCentre,
	gridLines,
	handlePoints,
	hitTest,
	mountToScene,
	nearestSnap,
	roundCoord,
	scaleFrom,
	sceneToMount,
	sceneTolerance,
	snapTargetsX,
	snapTargetsY,
	THIRD
} from '../stage-geometry';

const BOX = computeStageBox(1600, 900);
const ZERO_BOX = computeStageBox(0, 0);

/** Identity, panned, zoomed, panned + zoomed — every combination the camera can be in. */
const CAMERAS: Record<string, Camera> = {
	identity: {at: {x: 0, y: 0}, zoom: 1},
	panned: {at: {x: 0.3, y: -0.2}, zoom: 1},
	zoomed: {at: {x: 0, y: 0}, zoom: 2},
	zoomedOut: {at: {x: 0, y: 0}, zoom: 0.5},
	pannedZoomed: {at: {x: -0.45, y: 0.7}, zoom: 1.75}
};

const POINTS: Vec2[] = [
	{x: 0, y: 0},
	{x: -1, y: -1},
	{x: 1, y: 1},
	{x: -0.4, y: LAYER_BASELINE},
	{x: 0.123, y: -0.789}
];

describe('roundCoord', () => {
	it('rounds to 3 decimals', () => {
		expect(roundCoord(-0.40000000000000002)).toBe(-0.4);
		expect(roundCoord(0.1 + 0.2)).toBe(0.3);
		expect(roundCoord(0.12345)).toBe(0.123);
		expect(roundCoord(-0.8500000001)).toBe(-0.85);
	});

	it('never writes trailing float noise', () => {
		expect(String(roundCoord(1 / 3))).toBe('0.333');
		expect(String(roundCoord(-2 / 3))).toBe('-0.667');
	});

	it('turns -0 into 0', () => {
		expect(Object.is(roundCoord(-0), 0)).toBe(true);
		expect(Object.is(roundCoord(-0.0001), 0)).toBe(true);
		expect(Object.is(roundCoord(-0.0004), 0)).toBe(true);
	});

	it('is total', () => {
		expect(roundCoord(NaN)).toBe(0);
		expect(roundCoord(Infinity)).toBe(0);
		expect(roundCoord(undefined as unknown as number)).toBe(0);
	});
});

describe('mountToScene / sceneToMount', () => {
	it('round trips scene -> mount -> scene for every camera', () => {
		for (const camera of Object.values(CAMERAS)) {
			for (const at of POINTS) {
				const back = mountToScene(BOX, camera, sceneToMount(BOX, camera, at));

				expect(back.x).toBeCloseTo(at.x, 9);
				expect(back.y).toBeCloseTo(at.y, 9);
			}
		}
	});

	it('round trips mount -> scene -> mount for every camera', () => {
		const pixels: Vec2[] = [
			{x: 0, y: 0},
			{x: 800, y: 450},
			{x: 1599, y: 899},
			{x: 137, y: 622}
		];

		for (const camera of Object.values(CAMERAS)) {
			for (const p of pixels) {
				const back = sceneToMount(BOX, camera, mountToScene(BOX, camera, p));

				expect(back.x).toBeCloseTo(p.x, 6);
				expect(back.y).toBeCloseTo(p.y, 6);
			}
		}
	});

	it('round trips inside a letterboxed box, where left/top are non-zero', () => {
		const box = computeStageBox(2000, 1000);

		expect(box.left).toBeGreaterThan(0);

		for (const camera of Object.values(CAMERAS)) {
			for (const at of POINTS) {
				const back = mountToScene(box, camera, sceneToMount(box, camera, at));

				expect(back.x).toBeCloseTo(at.x, 9);
				expect(back.y).toBeCloseTo(at.y, 9);
			}
		}
	});

	it('puts the scene centre at the box centre under an identity camera', () => {
		const p = sceneToMount(BOX, CAMERAS.identity, {x: 0, y: 0});

		expect(p).toEqual({x: 800, y: 450});
	});

	it('flips y — scene +1 is the TOP of the stage', () => {
		expect(sceneToMount(BOX, CAMERAS.identity, {x: 0, y: 1}).y).toBeCloseTo(
			0,
			9
		);
		expect(sceneToMount(BOX, CAMERAS.identity, {x: 0, y: -1}).y).toBeCloseTo(
			900,
			9
		);
	});

	it('survives non-finite input', () => {
		expect(mountToScene(BOX, CAMERAS.identity, {x: NaN, y: 3})).toEqual({
			x: 0,
			y: 0
		});
		expect(sceneToMount(BOX, CAMERAS.identity, {x: NaN, y: NaN})).toEqual({
			x: 800,
			y: 450
		});
	});
});

describe('degenerate stage box', () => {
	const camera = CAMERAS.pannedZoomed;

	it('never produces NaN', () => {
		expect(ZERO_BOX).toEqual({left: 0, top: 0, width: 0, height: 0});
		expect(mountToScene(ZERO_BOX, camera, {x: 12, y: 34})).toEqual({
			x: 0,
			y: 0
		});
		expect(sceneToMount(ZERO_BOX, camera, {x: 0.5, y: -0.5})).toEqual({
			x: 0,
			y: 0
		});
		expect(sceneTolerance(ZERO_BOX, camera)).toEqual({x: 0, y: 0});
	});

	it('leaves a drag exactly where it started', () => {
		const r = dragTo(
			{x: -0.4, y: LAYER_BASELINE},
			{x: 10, y: 10},
			{x: 300, y: 200},
			ZERO_BOX,
			camera
		);

		expect(r.at).toEqual({x: -0.4, y: LAYER_BASELINE});
		expect(r.snappedX).toBeUndefined();
		expect(r.snappedY).toBeUndefined();
	});

	it('collapses handles and hit tests', () => {
		expect(handlePoints(ZERO_BOX)).toEqual({
			nw: {x: 0, y: 0},
			ne: {x: 0, y: 0},
			se: {x: 0, y: 0},
			sw: {x: 0, y: 0}
		});
		expect(
			hitTest([{id: 'a', rect: ZERO_BOX, zIndex: 1}], {x: 0, y: 0})
		).toBeUndefined();
		expect(
			scaleFrom(
				'se',
				1.5,
				ZERO_BOX,
				{x: 0.5, y: 1},
				{x: 0, y: 0},
				{x: 40, y: 40}
			)
		).toBe(1.5);
	});
});

describe('hitTest', () => {
	const a = {
		id: 'a',
		rect: {left: 0, top: 0, width: 100, height: 100},
		zIndex: 1
	};
	const b = {
		id: 'b',
		rect: {left: 50, top: 50, width: 100, height: 100},
		zIndex: 5
	};
	const c = {
		id: 'c',
		rect: {left: 50, top: 50, width: 100, height: 100},
		zIndex: 2
	};

	it('picks the highest zIndex where rects overlap', () => {
		expect(hitTest([a, b, c], {x: 75, y: 75})).toBe('b');
		expect(hitTest([b, c, a], {x: 75, y: 75})).toBe('b');
	});

	it('picks the only rect under the point', () => {
		expect(hitTest([a, b, c], {x: 10, y: 10})).toBe('a');
		expect(hitTest([a, b, c], {x: 140, y: 140})).toBe('b');
	});

	it('breaks zIndex ties towards the last target, as the painter does', () => {
		const same = {...c, id: 'same', zIndex: 2};

		expect(hitTest([c, same], {x: 75, y: 75})).toBe('same');
	});

	it('returns undefined for a point in no rect and for no targets', () => {
		expect(hitTest([a, b, c], {x: 500, y: 500})).toBeUndefined();
		expect(hitTest([], {x: 10, y: 10})).toBeUndefined();
		expect(hitTest([a], {x: NaN, y: 10})).toBeUndefined();
	});

	it('includes the rect edges', () => {
		expect(hitTest([a], {x: 0, y: 0})).toBe('a');
		expect(hitTest([a], {x: 100, y: 100})).toBe('a');
		expect(hitTest([a], {x: 100.5, y: 100})).toBeUndefined();
	});
});

describe('snap targets', () => {
	it('offers centre, thirds and other entities on x', () => {
		expect(snapTargetsX([0.8])).toEqual([
			{value: 0, kind: 'centre'},
			{value: -1 / 3, kind: 'third'},
			{value: 1 / 3, kind: 'third'},
			{value: 0.8, kind: 'entity'}
		]);
	});

	it('offers the layer baseline and other entities on y — never a centre line', () => {
		expect(snapTargetsY([-0.2])).toEqual([
			{value: LAYER_BASELINE, kind: 'baseline'},
			{value: -0.2, kind: 'entity'}
		]);
		expect(snapTargetsY().some(t => t.value === 0)).toBe(false);
	});

	it('drops non-finite entity positions', () => {
		expect(snapTargetsX([NaN, 0.5]).filter(t => t.kind === 'entity')).toEqual([
			{value: 0.5, kind: 'entity'}
		]);
	});
});

describe('nearestSnap', () => {
	it('takes the nearest target inside the tolerance', () => {
		const targets = snapTargetsX([0.9]);

		expect(nearestSnap(0.05, targets, 0.1)).toEqual({value: 0, kind: 'centre'});
		expect(nearestSnap(0.3, targets, 0.1)).toEqual({
			value: 1 / 3,
			kind: 'third'
		});
	});

	it('returns undefined outside the tolerance', () => {
		expect(nearestSnap(0.15, snapTargetsX(), 0.1)).toBeUndefined();
		expect(nearestSnap(0.05, snapTargetsX(), 0)).toBeUndefined();
		expect(nearestSnap(NaN, snapTargetsX(), 0.5)).toBeUndefined();
		expect(nearestSnap(0, [], 0.5)).toBeUndefined();
	});

	it('breaks equal distances towards the lower-priority kind, whatever the order', () => {
		const entity = {value: 0.5, kind: 'entity' as const};
		const centre = {value: 0.3, kind: 'centre' as const};

		expect(nearestSnap(0.4, [entity, centre], 0.2)).toBe(centre);
		expect(nearestSnap(0.4, [centre, entity], 0.2)).toBe(centre);
	});

	it('prefers the baseline over an entity parked on it', () => {
		const targets = snapTargetsY([LAYER_BASELINE]);

		expect(nearestSnap(-0.84, targets, 0.05)?.kind).toBe('baseline');
	});
});

describe('sceneTolerance', () => {
	it('converts px to scene units against the box', () => {
		// 6px of 1600 wide: 1 scene unit is 800px, so 6px is 0.0075.
		expect(sceneTolerance(BOX, CAMERAS.identity, 6).x).toBeCloseTo(0.0075, 12);
		expect(sceneTolerance(BOX, CAMERAS.identity, 6).y).toBeCloseTo(6 / 450, 12);
	});

	it('shrinks as the camera zooms in', () => {
		const one = sceneTolerance(BOX, CAMERAS.identity, 6);
		const two = sceneTolerance(BOX, {at: {x: 0, y: 0}, zoom: 2}, 6);

		expect(two.x).toBeCloseTo(one.x / 2, 12);
		expect(two.y).toBeCloseTo(one.y / 2, 12);
	});

	it('defaults to the house tolerance and handles junk', () => {
		expect(sceneTolerance(BOX, CAMERAS.identity)).toEqual(
			sceneTolerance(BOX, CAMERAS.identity, DEFAULT_SNAP_TOLERANCE_PX)
		);
		expect(sceneTolerance(BOX, CAMERAS.identity, NaN)).toEqual({x: 0, y: 0});
		expect(sceneTolerance(BOX, CAMERAS.identity, -5)).toEqual({x: 0, y: 0});
	});
});

describe('dragTo', () => {
	const camera = CAMERAS.identity;
	const start: Vec2 = {x: -0.4, y: LAYER_BASELINE};
	// Scene origin under this camera, so pointer maths reads as plain pixels.
	const grab: Vec2 = {x: 800, y: 450};

	it('moves the entity by the pointer delta, in scene units', () => {
		const r = dragTo(start, grab, {x: 800 + 400, y: 450 - 225}, BOX, camera, {
			snap: false
		});

		// 400px of 800 = +0.5 scene x. 225px UP of 450 = +0.5 scene y.
		expect(r.at.x).toBeCloseTo(0.1, 9);
		expect(r.at.y).toBeCloseTo(LAYER_BASELINE + 0.5, 9);
	});

	it('scales the delta with the camera zoom', () => {
		const r = dragTo(
			start,
			grab,
			{x: 800 + 400, y: 450},
			BOX,
			{at: {x: 0, y: 0}, zoom: 2},
			{snap: false}
		);

		// At zoom 2, 400px on screen is only 0.25 scene units of stage.
		expect(r.at.x).toBeCloseTo(-0.15, 9);
	});

	it('does not move the entity when the pointer does not move', () => {
		const r = dragTo(start, grab, grab, BOX, CAMERAS.pannedZoomed, {
			snap: false
		});

		expect(r.at.x).toBeCloseTo(start.x, 9);
		expect(r.at.y).toBeCloseTo(start.y, 9);
	});

	describe('axis lock', () => {
		it('keeps y at its start value when locked to x', () => {
			const r = dragTo(start, grab, {x: 800 + 80, y: 450 - 300}, BOX, camera, {
				axisLock: 'x',
				snap: false
			});

			expect(r.at.y).toBe(LAYER_BASELINE);
			expect(r.at.x).toBeCloseTo(-0.3, 9);
		});

		it('keeps x at its start value when locked to y', () => {
			const r = dragTo(start, grab, {x: 800 + 300, y: 450 - 45}, BOX, camera, {
				axisLock: 'y',
				snap: false
			});

			expect(r.at.x).toBe(-0.4);
			expect(r.at.y).toBeCloseTo(LAYER_BASELINE + 0.1, 9);
		});

		it('does not let snapping move the locked axis back off its start value', () => {
			// y starts a hair off the baseline, well inside the snap tolerance.
			const r = dragTo(
				{x: -0.4, y: LAYER_BASELINE + 0.004},
				grab,
				{x: 800 + 80, y: 450 - 300},
				BOX,
				camera,
				{axisLock: 'x'}
			);

			expect(r.at.y).toBe(LAYER_BASELINE + 0.004);
			expect(r.snappedY).toBeUndefined();
		});

		it('leaves the locked x alone even when it sits on a third', () => {
			const r = dragTo(
				{x: 1 / 3 + 0.002, y: LAYER_BASELINE},
				grab,
				{x: 800, y: 450 - 90},
				BOX,
				camera,
				{axisLock: 'y'}
			);

			expect(r.at.x).toBe(1 / 3 + 0.002);
			expect(r.snappedX).toBeUndefined();
		});

		it('still snaps the free axis', () => {
			const r = dragTo(
				{x: -0.4, y: LAYER_BASELINE},
				grab,
				{x: 800 + 320, y: 450},
				BOX,
				camera,
				{axisLock: 'x'}
			);

			// -0.4 + 0.4 = 0, the centre line.
			expect(r.at.x).toBe(0);
			expect(r.snappedX).toEqual({value: 0, kind: 'centre'});
		});
	});

	describe('snapping', () => {
		it('snaps inside the tolerance', () => {
			// Lands at x = 0.005: 4px off centre, inside the 6px default.
			const r = dragTo(start, grab, {x: 800 + 324, y: 450}, BOX, camera);

			expect(r.at.x).toBe(0);
			expect(r.snappedX).toEqual({value: 0, kind: 'centre'});
		});

		it('does not snap outside the tolerance', () => {
			const r = dragTo(start, grab, {x: 800 + 340, y: 450}, BOX, camera);

			expect(r.at.x).toBeCloseTo(0.025, 9);
			expect(r.snappedX).toBeUndefined();
		});

		it('keeps the grab radius in PIXELS as the camera zooms', () => {
			// -0.4 -> 0 is 320px of pointer travel at zoom 1, but 1280px at zoom 4. Stopping
			// 5px short on SCREEN snaps at either zoom: the tolerance shrank in scene units
			// by exactly as much as the gesture did.
			const zoomed: Camera = {at: {x: 0, y: 0}, zoom: 4};

			expect(
				dragTo(start, grab, {x: 800 + 315, y: 450}, BOX, camera).at.x
			).toBe(0);
			expect(
				dragTo(start, grab, {x: 800 + 1275, y: 450}, BOX, zoomed).at.x
			).toBe(0);

			// The same SCENE gap, though, is 20px on screen at zoom 4 — outside the radius.
			const tooFar = dragTo(start, grab, {x: 800 + 1260, y: 450}, BOX, zoomed);

			expect(tooFar.snappedX).toBeUndefined();
			expect(tooFar.at.x).toBeCloseTo(-0.00625, 9);
			expect(sceneTolerance(BOX, zoomed).x).toBeCloseTo(
				sceneTolerance(BOX, camera).x / 4,
				12
			);
		});

		it('is disabled by snap: false (alt held)', () => {
			const r = dragTo(start, grab, {x: 800 + 324, y: 450}, BOX, camera, {
				snap: false
			});

			expect(r.at.x).toBeCloseTo(0.005, 9);
			expect(r.snappedX).toBeUndefined();
		});

		it('snaps y to the layer baseline', () => {
			// -0.5 -> -0.85 is 157.5px down; stop half a pixel short of the floor.
			const r = dragTo(
				{x: -0.4, y: -0.5},
				grab,
				{x: 800, y: 450 + 157},
				BOX,
				camera
			);

			expect(r.at.y).toBe(LAYER_BASELINE);
			expect(r.snappedY).toEqual({value: LAYER_BASELINE, kind: 'baseline'});
		});

		it('snaps to another entity when the caller supplies one', () => {
			const r = dragTo(start, grab, {x: 800 + 324, y: 450}, BOX, camera, {
				snapTargetsX: snapTargetsX([0.004]),
				snapTargetsY: snapTargetsY()
			});

			// 0.005 is nearer the entity at 0.004 than the centre at 0.
			expect(r.at.x).toBe(0.004);
			expect(r.snappedX).toEqual({value: 0.004, kind: 'entity'});
		});

		it('uses a custom pixel tolerance', () => {
			const wide = dragTo(start, grab, {x: 800 + 340, y: 450}, BOX, camera, {
				tolerancePx: 40
			});

			expect(wide.at.x).toBe(0);
		});
	});
});

describe('handlePoints', () => {
	it('names the four corners', () => {
		expect(handlePoints({left: 10, top: 20, width: 100, height: 200})).toEqual({
			nw: {x: 10, y: 20},
			ne: {x: 110, y: 20},
			se: {x: 110, y: 220},
			sw: {x: 10, y: 220}
		});
	});

	it('is total', () => {
		expect(handlePoints({left: NaN, top: 5, width: -20, height: 10})).toEqual({
			nw: {x: 0, y: 5},
			ne: {x: 0, y: 5},
			se: {x: 0, y: 15},
			sw: {x: 0, y: 15}
		});
	});
});

describe('scaleFrom', () => {
	// A character sprite: 200x400 at (100,100), origin at its feet -> anchor (200, 500).
	const rect = {left: 100, top: 100, width: 200, height: 400};
	const feet = {x: 0.5, y: 1};
	const nw = {x: 100, y: 100};

	it('grows by the pointer-to-origin distance ratio', () => {
		// Twice as far from the anchor, same direction.
		const p = {x: 200 + 2 * (100 - 200), y: 500 + 2 * (100 - 500)};

		expect(scaleFrom('nw', 1, rect, feet, nw, p)).toBeCloseTo(2, 9);
		expect(scaleFrom('nw', 1.5, rect, feet, nw, p)).toBeCloseTo(3, 9);
	});

	it('shrinks when the pointer moves towards the origin', () => {
		const p = {x: 200 + 0.5 * (100 - 200), y: 500 + 0.5 * (100 - 500)};

		expect(scaleFrom('nw', 1, rect, feet, nw, p)).toBeCloseTo(0.5, 9);
	});

	it('scales about the origin, so the anchor does not move', () => {
		// The anchor is the feet, at the BOTTOM of the rect: a drag on the north-west corner
		// is measured from down there, not from the rect centre.
		const p = {x: 100, y: 300};
		const aboutOrigin = scaleFrom('nw', 1, rect, feet, nw, p);
		const aboutCentre = scaleFrom('nw', 1, rect, feet, nw, p, {
			aboutCentre: true
		});

		expect(aboutOrigin).not.toBeCloseTo(aboutCentre, 3);
		// origin anchor (200,500): start |(-100,-400)| = 412.31, now |(-100,-200)| projected.
		expect(aboutOrigin).toBeCloseTo(
			(-100 * -100 + -200 * -400) / (100 * 100 + 400 * 400),
			9
		);
		// centre anchor (200,300): start (-100,-200), now (-100, 0).
		expect(aboutCentre).toBeCloseTo(
			(-100 * -100 + 0 * -200) / (100 * 100 + 200 * 200),
			9
		);
	});

	it('doubles cleanly about the centre', () => {
		const centreStart = {x: 100, y: 100};
		const p = {x: 200 + 2 * (100 - 200), y: 300 + 2 * (100 - 300)};

		expect(
			scaleFrom('nw', 1, rect, feet, centreStart, p, {aboutCentre: true})
		).toBeCloseTo(2, 9);
	});

	it('works from every corner', () => {
		const anchor = {x: 200, y: 500};

		for (const [handle, corner] of Object.entries(handlePoints(rect))) {
			const p = {
				x: anchor.x + 3 * (corner.x - anchor.x),
				y: anchor.y + 3 * (corner.y - anchor.y)
			};
			// sw/se sit on the same baseline as the feet, so their offset is horizontal only
			// — still a clean 3x, which is the point of measuring from the anchor.
			expect(scaleFrom(handle as 'nw', 1, rect, feet, corner, p)).toBeCloseTo(
				3,
				9
			);
		}
	});

	it('clamps at both ends', () => {
		const far = {x: 200 + 500 * (100 - 200), y: 500 + 500 * (100 - 500)};
		const near = {x: 200.0001, y: 500.0001};

		expect(scaleFrom('nw', 1, rect, feet, nw, far)).toBe(10);
		expect(scaleFrom('nw', 1, rect, feet, nw, near)).toBe(0.05);
		expect(scaleFrom('nw', 1, rect, feet, nw, far, {max: 3})).toBe(3);
		expect(scaleFrom('nw', 1, rect, feet, nw, near, {min: 0.5})).toBe(0.5);
	});

	it('clamps to min rather than growing again past the anchor', () => {
		// Dragged through the anchor and out the far side.
		const past = {x: 200 + 2 * (200 - 100), y: 500 + 2 * (500 - 100)};

		expect(scaleFrom('nw', 1, rect, feet, nw, past)).toBe(0.05);
	});

	it('returns the start scale when the drag began on the anchor', () => {
		const onAnchor = {x: 200, y: 500};

		expect(scaleFrom('nw', 1.25, rect, feet, onAnchor, {x: 400, y: 100})).toBe(
			1.25
		);
	});

	it('returns the start scale on degenerate input', () => {
		expect(scaleFrom('nw', 2, rect, feet, nw, {x: NaN, y: 0})).toBe(2);
		expect(scaleFrom('nw', 2, rect, feet, {x: NaN, y: 0}, nw)).toBe(2);
		expect(scaleFrom('middle' as 'nw', 2, rect, feet, nw, {x: 0, y: 0})).toBe(
			2
		);
		expect(scaleFrom('nw', NaN, rect, feet, nw, {x: NaN, y: 0})).toBe(1);
	});

	it('clamps a start scale that was already out of bounds', () => {
		expect(scaleFrom('nw', 40, rect, feet, {x: 200, y: 500}, nw)).toBe(10);
	});
});

describe('gridLines', () => {
	const box = {left: 0, top: 0, width: 640, height: 360};

	it('puts the centre line at the middle of the box', () => {
		const centre = gridLines(box, CAMERAS.identity).find(
			line => line.axis === 'x' && line.kind === 'centre'
		);

		expect(centre?.at).toBeCloseTo(320);
	});

	it('lands its thirds on the same values a drag snaps to', () => {
		const thirds = gridLines(box, CAMERAS.identity)
			.filter(line => line.axis === 'x' && line.kind === 'third')
			.map(line => line.scene)
			.sort((a, b) => a - b);

		expect(thirds).toHaveLength(2);
		expect(thirds[0]).toBeCloseTo(-THIRD);
		expect(thirds[1]).toBeCloseTo(THIRD);
	});

	it('draws the floor at LAYER_BASELINE', () => {
		const floor = gridLines(box, CAMERAS.identity).find(line => line.kind === 'baseline');

		expect(floor?.scene).toBe(LAYER_BASELINE);
		expect(floor?.at).toBeCloseTo(sceneToMount(box, CAMERAS.identity, {x: 0, y: LAYER_BASELINE}).y);
	});

	it('moves with the camera', () => {
		const panned = {...CAMERAS.identity, at: {x: 0.5, y: 0}};
		const centre = gridLines(box, panned).find(
			line => line.axis === 'x' && line.kind === 'centre'
		);

		expect(centre?.at).toBeCloseTo(gridCentre(box, panned).x);
		expect(centre?.at).not.toBeCloseTo(320);
	});

	it('has nothing to draw in a degenerate box', () => {
		expect(gridLines({left: 0, top: 0, width: 0, height: 0}, CAMERAS.identity)).toEqual([]);
	});
});
