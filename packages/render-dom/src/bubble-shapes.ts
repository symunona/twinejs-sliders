/**
 * Drawn speech bubbles: the shape standard.
 *
 * A shape is a PURE FUNCTION of a handful of numbers and two colours that returns SVG
 * markup plus the two measurements the layout needs back — how far the drawing spills
 * outside the bubble box (`margin`) and how much room inside it the text must leave
 * (`padding`). No DOM, no clock, no randomness that is not seeded, so the same input
 * always produces byte-identical markup. That is what makes it safe to regenerate on every
 * reposition, to unit test as a string, and to share between the editor preview and the
 * player without either of them owning it.
 *
 * Why SVG rather than more CSS. A CSS bubble is a rounded box with a triangle glued to one
 * edge: it cannot have a jagged outline, an offset slab behind it, a tail that is a
 * lightning bolt, or a cloud's scalloped edge — the shapes an author actually asks for.
 * Those are paths. And a path scales with the slide for free, which is the whole point of
 * `sizing: absolute`.
 *
 * The contract every shape keeps:
 *
 *   - It draws inside the rectangle (0, 0) to (width, height). That rectangle is the
 *     BUBBLE BOX, the thing the layout positions and the text wraps into.
 *   - It may draw outside it — a tail, an outline, a slab — up to `margin` px on every
 *     side. The SVG's viewBox is grown by that margin, and the element is offset by it, so
 *     the box stays where the layout put it.
 *   - `padding` is the shape's own statement of where the text is safe. A cloud needs far
 *     more than a rectangle does, and only the shape knows.
 *   - It never reads a colour it was not given, and it never emits a colour it was not
 *     given without sanitising it: these strings come from story YAML and end up in
 *     `innerHTML`.
 */

import type {BubbleShapeName, Vec2} from '@sliders/scene-types';
import {BUBBLE_SHAPES} from '@sliders/scene-types';

/** Which side of the anchor the bubble sits on. The tail leaves the opposite edge. */
export type BubbleSide = 'above' | 'below' | 'left' | 'right';

export interface BubblePadding {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface BubbleShapeInput {
	/** The bubble box, in px. */
	width: number;
	height: number;
	/**
	 * Where the words come from, in BUBBLE-LOCAL px — (0, 0) is the box's top left, and the
	 * point is normally outside the box. `null` is a detached bubble: draw no tail.
	 */
	anchor?: Vec2 | null;
	/** Which edge of the box faces the anchor. */
	side: BubbleSide;
	/** Fill. */
	color: string;
	/** Outline, slab, highlight — whatever the second colour means to this shape. */
	accent: string;
	/**
	 * Stable per bubble, not per frame.
	 *
	 * Every wobble and jitter comes from here, so a shape keeps its outline while it moves,
	 * resizes or re-renders, and two bubbles on one stage do not look stamped from the same
	 * die. Callers pass `hashSeed(speaker + style)`.
	 */
	seed: number;
}

export interface BubbleShapeResult {
	/** Complete `<svg>` element markup. */
	svg: string;
	/** How far the drawing reaches past the box, on every side. */
	margin: number;
	/** Room the text must keep clear inside the box. */
	padding: BubblePadding;
}

export type BubbleShapeFn = (input: BubbleShapeInput) => BubbleShapeResult;

interface Pt {
	x: number;
	y: number;
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** FNV-1a. Any stable string in, one 32-bit seed out. */
export function hashSeed(text: string): number {
	let h = 0x811c9dc5;

	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}

