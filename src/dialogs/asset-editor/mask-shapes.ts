/**
 * The geometry behind hand-drawn masks: shapes in, one alpha contribution out.
 *
 * Kept free of React, and of the DOM apart from one offscreen canvas, so the maths can be
 * tested on its own the way `image-edits.ts` is. Nothing here imports the background
 * engine — a mask is drawn by hand and means the same thing whether or not a model ever
 * ran on the asset, and the two only ever meet in `mergeAlpha`.
 *
 * Everything is in fractions of the SOURCE image. Pixels would have to be rewritten the
 * moment the asset is recropped or resized; fractions survive both, which is the whole
 * reason the mask is shapes on the meta rather than a painted sidecar.
 */
import type {AssetMask, Frac2, MaskShape} from '@sliders/scene-types';

// Re-exported here because this is where everything that acts on them lives; the shapes
// themselves belong to scene-types, which `AssetMeta` compiles against.
export type {AssetMask, MaskOp, MaskShape} from '@sliders/scene-types';

/**
 * What the drawing helpers below need of a shape: an id and a ring. Mask shapes and walk
 * shapes are both this, plus their own op.
 */
export interface RingShape {
	id: string;
	points: Frac2[];
}

/** Which of the three previews the editor is showing. */
export type MaskMode = 'rendered' | 'paint' | 'alpha';

export const MASK_MODES: readonly MaskMode[] = ['rendered', 'paint', 'alpha'];

export type MaskToolId = 'polygon' | 'freehand' | 'edit';

export const MASK_TOOL_IDS: readonly MaskToolId[] = [
	'polygon',
	'freehand',
	'edit'
];

/** A new shape cuts hard. Softening is a deliberate act, and undoable by eye. */
export const DEFAULT_FEATHER = 0;

/**
 * Feather runs to a tenth of the short edge and no further.
 *
 * Past that the blur is wider than most of the shapes anyone draws, so the shape stops
 * reading as a shape at all — and the slider spends its whole useful travel in its first
 * few percent. The step is finer than the three decimals feather is stored at.
 */
export const FEATHER_RANGE = {max: 0.1, min: 0, step: 0.005};

/**
 * Freehand: drop a point unless it is at least this far from the last one.
 *
 * A fraction of the short edge rather than a pixel count, because the gesture is recorded
 * in fractions: three pixels on a thousand-pixel edge, which is about where a drag stops
 * producing points a human meant and starts producing tremor.
 */
export const FREEHAND_MIN_STEP = 0.003;

/**
 * Hit radius for a vertex grab, as a fraction of the short edge.
 *
 * Generous on purpose. A missed grab starts a drag on the shape instead, and undoing that
 * costs more than an occasional grab of the wrong nearby corner.
 */
export const VERTEX_RADIUS = 0.02;

/** Shapes shorter than this are a gesture in progress, not a polygon. */
const MIN_POINTS = 3;

/**
 * Twice the signed area of the ring. Positive is CLOCKWISE on screen.
 *
 * Clockwise and not anticlockwise for a positive shoelace because these are image
 * coordinates, where y grows downwards — the same flip that makes `rot` clockwise in
 * `stage-geometry`. Scaling fractions back to pixels multiplies this by `width * height`,
 * which is positive, so the sign is the same whatever the image's aspect: no size is
 * needed to ask which way round a shape was drawn.
 *
 * Returned doubled and unnormalised because every caller only wants the sign.
 */
export function ringArea(points: Frac2[]): number {
	let total = 0;

	for (
		let index = 0, previous = points.length - 1;
		index < points.length;
		previous = index++
	) {
		total +=
			points[previous].x * points[index].y - points[index].x * points[previous].y;
	}

	return total;
}

/**
 * What `invert` a shape drawn along these points starts with: anticlockwise means the
 * outside.
 *
 * The gesture IS the control here — there is no modifier to hold and no mode to be in, so
 * a cut of everything-but-this is one stroke rather than a stroke and a trip to the pane.
 * A ring with no area at all (three points in a line) is not inverted: it covers nothing
 * either way, and guessing the other way round would cut the entire image.
 */
export function drawnInverted(points: Frac2[]): boolean {
	return ringArea(points) < 0;
}

/**
 * Ids are `s1`, `s2`, … rather than uuids: they are only ever unique within one asset's
 * mask, they are what the shape list numbers itself from, and a mask of a dozen shapes
 * rides sync inside `AssetMeta`, where thirty-six characters a shape is real weight.
 */
