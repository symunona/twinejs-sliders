import type {Frac2, MaskOp, MaskShape} from '@sliders/scene-types';
import {
	DEFAULT_FEATHER,
	FEATHER_RANGE,
	FREEHAND_MIN_STEP,
	MASK_MODES,
	MASK_TOOL_IDS,
	VERTEX_RADIUS,
	drawnInverted,
	emptyMask,
	hitShape,
	hitVertex,
	liveShapes,
	mergeAlpha,
	newShapeId,
	rasterizeMask,
	ringArea,
	roundPoint,
	roundShape,
	sameMask,
	shapePath,
	simplifyRing
} from '../mask-shapes';

// jest-canvas-mock (src/setupTests.ts) gives every test a 2D context, but its
// `getImageData` hands back a blank ImageData whatever was drawn — it records calls, it
// does not rasterise. So `rasterizeMask` gets a context that really does fill polygons
// and really does blur: a scanline even-odd fill at pixel centres, an opaque red channel,
// and a box blur for `filter: blur(Npx)`. Not a browser, but enough to hold the module to
// its half of the bargain — which shape wins, which sign it accumulates with, which edge
// the blur radius is a fraction of, and which channel the coverage is read out of.

interface PathCommand {
	x: number;
	y: number;
	type: 'move' | 'line';
}

class StubPath2D {
	commands: PathCommand[] = [];
	closed = false;

	moveTo(x: number, y: number) {
		this.commands.push({type: 'move', x, y});
	}

	lineTo(x: number, y: number) {
		this.commands.push({type: 'line', x, y});
	}

	closePath() {
		this.closed = true;
	}
}

class StubContext {
	/** The red channel, 0..1 per pixel. Opaque throughout, like a real `{alpha: false}`. */
	red: Float64Array;
	/** Every value `filter` was set to, in order, so a test can read the blur back. */
	filters: string[] = [];
	fills: StubPath2D[] = [];
	rects: {value: number; w: number; h: number}[] = [];
	fillStyle = '#000';

	private currentFilter = 'none';

	constructor(public width: number, public height: number) {
		this.red = new Float64Array(width * height);
	}

	get filter() {
		return this.currentFilter;
	}

	set filter(value: string) {
		this.currentFilter = value;
		this.filters.push(value);
	}

	fillRect(x: number, y: number, w: number, h: number) {
		const value = this.fillValue();

		this.rects.push({h, value, w});

		for (let row = y; row < y + h; row++) {
			for (let column = x; column < x + w; column++) {
				this.red[row * this.width + column] = value;
			}
		}
	}

	fill(path: StubPath2D, rule: CanvasFillRule) {
		expect(rule).toBe('evenodd');
		this.fills.push(path);

		const points = path.commands;
		let coverage = new Float64Array(this.width * this.height);

		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				if (evenOdd(points, x + 0.5, y + 0.5)) {
					coverage[y * this.width + x] = 1;
				}
			}
		}

		const blur = /^blur\(([\d.]+)px\)$/.exec(this.currentFilter);

		if (blur) {
			// Two box passes. Any symmetric non-negative kernel leaves a step edge
			// monotone, which is the property the feather test is actually asking about.
			const radius = Math.max(1, Math.round(Number(blur[1])));

			coverage = boxBlur(
				boxBlur(coverage, this.width, this.height, radius),
				this.width,
				this.height,
				radius
			);
		}

		const value = this.fillValue();

		for (let index = 0; index < this.red.length; index++) {
			const alpha = coverage[index];

			this.red[index] = this.red[index] * (1 - alpha) + value * alpha;
		}
	}

	getImageData(x: number, y: number, w: number, h: number) {
		expect([x, y, w, h]).toEqual([0, 0, this.width, this.height]);

		const data = new Uint8ClampedArray(this.red.length * 4);

		for (let index = 0; index < this.red.length; index++) {
			const byte = Math.round(this.red[index] * 255);

			data[index * 4] = byte;
			data[index * 4 + 1] = byte;
			data[index * 4 + 2] = byte;
			data[index * 4 + 3] = 255;
		}

		return {data, height: h, width: w};
	}

	private fillValue() {
		return this.fillStyle === '#fff' ? 1 : 0;
	}
}

