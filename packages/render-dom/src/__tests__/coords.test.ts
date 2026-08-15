import {
	CHARACTER_STAGE_HEIGHT,
	DEFAULT_ORIGIN,
	PROP_DESIGN_HEIGHT,
	anchorPointInRect,
	applyCamera,
	boxToMount,
	boxToScene,
	cameraOffsetPx,
	characterMetrics,
	computeStageBox,
	propMetrics,
	resolveZ,
	safeZoom,
	sceneToBox,
	sortByZ,
	spriteRect
} from '../coords';

const CHAR = {size: {w: 512, h: 1024}, origin: DEFAULT_ORIGIN};

describe('computeStageBox', () => {
	it('fills a mount that already matches the aspect', () => {
		expect(computeStageBox(1600, 900)).toEqual({
			left: 0,
			top: 0,
			width: 1600,
			height: 900
		});
	});

	it('letterboxes (bars top and bottom) when the mount is too tall', () => {
		const box = computeStageBox(1600, 1000);

		expect(box).toEqual({left: 0, top: 50, width: 1600, height: 900});
	});

	it('pillarboxes (bars left and right) when the mount is too wide', () => {
		const box = computeStageBox(2000, 900);

		expect(box).toEqual({left: 200, top: 0, width: 1600, height: 900});
	});

	it('always produces the requested aspect', () => {
		for (const [w, h] of [
			[300, 900],
			[1920, 200],
			[640, 480]
		]) {
			const box = computeStageBox(w, h);

			expect(box.width / box.height).toBeCloseTo(16 / 9, 10);
			expect(box.width).toBeLessThanOrEqual(w);
			expect(box.height).toBeLessThanOrEqual(h);
			// Centred: equal bars on both sides.
			expect(box.left * 2 + box.width).toBeCloseTo(w, 10);
			expect(box.top * 2 + box.height).toBeCloseTo(h, 10);
		}
	});

	it('honours a custom aspect', () => {
		expect(computeStageBox(1000, 1000, 1)).toEqual({
			left: 0,
			top: 0,
			width: 1000,
			height: 1000
		});
	});

	it('degrades to a zero box instead of NaN', () => {
		const zero = {left: 0, top: 0, width: 0, height: 0};

		expect(computeStageBox(0, 900)).toEqual(zero);
		expect(computeStageBox(1600, 0)).toEqual(zero);
		expect(computeStageBox(NaN, NaN)).toEqual(zero);
		expect(computeStageBox(-100, -100)).toEqual(zero);
	});
});

describe('sceneToBox', () => {
	const box = computeStageBox(1600, 900);

	it('puts the origin at the centre of the stage box', () => {
		expect(sceneToBox(box, {x: 0, y: 0})).toEqual({x: 800, y: 450});
	});

	it('maps x = -1 to the left edge and x = +1 to the right edge', () => {
		expect(sceneToBox(box, {x: -1, y: 0}).x).toBe(0);
		expect(sceneToBox(box, {x: 1, y: 0}).x).toBe(1600);
	});

	it('treats y as UP — +1 is the top of the box, -1 the bottom', () => {
		expect(sceneToBox(box, {x: 0, y: 1}).y).toBe(0);
		expect(sceneToBox(box, {x: 0, y: -1}).y).toBe(900);
	});

	it('round-trips through boxToScene', () => {
		for (const at of [
			{x: 0, y: 0},
			{x: -0.4, y: 0.25},
			{x: 0.9, y: -0.85}
		]) {
			const back = boxToScene(box, sceneToBox(box, at));

			expect(back.x).toBeCloseTo(at.x, 10);
			expect(back.y).toBeCloseTo(at.y, 10);
		}
	});

	it('offsets into mount space by the letterbox bars', () => {
		const tall = computeStageBox(1600, 1000);

		expect(boxToMount(tall, sceneToBox(tall, {x: 0, y: 0}))).toEqual({
			x: 800,
			y: 500
		});
	});
});