export function newShapeId(existing: RingShape[]): string {
	let next = 1;

	for (const shape of existing) {
		const match = /^s(\d+)$/.exec(shape.id);

		if (match) {
			next = Math.max(next, Number(match[1]) + 1);
		}
	}

	// Ids that came from somewhere else — a hand-edited meta, a future tool — are not
	// numbered, so fall past them rather than colliding with one.
	while (existing.some(shape => shape.id === `s${next}`)) {
		next++;
	}

	return `s${next}`;
}

/** Clamped to the image and rounded to three decimals, exactly like `roundAnchor`. */
export function roundPoint(point: Frac2): Frac2 {
	return {x: roundFraction(point.x), y: roundFraction(point.y)};
}

/**
 * A shape as it is stored.
 *
 * Feather is rounded and clamped here too, not only the points: it is a fraction of the
 * same image and gets the same three decimals, and a value past `FEATHER_RANGE` would
 * come back to a slider that cannot represent it.
 */
export function roundShape(shape: MaskShape): MaskShape {
	const {invert, ...rest} = shape;
	const rounded: MaskShape = {
		...rest,
		feather: roundFeather(shape.feather),
		points: shape.points.map(roundPoint)
	};

	// Dropped rather than written as `false`. A mask of a dozen shapes rides sync inside
	// `AssetMeta`, the flag is off on almost all of them, and an absent key is also what
	// keeps every shape stored before this existed comparing equal to itself.
	if (invert) {
		rounded.invert = true;
	}

	return rounded;
}

/**
 * Whether two masks would store identically — what `dirty` is asking.
 *
 * An absent mask and a mask with no shapes compare equal. They render the same, they
 * store the same once an empty mask is cleared rather than written, and the alternative
 * is every caller having to normalise before it can ask.
 */
export function sameMask(
	a: AssetMask | undefined,
	b: AssetMask | undefined
): boolean {
	const left = a?.shapes ?? [];
	const right = b?.shapes ?? [];

	if (left.length !== right.length) {
		return false;
	}

	return left.every((shape, index) => sameShape(shape, right[index]));
}

/** No shapes, or every shape has fewer than 3 points. */
export function emptyMask(mask: AssetMask | undefined): boolean {
	return liveShapes(mask).length === 0;
}

/**
 * Shapes worth drawing: 3 points or more.
 *
 * A one- or two-point shape is a polygon the author is still clicking out. It is kept in
 * the mask so the gesture can be undone a point at a time, and ignored by everything that
 * rasterises, hit-tests or decides whether the asset has a mask at all.
 */
export function liveShapes(mask: AssetMask | undefined): MaskShape[] {
	return (mask?.shapes ?? []).filter(
		shape => shape.points.length >= MIN_POINTS
	);
}

/**
 * Douglas-Peucker over a CLOSED ring.
 *
 * Run as an open line from the first point back round to itself, which pins the point the
 * author started the stroke at and lets the algorithm decide about every other. The
 * repeated closing point is dropped again on the way out: a ring that stores its first
 * point twice draws a zero-length edge, and every consumer here closes the polygon
 * itself.
 *
 * Never returns fewer than 3 points. A tolerance large enough to collapse the ring would
 * otherwise turn a shape the author can see into one that `liveShapes` throws away.
 */
export function simplifyRing(points: Frac2[], tolerance: number): Frac2[] {
	if (points.length <= MIN_POINTS || !(tolerance > 0)) {
		return points.map(point => ({...point}));
	}

	const ring = [...points, points[0]];
	const keep = new Uint8Array(ring.length);

	keep[0] = 1;
	keep[ring.length - 1] = 1;

	// An explicit stack, not recursion: a freehand drag records thousands of points, and
	// the worst case for Douglas-Peucker is one frame per point.
	const stack: [number, number][] = [[0, ring.length - 1]];

	while (stack.length > 0) {
		const [first, last] = stack.pop()!;
		let farthest = -1;
		let distance = tolerance;

		for (let index = first + 1; index < last; index++) {
			const candidate = segmentDistance(ring[index], ring[first], ring[last]);

			if (candidate > distance) {
				distance = candidate;
				farthest = index;
			}
		}

		if (farthest !== -1) {
			keep[farthest] = 1;
			stack.push([first, farthest], [farthest, last]);
		}
	}

	const simplified: Frac2[] = [];

	// The last entry is the repeated first point; it closed the line and is not a vertex.
	for (let index = 0; index < ring.length - 1; index++) {
		if (keep[index]) {
			simplified.push({...ring[index]});
		}
	}

	return simplified.length >= MIN_POINTS ? simplified : spread(points);
}