function evenOdd(points: PathCommand[], x: number, y: number): boolean {
	let inside = false;

	for (
		let index = 0, previous = points.length - 1;
		index < points.length;
		previous = index++
	) {
		const a = points[index];
		const b = points[previous];

		if (
			a.y > y !== b.y > y &&
			x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x
		) {
			inside = !inside;
		}
	}

	return inside;
}

function boxBlur(
	source: Float64Array,
	width: number,
	height: number,
	radius: number
): Float64Array {
	const horizontal = new Float64Array(source.length);
	const out = new Float64Array(source.length);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let total = 0;

			for (let offset = -radius; offset <= radius; offset++) {
				const at = Math.min(width - 1, Math.max(0, x + offset));

				total += source[y * width + at];
			}

			horizontal[y * width + x] = total / (radius * 2 + 1);
		}
	}

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let total = 0;

			for (let offset = -radius; offset <= radius; offset++) {
				const at = Math.min(height - 1, Math.max(0, y + offset));

				total += horizontal[at * width + x];
			}

			out[y * width + x] = total / (radius * 2 + 1);
		}
	}

	return out;
}

let contexts: StubContext[] = [];
const realGetContext = HTMLCanvasElement.prototype.getContext;
const realPath2D = (global as any).Path2D;

beforeEach(() => {
	contexts = [];
	(global as any).Path2D = StubPath2D;
	(HTMLCanvasElement.prototype as any).getContext = function (
		this: HTMLCanvasElement
	) {
		const context = new StubContext(this.width, this.height);

		contexts.push(context);

		return context;
	};
});

afterEach(() => {
	(HTMLCanvasElement.prototype as any).getContext = realGetContext;
	(global as any).Path2D = realPath2D;
});

function shape(
	id: string,
	points: [number, number][],
	op: MaskOp = 'cut',
	feather = 0
): MaskShape {
	return {feather, id, op, points: points.map(([x, y]) => ({x, y}))};
}

/** A centred square, as fractions. */
function square(
	id: string,
	inset: number,
	op: MaskOp = 'cut',
	feather = 0
): MaskShape {
	return shape(
		id,
		[
			[inset, inset],
			[1 - inset, inset],
			[1 - inset, 1 - inset],
			[inset, 1 - inset]
		],
		op,
		feather
	);
}

function at(alpha: Float32Array, width: number, x: number, y: number) {
	return alpha[y * width + x];
}

/** The same shape drawn the other way round. */
function reversed(source: MaskShape): MaskShape {
	return {...source, points: [...source.points].reverse()};
}

describe('ringArea', () => {
	it('is positive for a ring drawn clockwise on screen', () => {
		// Image coordinates: y grows DOWNWARDS, so right-then-down-then-left is
		// clockwise to look at, and the shoelace sign is the opposite way round from the
		// one every maths textbook quotes.
		expect(ringArea(square('s1', 0.25).points)).toBeGreaterThan(0);
		expect(ringArea(reversed(square('s1', 0.25)).points)).toBeLessThan(0);
	});

	it('does not care where the ring starts, only which way it goes', () => {
		const points = square('s1', 0.25).points;
		const rolled = [...points.slice(2), ...points.slice(0, 2)];

		expect(ringArea(rolled)).toBeCloseTo(ringArea(points), 10);
	});

	it('is zero for a ring with no area', () => {
		expect(
			ringArea([
				{x: 0.1, y: 0.1},
				{x: 0.5, y: 0.5},
				{x: 0.9, y: 0.9}
			])
		).toBeCloseTo(0, 10);
	});
});

describe('drawnInverted', () => {
	it('inverts an anticlockwise gesture and nothing else', () => {
		expect(drawnInverted(square('s1', 0.25).points)).toBe(false);
		expect(drawnInverted(reversed(square('s1', 0.25)).points)).toBe(true);
	});

	it('leaves a ring with no area alone', () => {
		// Guessing "inverted" here would cut the entire image on a stroke that covers
		// nothing — the loudest possible answer to the most ambiguous gesture.
		expect(
			drawnInverted([
				{x: 0.1, y: 0.1},
				{x: 0.5, y: 0.5},
				{x: 0.9, y: 0.9}
			])
		).toBe(false);
	});
});