	return h >>> 0;
}

/** mulberry32: small, fast, and identical in every JS engine, which is the requirement. */
function rng(seed: number): () => number {
	let a = seed >>> 0;

	return () => {
		a = (a + 0x6d2b79f5) | 0;

		let t = Math.imul(a ^ (a >>> 15), 1 | a);

		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A signed jitter in `±amount`, from the next draw. */
function jitter(next: () => number, amount: number): number {
	return (next() * 2 - 1) * amount;
}

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------

const NAMED_COLOUR = /^[a-z]{3,24}$/i;
const HEX_COLOUR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOUR = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9a-z%.,\s/-]+\)$/i;

/**
 * Colours arrive from story YAML and leave through `innerHTML`, so they are checked rather
 * than escaped: a value that is not recognisably a CSS colour is replaced by the fallback
 * instead of being quoted into the markup. Escaping would let `bg: "}</svg><img onerror…"`
 * through as a visible mess; refusing it shows the author their typo as a default colour.
 */
export function cssColour(value: string | undefined, fallback: string): string {
	if (!value) {
		return fallback;
	}

	const trimmed = value.trim();

	if (
		NAMED_COLOUR.test(trimmed) ||
		HEX_COLOUR.test(trimmed) ||
		FUNC_COLOUR.test(trimmed)
	) {
		return trimmed;
	}

	return fallback;
}

/** Two decimals is under a thousandth of a stage and keeps the markup diffable. */
function n(value: number): string {
	return (Math.round(value * 100) / 100).toString();
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/**
 * A squircle: the shape a hand-drawn speech balloon actually is, between an ellipse and a
 * rounded rectangle. `exponent` 2 is an ellipse, 4 is close to a rounded box.
 */
function squirclePoints(
	width: number,
	height: number,
	exponent: number,
	steps: number,
	wobble: number,
	next: () => number
): Pt[] {
	const cx = width / 2;
	const cy = height / 2;
	const pts: Pt[] = [];

	for (let i = 0; i < steps; i++) {
		const t = (i / steps) * Math.PI * 2;
		const c = Math.cos(t);
		const s = Math.sin(t);
		const k = 2 / exponent;
		const r = 1 + jitter(next, wobble);

		pts.push({
			x: cx + Math.sign(c) * Math.abs(c) ** k * cx * r,
			y: cy + Math.sign(s) * Math.abs(s) ** k * cy * r
		});
	}

	return pts;
}

/**
 * A rectangle whose corners have been nudged, so nothing in it is quite square, SAMPLED
 * along its edges.
 *
 * The sampling is not decoration. A tail is spliced in by replacing the run of outline
 * points its base spans, so an outline of four corner points has nothing to replace but a
 * corner: the first version of this returned four points and the panel disappeared, leaving
 * a bolt floating beside where it used to be. Every outline a tail can attach to must be
 * dense enough that its base covers points rather than corners.
 */
function skewedRectPoints(
	width: number,
	height: number,
	amount: number,
	next: () => number,
	perSide = 10
): Pt[] {
	const corners: Pt[] = [
		{x: 0, y: 0},
		{x: width, y: 0},
		{x: width, y: height},
		{x: 0, y: height}
	].map(p => ({x: p.x + jitter(next, amount), y: p.y + jitter(next, amount)}));
	const pts: Pt[] = [];

	for (let i = 0; i < corners.length; i++) {
		const a = corners[i];
		const b = corners[(i + 1) % corners.length];

		for (let s = 0; s < perSide; s++) {
			const t = s / perSide;

			pts.push({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t});
		}
	}

	return pts;
}

/** Points to a path. `M … L … Z`. */
function polyPath(pts: Pt[]): string {
	return (
		pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`).join(' ') + ' Z'
	);
}

/**
 * Points to a smooth closed path, Catmull-Rom converted to cubic Béziers.
 *
 * Smoothing rather than sampling more points: a balloon's outline has to be a curve at any
 * size, and a 200-point polygon is both jagged at close range and a long string.
 */
function smoothPath(pts: Pt[]): string {
	const len = pts.length;
	const at = (i: number) => pts[((i % len) + len) % len];
	let d = `M${n(pts[0].x)} ${n(pts[0].y)}`;

	for (let i = 0; i < len; i++) {
		const p0 = at(i - 1);
		const p1 = at(i);
		const p2 = at(i + 1);
		const p3 = at(i + 2);

		d +=
			` C${n(p1.x + (p2.x - p0.x) / 6)} ${n(p1.y + (p2.y - p0.y) / 6)}` +
			` ${n(p2.x - (p3.x - p1.x) / 6)} ${n(p2.y - (p3.y - p1.y) / 6)}` +
			` ${n(p2.x)} ${n(p2.y)}`;
	}

	return d + ' Z';
}

/**
 * The same smoothing over an OPEN run of points, plus straight lines through `tail` and
 * back to the start. The ends are doubled so the curve actually reaches them.
 */
function smoothOpenPath(pts: Pt[], tail: Pt[]): string {
	const at = (i: number) => pts[clamp(i, 0, pts.length - 1)];
	let d = `M${n(pts[0].x)} ${n(pts[0].y)}`;

	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = at(i - 1);
		const p1 = at(i);
		const p2 = at(i + 1);
		const p3 = at(i + 2);

		d +=
			` C${n(p1.x + (p2.x - p0.x) / 6)} ${n(p1.y + (p2.y - p0.y) / 6)}` +
			` ${n(p2.x - (p3.x - p1.x) / 6)} ${n(p2.y - (p3.y - p1.y) / 6)}` +
			` ${n(p2.x)} ${n(p2.y)}`;
	}

	for (const p of tail) {
		d += ` L${n(p.x)} ${n(p.y)}`;
	}

	return d + ' Z';
}

function nearestIndex(pts: Pt[], target: Pt): number {
	let best = 0;
	let bestD = Infinity;

	for (let i = 0; i < pts.length; i++) {
		const d = (pts[i].x - target.x) ** 2 + (pts[i].y - target.y) ** 2;

		if (d < bestD) {
			bestD = d;
			best = i;
		}
	}

	return best;
}

export interface SplicedOutline {
	/**
	 * The outline, open: it starts at one base point, runs the long way round the shape and
	 * ends at the other. Curve it, corner it, do what the shape wants with it.
	 */
	body: Pt[];
	/** The tail's own vertices, between the two ends of `body`. Always straight lines. */
	tail: Pt[];
	/** `body` then `tail`, closed — everything, for a shape with no curves in it. */
	closed: Pt[];
}

/**
 * Splice a tail into a closed outline, so body and tail are ONE path.
 *
 * One path is not a detail: a tail drawn as its own shape shows the body's outline running
 * straight through its base, which is exactly what a speech balloon does not look like.
 * The run of outline points between the two base points is dropped and the tail's vertices
 * put in their place, so the stroke walks out along the tail and back.
 *
 * Which run to drop is decided by length: the tail's base is a short span of the
 * perimeter, so the SHORTER of the two arcs between the base points is the one the tail
 * replaces, whichever way round the caller gave them.
 *
 * `body` and `tail` come back apart because a curved shape must not smooth its tail — a
 * balloon's spike is the one part of it that is straight, and a Catmull-Rom through the
 * tip turns the point into a thumb.
 */
export function spliceTail(
	pts: Pt[],
	baseA: Pt,
	baseB: Pt,
	tail: Pt[]
): SplicedOutline {
	const len = pts.length;
	const ia = nearestIndex(pts, baseA);
	const ib = nearestIndex(pts, baseB);
	const forward = (ib - ia + len) % len;
	// `from`/`to` bracket the short arc, the one the tail replaces.
	const [from, to, startBase, endBase, vertices] =
		forward <= len - forward
			? [ia, ib, baseB, baseA, tail]
			: [ib, ia, baseA, baseB, [...tail].reverse()];
	// The long way round: from `to` forward until `from`. When both bases land on the SAME
	// outline point the short arc is empty, and the walk must go all the way round rather
	// than stop on the step it started — otherwise a tail on a sparsely sampled outline
	// eats the whole shape and leaves a floating tail.
	const count = ((from - to + len) % len) || len;
	const kept: Pt[] = [];

	for (let step = 0; step < count; step++) {
		kept.push(pts[(to + step) % len]);
	}

	const body = [startBase, ...kept, endBase];

	return {body, tail: vertices, closed: [...body, ...vertices]};
}

function boundsOf(pts: Pt[]): {minX: number; minY: number; maxX: number; maxY: number} {
	return pts.reduce(
		(acc, p) => ({
			minX: Math.min(acc.minX, p.x),
			minY: Math.min(acc.minY, p.y),
			maxX: Math.max(acc.maxX, p.x),
			maxY: Math.max(acc.maxY, p.y)
		}),
		{minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity}
	);
}

/** How far a set of points reaches outside the box, on the worst side. */
function overshoot(pts: Pt[], width: number, height: number): number {
	const b = boundsOf(pts);

	return Math.max(0, -b.minX, -b.minY, b.maxX - width, b.maxY - height);
}

/**
 * Where the tail leaves the box and where its tip goes.
 *
 * The tip is the anchor itself, pulled back so the point does not sit exactly on a
 * character's mouth, and reined in: a bubble clamped to the far side of the stage would
 * otherwise grow a tail half a screen long, which reads as a mistake rather than as speech.
 */
function tailGeometry(input: BubbleShapeInput, base: number) {
	const {width, height, anchor, side} = input;

	if (!anchor) {
		return undefined;
	}

	const reach = Math.max(width, height) * 0.9;
	const horizontal = side === 'above' || side === 'below';
	const edgeY = side === 'above' ? height : 0;
	const edgeX = side === 'left' ? width : 0;
	const centre: Pt = horizontal
		? {x: clamp(anchor.x, base, width - base), y: edgeY}
		: {x: edgeX, y: clamp(anchor.y, base, height - base)};
	const dx = anchor.x - centre.x;
	const dy = anchor.y - centre.y;
	const dist = Math.hypot(dx, dy) || 1;
	const length = Math.min(dist, reach);
	const tip: Pt = {
		x: centre.x + (dx / dist) * length,
		y: centre.y + (dy / dist) * length
	};
	const half = base / 2;
	const baseA: Pt = horizontal
		? {x: centre.x - half, y: edgeY}
		: {x: edgeX, y: centre.y - half};
	const baseB: Pt = horizontal
		? {x: centre.x + half, y: edgeY}
		: {x: edgeX, y: centre.y + half};

	return {baseA, baseB, centre, tip, length};
}

function clamp(value: number, min: number, max: number): number {
	return max < min ? min : Math.min(max, Math.max(min, value));
}

function svgWrap(
	width: number,
	height: number,
	margin: number,
	body: string
): string {
	const w = width + margin * 2;
	const h = height + margin * 2;

	return (
		`<svg class="sliders-bubble-shape-svg" xmlns="http://www.w3.org/2000/svg" ` +
		`width="${n(w)}" height="${n(h)}" ` +
		`viewBox="${n(-margin)} ${n(-margin)} ${n(w)} ${n(h)}" ` +
		`style="left:${n(-margin)}px;top:${n(-margin)}px" ` +
		`aria-hidden="true" focusable="false">${body}</svg>`
	);
}

// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

/**
 * The comic-book balloon: a fat squircle with a thick ink outline and a straight spike.
 *
 * The wobble is small on purpose (1.2%). Hand-drawn balloons are not round, but a balloon
 * that is visibly lumpy reads as a thought bubble, which is a different shape with a
 * different meaning.
 */
const comic: BubbleShapeFn = input => {
	const {width, height, seed} = input;
	const next = rng(seed);
	const stroke = clamp(Math.min(width, height) * 0.045, 3, 10);
	const base = clamp(Math.min(width, height) * 0.22, 14, 44);
	const shape = squirclePoints(width, height, 3.1, 44, 0.012, next);
	const tail = tailGeometry(input, base);
	const spliced = tail
		? spliceTail(shape, tail.baseA, tail.baseB, [tail.tip])
		: undefined;
	const colour = cssColour(input.color, '#ffffff');
	const ink = cssColour(input.accent, '#05060a');
	const d = spliced
		? smoothOpenPath(spliced.body, spliced.tail)
		: smoothPath(shape);
	const margin = Math.ceil(
		overshoot(spliced?.closed ?? shape, width, height) + stroke
	);

	return {
		svg: svgWrap(
			width,
			height,
			margin,
			`<path d="${d}" fill="${colour}" stroke="${ink}" stroke-width="${n(
				stroke
			)}" stroke-linejoin="round"/>`
		),
		margin,
		padding: {
			top: height * 0.13 + stroke,
			right: width * 0.1 + stroke,
			bottom: height * 0.13 + stroke,
			left: width * 0.1 + stroke
		}
	};
};