/**
 * Nearest vertex within `radius`, searched topmost shape first.
 *
 * Topmost wins outright rather than nearest overall: the shape drawn last is the one
 * drawn on top, and grabbing a corner of something underneath it — when the author can
 * see the handle they aimed at — reads as the editor ignoring the click.
 *
 * Distances are measured in fraction space, so on a very wide image the radius is a
 * little taller than it is broad. Nobody has ever noticed; the alternative is passing the
 * image size into a hit test that has no other use for it.
 */
export function hitVertex(
	shapes: RingShape[],
	point: Frac2,
	radius: number
): {shapeId: string; index: number} | undefined {
	for (let order = shapes.length - 1; order >= 0; order--) {
		const shape = shapes[order];
		let best: {shapeId: string; index: number} | undefined;
		let bestDistance = radius;

		for (let index = 0; index < shape.points.length; index++) {
			const vertex = shape.points[index];
			const distance = Math.hypot(vertex.x - point.x, vertex.y - point.y);

			if (distance <= bestDistance) {
				bestDistance = distance;
				best = {index, shapeId: shape.id};
			}
		}

		if (best) {
			return best;
		}
	}

	return undefined;
}

/**
 * Topmost shape containing the point, by even-odd winding.
 *
 * Inside the RING, for an inverted shape too, even though that is the half it does not
 * act on. Picking is aimed at the outline the author can see; the alternative is that
 * every click on empty ground selects whichever inverted shape is topmost, and there is
 * then no gesture left that drops the selection.
 */
export function hitShape(
	shapes: RingShape[],
	point: Frac2
): string | undefined {
	for (let order = shapes.length - 1; order >= 0; order--) {
		const shape = shapes[order];

		if (shape.points.length >= MIN_POINTS && inPolygon(shape.points, point)) {
			return shape.id;
		}
	}

	return undefined;
}

/**
 * The shape as an SVG path `d`, in a `0 0 width height` viewBox.
 *
 * A `d` and not a `points` list, so the same string serves the outline the overlay draws,
 * a `<clipPath>` and a hit area, and so the closing `Z` is explicit rather than a
 * property of the element it is handed to. Empty for a shape with nothing to draw —
 * `<path d="">` renders nothing, which is what a one-point gesture should look like.
 */
export function shapePath(
	shape: Pick<RingShape, 'points'>,
	width: number,
	height: number
): string {
	if (shape.points.length === 0) {
		return '';
	}

	return (
		shape.points
			.map(
				(point, index) =>
					`${index === 0 ? 'M' : 'L'}${trim(point.x * width)} ${trim(
						point.y * height
					)}`
			)
			.join(' ') + ' Z'
	);
}

/**
 * The hand-drawn contribution, one value per pixel, in [-1, 1]. `keep` adds, `cut`
 * subtracts. Undefined when nothing is drawn, so the caller can skip the composite
 * entirely rather than merge an array of zeroes over every pixel of a backdrop.
 *
 * One shape at a time into a cleared canvas, accumulated in JS. Filling them all into one
 * canvas would be a single pass, and wrong: a `keep` over a `cut` has to add back to
 * whatever the model produced, not paint over the cut and land on the same white.
 */
export function rasterizeMask(
	mask: AssetMask | undefined,
	width: number,
	height: number
): Float32Array | undefined {
	const shapes = liveShapes(mask);

	if (shapes.length === 0 || width < 1 || height < 1) {
		return undefined;
	}

	const canvas = document.createElement('canvas');

	canvas.width = width;
	canvas.height = height;

	// Opaque, and read back out of the RED channel rather than the alpha one. A canvas
	// un-premultiplies on the way out of `getImageData`, so a feathered white shape on a
	// transparent canvas comes back with red at 255 everywhere it is drawn at all — the
	// entire feather quantised away into the alpha channel. On black, coverage IS the
	// red value. Same trade `cutout-map.ts` makes for the stored map.
	const context = canvas.getContext('2d', {
		alpha: false,
		willReadFrequently: true
	});

	if (!context) {
		return undefined;
	}

	const short = Math.min(width, height);
	const total = new Float32Array(width * height);

	for (const shape of shapes) {
		// Painted black rather than cleared: `{alpha: false}` is a hint, and a context
		// that ignored it would leave the previous shape's coverage showing through.
		context.filter = 'none';
		context.fillStyle = '#000';
		context.fillRect(0, 0, width, height);

		// Feather is a fraction of the SHORT edge, so a soft edge stays as soft as it
		// looks when the same mask is applied to a re-exported, differently sized copy.
		const blur = Math.max(0, shape.feather) * short;

		// Under half a pixel the blur costs a full-canvas filter pass and changes
		// nothing. Browsers without `filter` support drop the feather and keep the shape,
		// which is the right way round to fail.
		context.filter = blur >= 0.5 ? `blur(${blur}px)` : 'none';
		context.fillStyle = '#fff';
		context.fill(shapePathFor(shape, width, height), 'evenodd');

		const pixels = context.getImageData(0, 0, width, height).data;
		const sign = shape.op === 'cut' ? -1 : 1;

		for (let index = 0; index < total.length; index++) {
			const coverage = pixels[index * 4] / 255;

			// Inverted by reading the coverage back the other way up, rather than by
			// filling the ring and the image border together under `evenodd`. Same
			// region, and it keeps the feather honest at both edges: blurring is a
			// weighted average, so `1 - blur(ring)` is `blur(1 - ring)`, whereas a border
			// drawn into the path would pick up a blur of its own and fade the outermost
			// pixels of an image the shape never went near.
			total[index] += sign * (shape.invert ? 1 - coverage : coverage);
		}
	}

	return total;
}