describe('the constants the tools are built on', () => {
	it('names the three previews and the three tools', () => {
		expect([...MASK_MODES]).toEqual(['rendered', 'paint', 'alpha']);
		expect([...MASK_TOOL_IDS]).toEqual(['polygon', 'freehand', 'edit']);
	});

	it('starts a shape hard-edged, inside the feather slider’s range', () => {
		expect(DEFAULT_FEATHER).toBe(0);
		expect(DEFAULT_FEATHER).toBeGreaterThanOrEqual(FEATHER_RANGE.min);
		expect(DEFAULT_FEATHER).toBeLessThanOrEqual(FEATHER_RANGE.max);
		expect(FEATHER_RANGE.step).toBeLessThan(FEATHER_RANGE.max);
	});

	it('keeps the freehand step well inside a vertex grab', () => {
		// Otherwise a stroke records points no one could ever grab apart again.
		expect(FREEHAND_MIN_STEP).toBeLessThan(VERTEX_RADIUS);
		expect(FREEHAND_MIN_STEP).toBeGreaterThan(0);
	});
});

describe('newShapeId', () => {
	it('starts at s1 on an empty mask', () => {
		expect(newShapeId([])).toBe('s1');
	});

	it('takes the next number, not the count — deleting s2 must not reuse it', () => {
		expect(newShapeId([square('s1', 0.1), square('s7', 0.1)])).toBe('s8');
	});

	it('falls past ids it did not number', () => {
		expect(newShapeId([square('freehand', 0.1)])).toBe('s1');
		expect(newShapeId([square('s1', 0.1), square('s2', 0.1)])).toBe('s3');
	});
});

describe('roundPoint and roundShape', () => {
	it('clamps to the image and keeps three decimals', () => {
		expect(roundPoint({x: 0.123456, y: 0.987654})).toEqual({
			x: 0.123,
			y: 0.988
		});
		expect(roundPoint({x: -3, y: 42})).toEqual({x: 0, y: 1});
	});

	it('stores a point that is not a number as the origin, never as NaN', () => {
		expect(roundPoint({x: NaN, y: Infinity})).toEqual({x: 0, y: 0});
	});

	it('keeps an inverted flag and drops an off one', () => {
		const base = square('s1', 0.1);

		expect(roundShape({...base, invert: true}).invert).toBe(true);
		// Not `false` — the key is absent, so the flag costs nothing on the dozens of
		// shapes that do not have it and shapes drawn before it existed still match.
		expect('invert' in roundShape({...base, invert: false})).toBe(false);
		expect('invert' in roundShape(base)).toBe(false);
	});

	it('round trips a shape: what is written is what is read back', () => {
		const stored = roundShape(
			shape(
				's1',
				[
					[0.1, 0.2],
					[0.3, 0.4],
					[0.5, 0.6]
				],
				'keep',
				0.02
			)
		);

		expect(stored).toEqual(
			shape(
				's1',
				[
					[0.1, 0.2],
					[0.3, 0.4],
					[0.5, 0.6]
				],
				'keep',
				0.02
			)
		);
		expect(sameMask({shapes: [stored]}, {shapes: [stored]})).toBe(true);
	});

	it('is stable: rounding twice is rounding once', () => {
		const once = roundShape(
			shape(
				's1',
				[
					[0.12349, 0.98761],
					[0.5005, 0.4004],
					[1.9, -0.2]
				],
				'cut',
				0.0123
			)
		);

		expect(roundShape(once)).toEqual(once);
		expect(roundShape(roundShape(once))).toEqual(once);
	});

	it('rounds and clamps feather too — it is a fraction of the same image', () => {
		expect(roundShape(square('s1', 0.1, 'cut', 0.01234)).feather).toBe(0.012);
		expect(roundShape(square('s1', 0.1, 'cut', 99)).feather).toBe(
			FEATHER_RANGE.max
		);
		expect(roundShape(square('s1', 0.1, 'cut', -1)).feather).toBe(
			FEATHER_RANGE.min
		);
		expect(roundShape(square('s1', 0.1, 'cut', NaN)).feather).toBe(
			DEFAULT_FEATHER
		);
	});

	it('leaves the shape it was given alone', () => {
		const original = square('s1', 0.12345);

		roundShape(original);
		expect(original.points[0].x).toBe(0.12345);
	});
});