/**
 * The impact panel: a hard-edged slab with an offset colour plate behind it and a jagged
 * bolt for a tail. The reference is a comic caption box, not a balloon — nothing about it
 * is round, and its corners are deliberately a degree or two off square.
 */
function shardParts(input: BubbleShapeInput, withMark: boolean) {
	const {width, height, seed} = input;
	const next = rng(seed);
	const skew = clamp(Math.min(width, height) * 0.02, 2, 9);
	const stroke = clamp(Math.min(width, height) * 0.02, 2, 6);
	const base = clamp(Math.min(width, height) * 0.3, 18, 70);
	const shape = skewedRectPoints(width, height, skew, next);
	const tail = tailGeometry(input, base);
	const outline = tail
		? spliceTail(shape, tail.baseA, tail.baseB, boltPoints(tail, next)).closed
		: shape;
	const colour = cssColour(input.color, '#ffffff');
	const accent = cssColour(input.accent, '#3fc1cd');
	// The plate sits away from the tail, so the tail still reads against the art.
	const shiftX = input.side === 'left' ? stroke * 2 : -stroke * 2;
	const shiftY = input.side === 'above' ? -stroke * 2 : stroke * 2;
	const plate = outline.map(p => ({x: p.x + shiftX, y: p.y + shiftY}));
	const mark = withMark ? markPoints(input, next) : [];
	const all = [...outline, ...plate, ...mark.flat()];
	const margin = Math.ceil(overshoot(all, width, height) + stroke);
	const marks = mark
		.map(m => `<path d="${polyPath(m)}" fill="${accent}"/>`)
		.join('');

	return {
		svg: svgWrap(
			width,
			height,
			margin,
			`<path d="${polyPath(plate)}" fill="${accent}"/>` +
				marks +
				`<path d="${polyPath(outline)}" fill="${colour}" stroke="${accent}" ` +
				`stroke-width="${n(stroke)}" stroke-linejoin="miter"/>`
		),
		margin,
		padding: {
			top: height * 0.1 + stroke,
			right: width * 0.07 + stroke,
			bottom: height * 0.1 + stroke,
			left: width * 0.07 + stroke
		}
	};
}