/**
 * The alpha the asset is actually drawn through: `clamp((tuned ?? 1) + shapes, 0, 1)`.
 *
 * Addition, so the two halves stay independent — the model's alpha can be re-tuned all
 * day without a hand-drawn edge moving, and a mask on an asset that was never cut out
 * still has something to add to, which is what the `?? 1` is. Undefined when BOTH are
 * undefined: there is nothing to composite and the original bytes are already right.
 */
export function mergeAlpha(
	tuned: Float32Array | undefined,
	shapes: Float32Array | undefined,
	length: number
): Float32Array | undefined {
	if (!tuned && !shapes) {
		return undefined;
	}

	const merged = new Float32Array(length);

	for (let index = 0; index < length; index++) {
		merged[index] = Math.min(
			1,
			Math.max(0, (tuned?.[index] ?? 1) + (shapes?.[index] ?? 0))
		);
	}

	return merged;
}

function shapePathFor(shape: MaskShape, width: number, height: number): Path2D {
	const path = new Path2D();

	shape.points.forEach((point, index) => {
		const x = point.x * width;
		const y = point.y * height;

		if (index === 0) {
			path.moveTo(x, y);
		} else {
			path.lineTo(x, y);
		}
	});

	path.closePath();

	return path;
}

function roundFraction(value: number): number {
	if (!Number.isFinite(value)) {
		return 0;
	}

	return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

function roundFeather(value: number): number {
	if (!Number.isFinite(value)) {
		return DEFAULT_FEATHER;
	}

	return (
		Math.round(
			Math.min(FEATHER_RANGE.max, Math.max(FEATHER_RANGE.min, value)) * 1000
		) / 1000
	);
}

function sameShape(a: MaskShape, b: MaskShape): boolean {
	return (
		a.id === b.id &&
		a.op === b.op &&
		// Absent and false are the same shape: `roundShape` drops the flag rather than
		// storing `invert: false` on every shape anyone ever drew.
		!!a.invert === !!b.invert &&
		a.feather === b.feather &&
		a.points.length === b.points.length &&
		a.points.every(
			(point, index) =>
				point.x === b.points[index].x && point.y === b.points[index].y
		)
	);
}

/** Perpendicular distance from a point to a segment, degenerate segments included. */
function segmentDistance(point: Frac2, from: Frac2, to: Frac2): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const span = dx * dx + dy * dy;

	if (span === 0) {
		return Math.hypot(point.x - from.x, point.y - from.y);
	}

	const along = Math.min(
		1,
		Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / span)
	);

	return Math.hypot(
		point.x - (from.x + along * dx),
		point.y - (from.y + along * dy)
	);
}

/** Three points spaced evenly round the ring: the smallest shape that is still that shape. */
function spread(points: Frac2[]): Frac2[] {
	return [0, Math.floor(points.length / 3), Math.floor((2 * points.length) / 3)]
		.map(index => points[index])
		.map(point => ({...point}));
}

/** Even-odd crossing count, matching the fill rule the rasteriser uses. */
function inPolygon(points: Frac2[], point: Frac2): boolean {
	let inside = false;

	for (
		let index = 0, previous = points.length - 1;
		index < points.length;
		previous = index++
	) {
		const a = points[index];
		const b = points[previous];

		if (
			a.y > point.y !== b.y > point.y &&
			point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
		) {
			inside = !inside;
		}
	}

	return inside;
}

/** Path coordinates without a trailing run of zeroes, which triples the size of a `d`. */
function trim(value: number): number {
	return Math.round(value * 100) / 100;
}