describe('emptyMask and liveShapes', () => {
	it('treats no mask, no shapes and an unfinished polygon as empty', () => {
		expect(emptyMask(undefined)).toBe(true);
		expect(emptyMask({shapes: []})).toBe(true);
		expect(emptyMask({shapes: [shape('s1', [[0.1, 0.1]])]})).toBe(true);
		expect(
			emptyMask({
				shapes: [
					shape('s1', [
						[0.1, 0.1],
						[0.2, 0.2]
					])
				]
			})
		).toBe(true);
	});

	it('is not empty once a shape has three points', () => {
		expect(emptyMask({shapes: [square('s1', 0.1)]})).toBe(false);
	});

	it('hands on only the shapes worth drawing', () => {
		const live = square('s2', 0.1);
		const drawing = shape('s1', [
			[0.1, 0.1],
			[0.2, 0.2]
		]);

		expect(liveShapes({shapes: [drawing, live]})).toEqual([live]);
		expect(liveShapes(undefined)).toEqual([]);
	});
});

describe('sameMask', () => {
	it('calls an absent mask and an empty one the same thing', () => {
		expect(sameMask(undefined, undefined)).toBe(true);
		expect(sameMask(undefined, {shapes: []})).toBe(true);
		expect(sameMask({shapes: []}, undefined)).toBe(true);
	});

	it('compares shapes by value, not by identity', () => {
		expect(
			sameMask({shapes: [square('s1', 0.1)]}, {shapes: [square('s1', 0.1)]})
		).toBe(true);
	});

	it('sees a moved point, a flipped op, a new feather and a new shape', () => {
		const base = {shapes: [square('s1', 0.1)]};

		expect(sameMask(base, {shapes: [square('s1', 0.2)]})).toBe(false);
		expect(sameMask(base, {shapes: [square('s1', 0.1, 'keep')]})).toBe(false);
		expect(sameMask(base, {shapes: [square('s1', 0.1, 'cut', 0.02)]})).toBe(
			false
		);
		expect(sameMask(base, {shapes: [square('s2', 0.1)]})).toBe(false);
		expect(
			sameMask(base, {shapes: [square('s1', 0.1), square('s2', 0.2)]})
		).toBe(false);
		expect(sameMask(base, undefined)).toBe(false);
	});

	it('sees a shape turned inside out', () => {
		const base = {shapes: [square('s1', 0.1)]};

		expect(
			sameMask(base, {shapes: [{...square('s1', 0.1), invert: true}]})
		).toBe(false);
		// An absent flag and an explicit `false` store the same shape, so `dirty` must
		// not light up over the difference between them.
		expect(
			sameMask(base, {shapes: [{...square('s1', 0.1), invert: false}]})
		).toBe(true);
	});

	it('sees a reordered mask — order is which shape is on top', () => {
		const a = {shapes: [square('s1', 0.1), square('s2', 0.2)]};
		const b = {shapes: [square('s2', 0.2), square('s1', 0.1)]};

		expect(sameMask(a, b)).toBe(false);
	});
});

describe('simplifyRing', () => {
	const ring: Frac2[] = [
		{x: 0, y: 0},
		{x: 0.5, y: 0},
		{x: 1, y: 0},
		{x: 1, y: 0.5},
		{x: 1, y: 1},
		{x: 0.5, y: 1},
		{x: 0, y: 1},
		{x: 0, y: 0.5}
	];

	it('drops the points that sit on an edge and keeps the corners', () => {
		expect(simplifyRing(ring, 0.01)).toEqual([
			{x: 0, y: 0},
			{x: 1, y: 0},
			{x: 1, y: 1},
			{x: 0, y: 1}
		]);
	});

	it('keeps a closed ring closed — the first point is never repeated at the end', () => {
		for (const tolerance of [0.001, 0.01, 0.1, 0.4, 5]) {
			const simplified = simplifyRing(ring, tolerance);
			const first = simplified[0];
			const last = simplified[simplified.length - 1];

			expect(simplified.length).toBeGreaterThanOrEqual(3);
			expect([last.x, last.y]).not.toEqual([first.x, first.y]);
		}
	});

	it('never collapses a shape below a shape, whatever the tolerance', () => {
		const flattened = simplifyRing(ring, 99);

		expect(flattened).toHaveLength(3);
		// Three DIFFERENT points: three copies of one corner is not a polygon either.
		expect(new Set(flattened.map(point => `${point.x},${point.y}`)).size).toBe(
			3
		);
	});

	it('leaves a triangle and anything shorter alone', () => {
		const triangle: Frac2[] = [
			{x: 0, y: 0},
			{x: 1, y: 0},
			{x: 0.5, y: 1}
		];

		expect(simplifyRing(triangle, 99)).toEqual(triangle);
		expect(simplifyRing([{x: 0, y: 0}], 0.1)).toEqual([{x: 0, y: 0}]);
	});

	it('copies its points rather than aliasing the stroke it was handed', () => {
		const simplified = simplifyRing(ring, 0.01);

		simplified[0].x = 0.9;
		expect(ring[0].x).toBe(0);
	});

	it('does nothing with a tolerance of zero', () => {
		expect(simplifyRing(ring, 0)).toEqual(ring);
	});

	it('keeps a wobble that is wider than the tolerance', () => {
		const wobbly = [...ring];

		wobbly[1] = {x: 0.5, y: 0.2};
		expect(simplifyRing(wobbly, 0.01)).toContainEqual({x: 0.5, y: 0.2});
		expect(simplifyRing(wobbly, 0.5)).not.toContainEqual({x: 0.5, y: 0.2});
	});
});