describe('characterMetrics', () => {
	const box = computeStageBox(1600, 900);

	it('maps the manifest height to 0.9 of the stage height', () => {
		const m = characterMetrics(box, CHAR);

		expect(m.height).toBe(900 * CHARACTER_STAGE_HEIGHT);
		expect(m.height).toBe(810);
	});

	it('keeps the frame aspect ratio', () => {
		const m = characterMetrics(box, CHAR);

		expect(m.width / m.height).toBeCloseTo(512 / 1024, 10);
		expect(m.width).toBe(405);
	});

	it('normalizes characters authored at different pixel sizes to the same height', () => {
		const big = characterMetrics(box, {size: {w: 1024, h: 2048}, origin: DEFAULT_ORIGIN});
		const small = characterMetrics(box, CHAR);

		expect(big.height).toBe(small.height);
		expect(big.width).toBe(small.width);
	});

	it('multiplies both dimensions by the entity scale, keeping the aspect', () => {
		const natural = characterMetrics(box, CHAR);
		const scaled = characterMetrics(box, CHAR, 1.5);

		expect(scaled.height).toBeCloseTo(natural.height * 1.5, 10);
		expect(scaled.width).toBeCloseTo(natural.width * 1.5, 10);
		expect(scaled.width / scaled.height).toBeCloseTo(natural.width / natural.height, 10);
		expect(scaled.origin).toEqual(natural.origin);
	});

	it('falls back to natural size on a scale that would erase the sprite', () => {
		const natural = characterMetrics(box, CHAR);

		for (const bad of [0, -2, NaN, undefined]) {
			expect(characterMetrics(box, CHAR, bad as number).height).toBe(natural.height);
		}
	});
});

describe('propMetrics', () => {
	it('reads prop pixels against a 1080-tall design stage', () => {
		const box = computeStageBox(1600, 900);
		const m = propMetrics(box, {w: 540, h: 540});

		expect(m.height).toBeCloseTo(540 * (900 / PROP_DESIGN_HEIGHT), 10);
		expect(m.width).toBeCloseTo(m.height, 10);
	});

	it('multiplies both dimensions by the entity scale', () => {
		const box = computeStageBox(1600, 900);
		const m = propMetrics(box, {w: 540, h: 270}, DEFAULT_ORIGIN, 0.6);

		expect(m.height).toBeCloseTo(270 * (900 / PROP_DESIGN_HEIGHT) * 0.6, 10);
		expect(m.width).toBeCloseTo(540 * (900 / PROP_DESIGN_HEIGHT) * 0.6, 10);
	});

	it('falls back to natural size on a scale that would erase the sprite', () => {
		const box = computeStageBox(1600, 900);

		expect(propMetrics(box, {w: 540, h: 540}, DEFAULT_ORIGIN, 0)).toEqual(
			propMetrics(box, {w: 540, h: 540})
		);
	});
});

describe('spriteRect', () => {
	const box = computeStageBox(1600, 900);

	it('lands the origin (the feet) exactly on the scene point', () => {
		const m = characterMetrics(box, CHAR);
		const rect = spriteRect(box, {x: 0, y: 0}, m);

		// Feet at the centre: the sprite hangs upward from it.
		expect(rect.left + m.origin.x * rect.width).toBeCloseTo(800, 10);
		expect(rect.top + m.origin.y * rect.height).toBeCloseTo(450, 10);
		expect(rect.left).toBe(597.5);
		expect(rect.top).toBe(-360);
	});

	it('stands a character on the bottom edge at y = -1', () => {
		const m = characterMetrics(box, CHAR);
		const rect = spriteRect(box, {x: -0.4, y: -1}, m);

		expect(rect.top + rect.height).toBeCloseTo(900, 10);
		expect(rect.left + m.origin.x * rect.width).toBeCloseTo(800 - 0.4 * 800, 10);
	});

	it('grows a scaled sprite about its origin — the feet stay on the floor', () => {
		const natural = spriteRect(box, {x: 0, y: -1}, characterMetrics(box, CHAR));
		const scaled = spriteRect(box, {x: 0, y: -1}, characterMetrics(box, CHAR, 2));

		expect(scaled.top + scaled.height).toBeCloseTo(natural.top + natural.height, 10);
		expect(scaled.height).toBeCloseTo(natural.height * 2, 10);
		// Origin x is 0.5, so it widens evenly either side of the same point.
		expect(scaled.left + scaled.width / 2).toBeCloseTo(natural.left + natural.width / 2, 10);
	});

	it('honours a non-default origin', () => {
		const m = characterMetrics(box, {size: {w: 512, h: 1024}, origin: {x: 0.5, y: 0.5}});
		const rect = spriteRect(box, {x: 0, y: 0}, m);

		// Origin at the middle: the sprite is centred on the point instead of standing on it.
		expect(rect.top).toBeCloseTo(450 - m.height / 2, 10);
	});
});