/** The tail is a bolt: out, back across itself, out again. Three vertices do it. */
function boltPoints(
	tail: NonNullable<ReturnType<typeof tailGeometry>>,
	next: () => number
): Pt[] {
	const {centre, tip} = tail;
	const dx = tip.x - centre.x;
	const dy = tip.y - centre.y;
	const px = -dy;
	const py = dx;
	const kink = 0.28 + next() * 0.1;

	return [
		{x: centre.x + dx * 0.45 + px * kink * 0.35, y: centre.y + dy * 0.45 + py * kink * 0.35},
		{x: centre.x + dx * 0.6 - px * kink * 0.3, y: centre.y + dy * 0.6 - py * kink * 0.3},
		{x: tip.x, y: tip.y},
		{x: centre.x + dx * 0.55 - px * kink * 0.62, y: centre.y + dy * 0.55 - py * kink * 0.62}
	];
}

/**
 * The accent mark outside the corner furthest from the tail: a bar and a dot, tilted.
 *
 * It is the loudest thing in the reference art and it carries no text, so it goes where
 * the text is not — and it lives outside the box, which is what `margin` is for.
 */
function markPoints(input: BubbleShapeInput, next: () => number): Pt[][] {
	const {width, height, side} = input;
	const size = clamp(Math.min(width, height) * 0.22, 14, 54);
	// Away from the tail: `side` names where the BUBBLE is, so `above` means the tail leaves
	// the bottom edge and the mark belongs at the top.
	const right = side !== 'left';
	const top = side !== 'below';
	const x = right ? width + size * 0.25 : -size * 1.25;
	const y = top ? -size * 1.35 : height + size * 0.35;
	const tilt = 0.12 + next() * 0.08;
	const quad = (ox: number, oy: number, w: number, h: number): Pt[] => [
		{x: x + ox, y: y + oy},
		{x: x + ox + w, y: y + oy - w * tilt},
		{x: x + ox + w + h * tilt, y: y + oy + h - w * tilt},
		{x: x + ox + h * tilt, y: y + oy + h}
	];

	return [quad(0, 0, size * 0.42, size * 0.8), quad(0, size * 0.95, size * 0.42, size * 0.3)];
}