describe('hitVertex', () => {
	const shapes = [square('s1', 0.1), square('s2', 0.4)];

	it('finds the nearest vertex inside the radius', () => {
		expect(hitVertex(shapes, {x: 0.11, y: 0.12}, 0.05)).toEqual({
			index: 0,
			shapeId: 's1'
		});
		expect(hitVertex(shapes, {x: 0.88, y: 0.91}, 0.05)).toEqual({
			index: 2,
			shapeId: 's1'
		});
	});

	it('misses when nothing is close enough', () => {
		expect(hitVertex(shapes, {x: 0.5, y: 0.5}, 0.05)).toBeUndefined();
		expect(hitVertex([], {x: 0.1, y: 0.1}, 0.5)).toBeUndefined();
	});

	it('searches the topmost shape first, even when a lower vertex is nearer', () => {
		const stacked = [
			shape('under', [
				[0.5, 0.5],
				[0.6, 0.5],
				[0.6, 0.6]
			]),
			shape('over', [
				[0.52, 0.5],
				[0.7, 0.5],
				[0.7, 0.7]
			])
		];

		expect(hitVertex(stacked, {x: 0.5, y: 0.5}, 0.05)).toEqual({
			index: 0,
			shapeId: 'over'
		});
	});

	it('will grab a vertex of a polygon that is still being clicked out', () => {
		expect(
			hitVertex([shape('s1', [[0.2, 0.2]])], {x: 0.2, y: 0.21}, VERTEX_RADIUS)
		).toEqual({index: 0, shapeId: 's1'});
	});
});

describe('hitShape', () => {
	it('names the shape the point is inside', () => {
		expect(hitShape([square('s1', 0.25)], {x: 0.5, y: 0.5})).toBe('s1');
		expect(hitShape([square('s1', 0.25)], {x: 0.05, y: 0.05})).toBeUndefined();
	});

	it('returns the topmost of two that overlap', () => {
		const shapes = [square('under', 0.1), square('over', 0.2)];

		expect(hitShape(shapes, {x: 0.5, y: 0.5})).toBe('over');
		// Outside the top one, still inside the one below.
		expect(hitShape(shapes, {x: 0.15, y: 0.5})).toBe('under');
	});

	it('counts crossings even-odd, so a shape drawn through itself has holes', () => {
		// A bowtie: the crossing point belongs to neither lobe.
		const bowtie = shape('s1', [
			[0, 0],
			[1, 1],
			[1, 0],
			[0, 1]
		]);

		expect(hitShape([bowtie], {x: 0.2, y: 0.5})).toBe('s1');
		expect(hitShape([bowtie], {x: 0.5, y: 0.2})).toBeUndefined();
	});

	it('ignores a shape that is not a polygon yet', () => {
		expect(
			hitShape(
				[
					shape('s1', [
						[0, 0],
						[1, 1]
					])
				],
				{x: 0.5, y: 0.5}
			)
		).toBeUndefined();
	});
});

describe('shapePath', () => {
	it('walks the points in image pixels and closes itself', () => {
		expect(shapePath(square('s1', 0.25), 100, 200)).toBe(
			'M25 50 L75 50 L75 150 L25 150 Z'
		);
	});

	it('draws nothing for a shape with no points', () => {
		expect(shapePath(shape('s1', []), 100, 100)).toBe('');
	});
});