describe('anchorPointInRect', () => {
	const rect = {left: 100, top: 200, width: 400, height: 800};
	const origin = {x: 0.5, y: 1};

	it('resolves a frame fraction inside the rect', () => {
		const p = anchorPointInRect(rect, origin, {x: 0.62, y: 0.18}, false);

		expect(p).toEqual({x: 100 + 0.62 * 400, y: 200 + 0.18 * 800});
	});

	it('mirrors the anchor about the origin when flipped', () => {
		const p = anchorPointInRect(rect, origin, {x: 0.62, y: 0.18}, true);

		expect(p).toEqual({x: 100 + 0.38 * 400, y: 200 + 0.18 * 800});
	});

	it('leaves the origin itself fixed under a flip', () => {
		const a = anchorPointInRect(rect, origin, origin, false);
		const b = anchorPointInRect(rect, origin, origin, true);

		expect(b).toEqual(a);
	});

	it('mirrors about an off-centre origin, not about the frame centre', () => {
		const off = {x: 0.25, y: 1};
		const p = anchorPointInRect(rect, off, {x: 0.6, y: 0.5}, true);

		// 2 * 0.25 - 0.6 = -0.1 — the anchor legitimately lands outside the frame.
		expect(p.x).toBeCloseTo(100 - 0.1 * 400, 10);
	});

	it('is its own inverse: flipping twice returns the original point', () => {
		const anchor = {x: 0.62, y: 0.18};
		const once = anchorPointInRect(rect, origin, anchor, true);
		const backFrac = {x: (once.x - rect.left) / rect.width, y: anchor.y};
		const twice = anchorPointInRect(rect, origin, backFrac, true);

		expect(twice.x).toBeCloseTo(rect.left + anchor.x * rect.width, 10);
	});
});

describe('applyCamera', () => {
	const box = computeStageBox(1600, 900);
	const centre = {x: 800, y: 450};

	it('is the identity at the default camera', () => {
		const p = {x: 123, y: 456};

		expect(applyCamera(box, {at: {x: 0, y: 0}, zoom: 1}, p)).toEqual(p);
	});

	it('zooms about the centre of the stage box', () => {
		const camera = {at: {x: 0, y: 0}, zoom: 2};

		expect(applyCamera(box, camera, centre)).toEqual(centre);
		expect(applyCamera(box, camera, {x: 900, y: 450})).toEqual({x: 1000, y: 450});
	});

	it('pans: moving the camera right moves content left', () => {
		const camera = {at: {x: 0.5, y: 0}, zoom: 1};

		expect(applyCamera(box, camera, centre).x).toBe(800 - 0.5 * 800);
	});

	it('pans with y up: moving the camera up moves content down', () => {
		const camera = {at: {x: 0, y: 0.5}, zoom: 1};

		expect(applyCamera(box, camera, centre).y).toBe(450 + 0.5 * 450);
	});

	it('offsets the pan in box pixels, y flipped like any scene coordinate', () => {
		expect(cameraOffsetPx(box, {at: {x: 1, y: 1}, zoom: 1})).toEqual({
			x: 800,
			y: -450
		});
	});

	it('refuses a nonsense zoom rather than collapsing the stage', () => {
		expect(safeZoom(0)).toBe(1);
		expect(safeZoom(-2)).toBe(1);
		expect(safeZoom(NaN)).toBe(1);
		expect(safeZoom(undefined)).toBe(1);
		expect(safeZoom(2.5)).toBe(2.5);
	});
});

describe('resolveZ', () => {
	it('derives z from y so lower on screen draws later', () => {
		const front = resolveZ({at: {x: 0, y: -1}});
		const back = resolveZ({at: {x: 0, y: 1}});

		expect(front).toBeGreaterThan(back);
		expect(back).toBe(0);
		expect(front).toBe(1);
		expect(resolveZ({at: {x: 0, y: 0}})).toBe(0.5);
	});

	it('lets an explicit z win', () => {
		expect(resolveZ({at: {x: 0, y: -1}, z: 0.1})).toBe(0.1);
		expect(resolveZ({at: {x: 0, y: 1}, z: 5})).toBe(5);
	});

	it('ignores a non-finite z', () => {
		expect(resolveZ({at: {x: 0, y: 0}, z: NaN})).toBe(0.5);
	});

	it('sorts a layer back-to-front, breaking ties on id', () => {
		const sorted = sortByZ([
			{id: 'near', at: {x: 0, y: -0.8}},
			{id: 'far', at: {x: 0, y: 0.8}},
			{id: 'forced', at: {x: 0, y: 0.9}, z: 9},
			{id: 'b', at: {x: 0, y: 0}},
			{id: 'a', at: {x: 0, y: 0}}
		]);

		expect(sorted.map(e => e.id)).toEqual(['far', 'a', 'b', 'near', 'forced']);
	});
});