const shard: BubbleShapeFn = input => shardParts(input, false);
const impact: BubbleShapeFn = input => shardParts(input, true);

/**
 * The thought cloud. Lobes round the edge, and the tail is not a tail at all — it is a
 * line of shrinking puffs, which is the only way a thought reads as a thought.
 */
const thought: BubbleShapeFn = input => {
	const {width, height, anchor, seed} = input;
	const next = rng(seed);
	const stroke = clamp(Math.min(width, height) * 0.03, 2, 7);
	const colour = cssColour(input.color, '#ffffff');
	const ink = cssColour(input.accent, '#05060a');
	const lobes = Math.max(9, Math.round((width + height) / 60));
	const cx = width / 2;
	const cy = height / 2;
	const rx = width * 0.54;
	const ry = height * 0.6;
	const joints: Pt[] = [];

	for (let i = 0; i < lobes; i++) {
		const t = (i / lobes) * Math.PI * 2;
		const r = 1 + jitter(next, 0.05);

		joints.push({x: cx + Math.cos(t) * rx * r, y: cy + Math.sin(t) * ry * r});
	}

	let d = `M${n(joints[0].x)} ${n(joints[0].y)}`;

	for (let i = 0; i < lobes; i++) {
		const a = joints[i];
		const b = joints[(i + 1) % lobes];
		const chord = Math.hypot(b.x - a.x, b.y - a.y);
		const r = (chord / 2) * 1.28;

		d += ` A${n(r)} ${n(r)} 0 0 1 ${n(b.x)} ${n(b.y)}`;
	}

	d += ' Z';

	const puffs: string[] = [];
	const bounds = [...joints];

	if (anchor) {
		const dx = anchor.x - cx;
		const dy = anchor.y - cy;
		const dist = Math.hypot(dx, dy) || 1;
		const ux = dx / dist;
		const uy = dy / dist;
		const edge = Math.min(dist, Math.max(width, height));

		for (let i = 1; i <= 3; i++) {
			const t = 0.52 + i * 0.16;
			const r = clamp(Math.min(width, height) * (0.11 - i * 0.025), 3, 22);
			const px = cx + ux * edge * t;
			const py = cy + uy * edge * t;

			puffs.push(
				`<circle cx="${n(px)}" cy="${n(py)}" r="${n(r)}" fill="${colour}" ` +
					`stroke="${ink}" stroke-width="${n(stroke)}"/>`
			);
			bounds.push({x: px - r, y: py - r}, {x: px + r, y: py + r});
		}
	}

	const margin = Math.ceil(overshoot(bounds, width, height) + stroke * 2);

	return {
		svg: svgWrap(
			width,
			height,
			margin,
			puffs.join('') +
				`<path d="${d}" fill="${colour}" stroke="${ink}" stroke-width="${n(
					stroke
				)}" stroke-linejoin="round"/>`
		),
		margin,
		padding: {
			top: height * 0.17 + stroke,
			right: width * 0.12 + stroke,
			bottom: height * 0.17 + stroke,
			left: width * 0.12 + stroke
		}
	};
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const BUBBLE_SHAPE_FNS: Record<BubbleShapeName, BubbleShapeFn> = {
	comic,
	shard,
	impact,
	thought
};

export function isBubbleShape(name: string | undefined): name is BubbleShapeName {
	return !!name && (BUBBLE_SHAPES as readonly string[]).includes(name);
}

/** The one entry point. Unknown name, no drawing — the CSS presets take it from there. */
export function bubbleShape(
	name: string | undefined,
	input: BubbleShapeInput
): BubbleShapeResult | undefined {
	if (!isBubbleShape(name)) {
		return undefined;
	}

	return BUBBLE_SHAPE_FNS[name](input);
}

export type {Vec2};