describe('rasterizeMask', () => {
	it('is identity when there is nothing to draw', () => {
		// Undefined, not an array of zeroes: the caller skips the whole composite.
		expect(rasterizeMask(undefined, 8, 8)).toBeUndefined();
		expect(rasterizeMask({shapes: []}, 8, 8)).toBeUndefined();
		expect(
			rasterizeMask({shapes: [shape('s1', [[0.1, 0.1]])]}, 8, 8)
		).toBeUndefined();
		expect(contexts).toHaveLength(0);
	});

	it('refuses a canvas with no pixels in it', () => {
		expect(rasterizeMask({shapes: [square('s1', 0.25)]}, 0, 8)).toBeUndefined();
	});

	it('cuts a hole: inside is 0, outside is 1', () => {
		const width = 32;
		const height = 32;
		const shapes = rasterizeMask({shapes: [square('s1', 0.25)]}, width, height);
		const effective = mergeAlpha(
			new Float32Array(width * height).fill(1),
			shapes,
			width * height
		)!;

		expect(at(effective, width, 16, 16)).toBe(0);
		expect(at(effective, width, 1, 1)).toBe(1);
		expect(at(effective, width, 30, 30)).toBe(1);
	});

	it('inverted cut: keeps the ring and drops the whole rest of the picture', () => {
		const width = 32;
		const height = 32;
		const shapes = rasterizeMask(
			{shapes: [{...square('s1', 0.25), invert: true}]},
			width,
			height
		);
		const effective = mergeAlpha(
			new Float32Array(width * height).fill(1),
			shapes,
			width * height
		)!;

		// Exactly the other way up from the plain cut above.
		expect(at(effective, width, 16, 16)).toBe(1);
		expect(at(effective, width, 1, 1)).toBe(0);
		expect(at(effective, width, 30, 30)).toBe(0);
	});

	it('inverted keep: adds everywhere except the ring', () => {
		const width = 32;
		const height = 32;
		const shapes = rasterizeMask(
			{shapes: [{...square('s1', 0.25, 'keep'), invert: true}]},
			width,
			height
		);
		const effective = mergeAlpha(
			new Float32Array(width * height),
			shapes,
			width * height
		)!;

		expect(at(effective, width, 16, 16)).toBe(0);
		expect(at(effective, width, 1, 1)).toBe(1);
	});

	it('feathers an inverted shape across the same edge, the other way up', () => {
		const width = 48;
		const height = 48;
		const shapes = rasterizeMask(
			{shapes: [{...square('s1', 0.25, 'cut', 0.06), invert: true}]},
			width,
			height
		)!;
		const across = [];

		for (let x = 4; x <= 24; x++) {
			across.push(at(shapes, width, x, 24));
		}

		// Fully cut out at the edge of the picture, untouched in the middle of the ring,
		// and never a step back on the way — a blurred inverse is still a blur.
		expect(across[0]).toBeCloseTo(-1, 5);
		expect(across[across.length - 1]).toBeCloseTo(0, 5);

		for (let index = 1; index < across.length; index++) {
			expect(across[index]).toBeGreaterThanOrEqual(across[index - 1] - 1e-6);
		}
	});

	it('patches: a keep shape adds where the model found nothing', () => {
		const width = 32;
		const height = 32;
		const shapes = rasterizeMask(
			{shapes: [square('s1', 0.25, 'keep')]},
			width,
			height
		);
		const effective = mergeAlpha(
			new Float32Array(width * height),
			shapes,
			width * height
		)!;

		expect(at(effective, width, 16, 16)).toBe(1);
		expect(at(effective, width, 1, 1)).toBe(0);
	});

	it('keeps cut and keep from cancelling in the canvas', () => {
		// The reason each shape gets its own cleared canvas. A keep over a cut has to add
		// back to the model's alpha, not paint over the cut and land on the same white.
		const width = 16;
		const height = 16;
		const shapes = rasterizeMask(
			{shapes: [square('s1', 0.25), square('s2', 0.375, 'keep')]},
			width,
			height
		)!;

		// Cut and keep together: they sum to zero, so the model's alpha survives there.
		expect(at(shapes, width, 8, 8)).toBe(0);
		// Cut alone.
		expect(at(shapes, width, 5, 8)).toBe(-1);
		// Neither.
		expect(at(shapes, width, 1, 1)).toBe(0);
		expect(contexts).toHaveLength(1);
		expect(contexts[0].fills).toHaveLength(2);
	});

	it('feathers monotonically across the edge', () => {
		const width = 48;
		const height = 48;
		const shapes = rasterizeMask(
			{shapes: [square('s1', 0.25, 'cut', 0.06)]},
			width,
			height
		);
		const effective = mergeAlpha(
			new Float32Array(width * height).fill(1),
			shapes,
			width * height
		)!;
		const across = [];

		for (let x = 4; x <= 24; x++) {
			across.push(at(effective, width, x, 24));
		}

		// Opaque outside, transparent in, and never a step back on the way.
		expect(across[0]).toBeCloseTo(1, 5);
		expect(across[across.length - 1]).toBeCloseTo(0, 5);

		for (let index = 1; index < across.length; index++) {
			expect(across[index]).toBeLessThanOrEqual(across[index - 1] + 1e-6);
		}

		// And it is actually soft: something strictly between the two.
		expect(across.some(value => value > 0.05 && value < 0.95)).toBe(true);
	});

	it('measures feather against the SHORT edge', () => {
		// 0.1 of a 20-pixel short edge is 2px, whichever way round the image is.
		rasterizeMask({shapes: [square('s1', 0.25, 'cut', 0.1)]}, 40, 20);
		expect(contexts[0].filters).toContain('blur(2px)');

		contexts.length = 0;
		rasterizeMask({shapes: [square('s1', 0.25, 'cut', 0.1)]}, 20, 40);
		expect(contexts[0].filters).toContain('blur(2px)');
	});

	it('skips a blur that is under half a pixel', () => {
		rasterizeMask({shapes: [square('s1', 0.25, 'cut', 0.001)]}, 32, 32);
		expect(contexts[0].filters.filter(value => value !== 'none')).toEqual([]);
	});

	it('paints an opaque background before every shape', () => {
		// The red channel only carries coverage on an opaque canvas: a canvas
		// un-premultiplies on the way out of `getImageData`, which would quantise the
		// whole feather away. The black fill is also what stops one shape leaking into
		// the next.
		rasterizeMask(
			{shapes: [square('s1', 0.25), square('s2', 0.375, 'keep')]},
			16,
			16
		);
		expect(contexts[0].rects).toEqual([
			{h: 16, value: 0, w: 16},
			{h: 16, value: 0, w: 16}
		]);
	});
});

describe('mergeAlpha', () => {
	it('has nothing to composite when neither half exists', () => {
		expect(mergeAlpha(undefined, undefined, 4)).toBeUndefined();
	});

	it('is the tuning alone when there are no shapes', () => {
		expect([
			...mergeAlpha(new Float32Array([0, 0.5, 1]), undefined, 3)!
		]).toEqual([0, 0.5, 1]);
	});

	it('is the shapes over a fully opaque image when there is no cutout', () => {
		// The `?? 1` — a mask on an asset the model never ran on still has something to
		// cut out of.
		expect([
			...mergeAlpha(undefined, new Float32Array([-1, -0.25, 0, 1]), 4)!
		]).toEqual([0, 0.75, 1, 1]);
	});

	it('adds the two, so a tuning slider can never reshape a hand-drawn edge', () => {
		expect([
			...mergeAlpha(
				new Float32Array([0.5, 0.5, 0.5, 0]),
				new Float32Array([-0.25, 0.25, 0, 1]),
				4
			)!
		]).toEqual([0.25, 0.75, 0.5, 1]);
	});

	it('clamps rather than wrapping', () => {
		expect([
			...mergeAlpha(new Float32Array([1, 0]), new Float32Array([1, -1]), 2)!
		]).toEqual([1, 0]);
	});

	it('treats a short input as opaque, never as a hole', () => {
		// Sizes should always agree; if they ever do not, the asset is drawn whole rather
		// than silently gaining a transparent tail.
		expect([...mergeAlpha(new Float32Array([0.5]), undefined, 3)!]).toEqual([
			0.5, 1, 1
		]);
		expect([...mergeAlpha(undefined, new Float32Array([-1]), 3)!]).toEqual([
			0, 1, 1
		]);
	});
});
