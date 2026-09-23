/**
 * Walk areas, headless: where a character may stand on a backdrop, the shortest way from
 * one spot to another, and that way compiled into the scene steps the renderer already
 * plays (point-and-click/walk-area.md).
 *
 * Pure. No DOM, no assets. The asset editor's ghost, the scene preview's walk-here and the
 * later player's click-to-walk all call this one file, so the three cannot disagree about
 * where the floor is.
 *
 * Three spaces:
 *
 *   IMAGE  fractions of the baked backdrop, 0..1, y DOWN. What `WalkArea` stores.
 *   PLANE  image fractions with x stretched by the image's aspect, so one unit is the
 *          same length both ways. Distances and nudges are measured here.
 *   SCENE  the stage (spec 02): -1..1, y UP. The backdrop is `object-fit: cover` in it.
 */

import {
	Character,
	DEFAULT_STEP_SECONDS,
	DEFAULT_WALK_SPEED,
	Frac2,
	SceneStep,
	Vec2,
	WalkArea,
	WalkDepth,
	WalkShape,
	poseImageName
} from '@sliders/scene-types';

export interface ImageSize {
	w: number;
	h: number;
}

/** The stage's aspect when nobody says otherwise. The renderer's `STAGE_ASPECT`. */
export const WALK_STAGE_ASPECT = 16 / 9;

/** How far a snapped or corner point is pushed off the boundary, in plane units. */
export const WALK_NUDGE = 0.002;

/** A ring needs this many points to have an inside. */
const MIN_RING = 3;

/** Pose a walk ends in, and glides in when there is no `walk`. */
export const IDLE_POSE = 'idle';

/** The pose a walk cycles. */
export const WALK_POSE = 'walk';

// ---------------------------------------------------------------------------
// Inside
// ---------------------------------------------------------------------------

function liveRings(area: WalkArea | undefined, op: WalkShape['op']): Frac2[][] {
	return (area?.shapes ?? [])
		.filter(shape => shape.op === op && shape.points.length >= MIN_RING)
		.map(shape => shape.points);
}

/** True when there is any floor at all. No floor means walking is not a question. */
export function hasWalkArea(area: WalkArea | undefined): boolean {
	return liveRings(area, 'walk').length > 0;
}

/** Even-odd point in ring. Works in any space, as long as both are in the same one. */
export function pointInRing(ring: Frac2[], p: Frac2): boolean {
	let inside = false;

	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const a = ring[i];
		const b = ring[j];

		if (
			a.y > p.y !== b.y > p.y &&
			p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
		) {
			inside = !inside;
		}
	}

	return inside;
}

/** Inside some `walk` ring and inside no `block` ring. Image fractions. */
export function isWalkable(area: WalkArea | undefined, p: Frac2): boolean {
	return insideRings(liveRings(area, 'walk'), liveRings(area, 'block'), p);
}

function insideRings(walk: Frac2[][], block: Frac2[][], p: Frac2): boolean {
	return (
		walk.some(ring => pointInRing(ring, p)) &&
		!block.some(ring => pointInRing(ring, p))
	);
}

// ---------------------------------------------------------------------------
// Plane geometry
// ---------------------------------------------------------------------------

interface Plane {
	/** x stretch: image w / h. */
	ar: number;
	walk: Vec2[][];
	block: Vec2[][];
	/** Every edge of every live ring, for crossing tests and snapping. */
	edges: [Vec2, Vec2][];
}

function toPlane(p: Frac2, ar: number): Vec2 {
	return {x: p.x * ar, y: p.y};
}

function fromPlane(p: Vec2, ar: number): Frac2 {
	return {x: p.x / ar, y: p.y};
}

function imageAspect(img: ImageSize | undefined): number {
	return img && img.w > 0 && img.h > 0 ? img.w / img.h : 1;
}

function makePlane(area: WalkArea | undefined, img: ImageSize | undefined): Plane {
	const ar = imageAspect(img);
	const walk = liveRings(area, 'walk').map(ring => ring.map(p => toPlane(p, ar)));
	const block = liveRings(area, 'block').map(ring =>
		ring.map(p => toPlane(p, ar))
	);
	const edges: [Vec2, Vec2][] = [];

	for (const ring of [...walk, ...block]) {
		for (let i = 0; i < ring.length; i++) {
			edges.push([ring[i], ring[(i + 1) % ring.length]]);
		}
	}

	return {ar, block, edges, walk};
}

function inPlane(plane: Plane, p: Vec2): boolean {
	return insideRings(plane.walk, plane.block, p);
}

function dist(a: Vec2, b: Vec2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len = dx * dx + dy * dy;
	const t =
		len === 0
			? 0
			: Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));

	return {x: a.x + t * dx, y: a.y + t * dy};
}

/**
 * Where segment `p→q` crosses segment `a→b`, as a fraction along `p→q`. Undefined when
 * they do not meet or are parallel.
 */
function crossing(p: Vec2, q: Vec2, a: Vec2, b: Vec2): number | undefined {
	const rx = q.x - p.x;
	const ry = q.y - p.y;
	const sx = b.x - a.x;
	const sy = b.y - a.y;
	const denom = rx * sy - ry * sx;

	if (Math.abs(denom) < 1e-12) {
		return undefined;
	}

	const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / denom;
	const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / denom;

	return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : undefined;
}

/**
 * Whether the whole straight line `p→q` stays on the floor.
 *
 * Cut at every boundary crossing and test the middle of each piece. A piece has no
 * crossing inside it, so it is wholly in or wholly out, and its middle says which. That
 * is what makes overlapping `walk` rings work: crossing the edge of one into another is
 * a crossing, and the piece beyond it is still floor.
 */
function visible(plane: Plane, p: Vec2, q: Vec2): boolean {
	const cuts = [0, 1];

	for (const [a, b] of plane.edges) {
		const t = crossing(p, q, a, b);

		if (t !== undefined) {
			cuts.push(t);
		}
	}

	cuts.sort((a, b) => a - b);

	for (let i = 0; i < cuts.length - 1; i++) {
		if (cuts[i + 1] - cuts[i] < 1e-9) {
			continue;
		}

		const mid = (cuts[i] + cuts[i + 1]) / 2;

		if (!inPlane(plane, {x: p.x + (q.x - p.x) * mid, y: p.y + (q.y - p.y) * mid})) {
			return false;
		}
	}

	return true;
}

/**
 * `q` on a boundary, pushed `WALK_NUDGE` onto the floor. Away from `from` first — the
 * direction that carried the pointer out — then along both edge normals.
 */
function nudgeIn(
	plane: Plane,
	q: Vec2,
	from: Vec2 | undefined,
	edge: [Vec2, Vec2] | undefined
): Vec2 | undefined {
	const tries: Vec2[] = [];

	if (from) {
		const d = dist(q, from);

		if (d > 1e-9) {
			tries.push({x: (q.x - from.x) / d, y: (q.y - from.y) / d});
		}
	}

	if (edge) {
		const ex = edge[1].x - edge[0].x;
		const ey = edge[1].y - edge[0].y;
		const len = Math.hypot(ex, ey);

		if (len > 1e-12) {
			tries.push({x: -ey / len, y: ex / len}, {x: ey / len, y: -ex / len});
		}
	}

	for (const dir of tries) {
		const p = {x: q.x + dir.x * WALK_NUDGE, y: q.y + dir.y * WALK_NUDGE};

		if (inPlane(plane, p)) {
			return p;
		}
	}

	return undefined;
}

/** Floor points nearest `p` first: the closest point of each edge, nudged on. */
function edgeCandidates(plane: Plane, p: Vec2): Vec2[] {
	return plane.edges
		.map(edge => {
			const q = closestOnSegment(p, edge[0], edge[1]);

			return {d: dist(p, q), edge, q};
		})
		.sort((a, b) => a.d - b.d)
		.map(({edge, q}) => nudgeIn(plane, q, p, edge))
		.filter((q): q is Vec2 => q !== undefined);
}

function snapPlane(plane: Plane, p: Vec2): Vec2 | undefined {
	if (inPlane(plane, p)) {
		return p;
	}

	return edgeCandidates(plane, p)[0];
}

/**
 * `p` if it is on the floor, else the nearest floor point: on a walk edge, or on the edge
 * of the block it is standing in, nudged `WALK_NUDGE` inward. Undefined when there is no
 * floor at all.
 */
export function snapToWalk(
	area: WalkArea | undefined,
	p: Frac2,
	img?: ImageSize
): Frac2 | undefined {
	const plane = makePlane(area, img);

	if (plane.walk.length === 0) {
		return undefined;
	}

	const snapped = snapPlane(plane, toPlane(p, plane.ar));

	return snapped && roundFrac(fromPlane(snapped, plane.ar));
}

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

/**
 * Every ring corner, pushed onto the floor. The graph's waypoints.
 *
 * All corners, not only the reflex ones the textbook graph keeps: a convex corner is never
 * on a shortest path, so it costs a few visibility tests and changes no answer, and asking
 * which corners are reflex in a union of overlapping rings is harder than it is worth.
 */
function waypoints(plane: Plane): Vec2[] {
	const out: Vec2[] = [];

	for (const ring of [...plane.walk, ...plane.block]) {
		for (let i = 0; i < ring.length; i++) {
			const v = ring[i];
			const a = ring[(i + ring.length - 1) % ring.length];
			const b = ring[(i + 1) % ring.length];
			const la = dist(a, v) || 1;
			const lb = dist(b, v) || 1;
			let bx = (a.x - v.x) / la + (b.x - v.x) / lb;
			let by = (a.y - v.y) / la + (b.y - v.y) / lb;
			const bl = Math.hypot(bx, by);

			if (bl < 1e-9) {
				// A straight corner. Either normal of the edge will do.
				bx = -(b.y - v.y) / lb;
				by = (b.x - v.x) / lb;
			} else {
				bx /= bl;
				by /= bl;
			}

			for (const sign of [1, -1]) {
				const p = {
					x: v.x + sign * bx * WALK_NUDGE,
					y: v.y + sign * by * WALK_NUDGE
				};

				if (inPlane(plane, p)) {
					out.push(p);
					break;
				}
			}
		}
	}

	return out;
}

/**
 * A* over the visibility graph, edges found lazily. Returns the path as node indices, or
 * undefined, plus every node it could reach — what the island fallback searches.
 */
function search(
	plane: Plane,
	nodes: Vec2[],
	start: number,
	goal: number
): {path?: number[]; reached: Set<number>} {
	const g = new Map<number, number>([[start, 0]]);
	const came = new Map<number, number>();
	const open = new Set<number>([start]);
	const closed = new Set<number>();
	const h = (i: number) => dist(nodes[i], nodes[goal]);

	while (open.size > 0) {
		let current = -1;
		let best = Infinity;

		for (const i of open) {
			const f = (g.get(i) ?? Infinity) + h(i);

			if (f < best) {
				best = f;
				current = i;
			}
		}

		if (current === goal) {
			const path = [goal];

			while (came.has(path[0])) {
				path.unshift(came.get(path[0])!);
			}

			closed.add(goal);
			return {path, reached: closed};
		}

		open.delete(current);
		closed.add(current);

		for (let next = 0; next < nodes.length; next++) {
			if (next === current || closed.has(next)) {
				continue;
			}

			const tentative = (g.get(current) ?? Infinity) + dist(nodes[current], nodes[next]);

			if (tentative >= (g.get(next) ?? Infinity)) {
				continue;
			}

			if (!visible(plane, nodes[current], nodes[next])) {
				continue;
			}

			came.set(next, current);
			g.set(next, tentative);
			open.add(next);
		}
	}

	return {reached: closed};
}

export interface WalkPath {
	/** Image fractions, start first. Straight segments; visibility paths are already taut. */
	points: Frac2[];
	/** Where the walk ends: the click, snapped onto the floor, or the nearest reachable. */
	goal: Frac2;
	/** False when the click was on another island and `goal` is the nearest reachable. */
	reached: boolean;
}

/**
 * The shortest way across the floor from `from` to `to`, both image fractions. Either end
 * off the floor is snapped onto it first. Undefined when there is no floor.
 *
 * Two islands are legal (a bridge comes later): a click on the other one walks to the
 * nearest point of this one it can reach, and says so with `reached: false`.
 */
export function findWalkPath(
	area: WalkArea | undefined,
	from: Frac2,
	to: Frac2,
	img?: ImageSize
): WalkPath | undefined {
	const plane = makePlane(area, img);

	if (plane.walk.length === 0) {
		return undefined;
	}

	const start = snapPlane(plane, toPlane(from, plane.ar));
	const target = snapPlane(plane, toPlane(to, plane.ar));

	if (!start || !target) {
		return undefined;
	}

	const out = (points: Vec2[], reached: boolean): WalkPath => ({
		goal: roundFrac(fromPlane(points[points.length - 1], plane.ar)),
		points: points.map(p => roundFrac(fromPlane(p, plane.ar))),
		reached
	});

	if (visible(plane, start, target)) {
		return out([start, target], true);
	}

	const corners = waypoints(plane);
	const nodes = [start, target, ...corners];
	const first = search(plane, nodes, 0, 1);

	if (first.path) {
		return out(
			first.path.map(i => nodes[i]),
			true
		);
	}

	// Another island. The nearest floor point to the click that some reached node can see.
	const reached = [...first.reached].map(i => nodes[i]);
	const candidates = [
		...reached,
		...edgeCandidates(plane, target)
	].sort((a, b) => dist(a, target) - dist(b, target));

	for (const candidate of candidates) {
		if (!reached.some(node => visible(plane, node, candidate))) {
			continue;
		}

		const retry = [start, candidate, ...corners];
		const found = search(plane, retry, 0, 1);

		if (found.path) {
			return out(
				found.path.map(i => retry[i]),
				false
			);
		}
	}

	return out([start], false);
}

/** Path length in PLANE units — image heights. */
export function walkPathLength(path: Frac2[], img?: ImageSize): number {
	const ar = imageAspect(img);
	let total = 0;

	for (let i = 1; i < path.length; i++) {
		total += dist(toPlane(path[i - 1], ar), toPlane(path[i], ar));
	}

	return total;
}

// ---------------------------------------------------------------------------
// Depth
// ---------------------------------------------------------------------------

/**
 * How big a character is at image-fraction height `y`, as a multiplier on its own `scale`.
 * Linear between the two lines, clamped past them. No depth = 1.
 */
export function depthScale(depth: WalkDepth | undefined, y: number): number {
	if (!depth) {
		return 1;
	}

	const {far, near} = depth;

	if (far.y === near.y) {
		return y < far.y ? far.scale : near.scale;
	}

	const t = Math.min(1, Math.max(0, (y - far.y) / (near.y - far.y)));

	return far.scale + (near.scale - far.scale) * t;
}

/**
 * Where the depth lines start when an author first opens them: far at the top of the
 * floor's bounding box ×0.5, near at its bottom ×1. Top and bottom of the picture when
 * there is no floor yet.
 */
export function defaultWalkDepth(area: WalkArea | undefined): WalkDepth {
	const ys = liveRings(area, 'walk').flatMap(ring => ring.map(p => p.y));
	const top = ys.length ? Math.min(...ys) : 0.5;
	const bottom = ys.length ? Math.max(...ys) : 1;

	return {
		far: {scale: 0.5, y: round3(top)},
		near: {scale: 1, y: round3(bottom > top ? bottom : Math.min(1, top + 0.1))}
	};
}

// ---------------------------------------------------------------------------
// Image <-> stage
// ---------------------------------------------------------------------------

/** The backdrop's cover rect in a stage `aspect` wide and 1 high. */
function coverRect(img: ImageSize, aspect: number) {
	const w = img.w > 0 ? img.w : 1;
	const h = img.h > 0 ? img.h : 1;
	const s = Math.max(aspect / w, 1 / h);
	const dw = w * s;
	const dh = h * s;

	return {dh, dw, ox: (aspect - dw) / 2, oy: (1 - dh) / 2};
}

/**
 * Image fraction → scene coordinates, through the backdrop's `object-fit: cover` rect. A
 * 16:9 backdrop maps 1:1; any other shape is cropped, and a point in the cropped band
 * lands off stage.
 */
export function imageToStage(
	p: Frac2,
	img: ImageSize,
	aspect = WALK_STAGE_ASPECT
): Vec2 {
	const {dh, dw, ox, oy} = coverRect(img, aspect);
	const X = ox + p.x * dw;
	const Y = oy + p.y * dh;

	return {x: X / (aspect / 2) - 1, y: 1 - 2 * Y};
}

/** Scene coordinates → image fraction. Inverse of `imageToStage`. */
export function stageToImage(
	v: Vec2,
	img: ImageSize,
	aspect = WALK_STAGE_ASPECT
): Frac2 {
	const {dh, dw, ox, oy} = coverRect(img, aspect);
	const X = ((v.x + 1) * aspect) / 2;
	const Y = (1 - v.y) / 2;

	return {x: (X - ox) / dw, y: (Y - oy) / dh};
}

// ---------------------------------------------------------------------------
// Crop
// ---------------------------------------------------------------------------

/**
 * A ring clipped to the unit square (Sutherland–Hodgman). What is left of a walk shape
 * after a crop took part of it away. Fewer than 3 points means none of it is left.
 */
export function clipRingToUnit(ring: Frac2[]): Frac2[] {
	const inside = [
		(p: Frac2) => p.x >= 0,
		(p: Frac2) => p.x <= 1,
		(p: Frac2) => p.y >= 0,
		(p: Frac2) => p.y <= 1
	];
	const cut = [
		(a: Frac2, b: Frac2) => lerpAt(a, b, (0 - a.x) / (b.x - a.x)),
		(a: Frac2, b: Frac2) => lerpAt(a, b, (1 - a.x) / (b.x - a.x)),
		(a: Frac2, b: Frac2) => lerpAt(a, b, (0 - a.y) / (b.y - a.y)),
		(a: Frac2, b: Frac2) => lerpAt(a, b, (1 - a.y) / (b.y - a.y))
	];
	let out = ring;

	for (let side = 0; side < 4 && out.length > 0; side++) {
		const input = out;

		out = [];

		for (let i = 0; i < input.length; i++) {
			const current = input[i];
			const previous = input[(i + input.length - 1) % input.length];
			const cin = inside[side](current);
			const pin = inside[side](previous);

			if (cin) {
				if (!pin) {
					out.push(cut[side](previous, current));
				}

				out.push(current);
			} else if (pin) {
				out.push(cut[side](previous, current));
			}
		}
	}

	return out.map(roundFrac);
}

function lerpAt(a: Frac2, b: Frac2, t: number): Frac2 {
	return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t};
}

/**
 * A walk area moved from one frame of the picture to another: every point and depth line
 * through `map`, rings clipped back into the picture, emptied shapes dropped. What the
 * asset editor does to it on the way into and out of a crop.
 */
export function remapWalkArea(
	area: WalkArea,
	map: (p: Frac2) => Frac2,
	clip = true
): WalkArea {
	const shapes = area.shapes
		.map(shape => {
			const moved = shape.points.map(map);

			return {...shape, points: clip ? clipRingToUnit(moved) : moved.map(roundFrac)};
		})
		.filter(shape => shape.points.length >= MIN_RING);
	const depth = area.depth && {
		far: {...area.depth.far, y: round3(map({x: 0, y: area.depth.far.y}).y)},
		near: {...area.depth.near, y: round3(map({x: 0, y: area.depth.near.y}).y)}
	};

	return depth ? {depth, shapes} : {shapes};
}

// ---------------------------------------------------------------------------
// Compile
// ---------------------------------------------------------------------------

export interface CompileWalkOptions {
	/** Image fractions, start first — a `WalkPath`'s points. */
	path: Frac2[];
	/** The backdrop, for the cover mapping and for isotropic distance. */
	img: ImageSize;
	aspect?: number;
	character: Pick<Character, 'poses' | 'faces' | 'walkSpeed'>;
	depth?: WalkDepth;
	/** The entity's own `scale`. Depth multiplies it, never replaces it. */
	scale?: number;
	/** Which way the sprite is mirrored before it moves, for a walk that starts straight up. */
	flip?: boolean;
}

export interface CompiledWalk {
	steps: SceneStep[];
	/** False when the character has no `walk` pose and glides in `idle` instead. */
	walkPose: boolean;
	/** Seconds from the first step to the last. */
	seconds: number;
}

/** The pose a walk stands in at the end: `idle`, or failing that the first pose. */
export function idlePoseName(character: Pick<Character, 'poses'>): string {
	const poses = character.poses ?? {};

	return IDLE_POSE in poses ? IDLE_POSE : Object.keys(poses)[0] ?? IDLE_POSE;
}

/**
 * The images a walk cycles, with their holds. A stepped `walk` pose is addressed image by
 * image (`walk#1`, `walk#2` …) because a scene step naming a stepped pose would only show
 * its first. A still or animated-file `walk` is one name repeated — the renderer keeps an
 * unchanged image, so an animated file plays on through the whole walk.
 */
function walkCycle(
	character: Pick<Character, 'poses'>
): {images: {name: string; dur: number}[]; walkPose: boolean} {
	const walk = character.poses?.[WALK_POSE];

	if (walk?.steps && walk.steps.length > 0) {
		return {
			images: walk.steps.map((step, index) => ({
				dur: positive(step.dur, DEFAULT_STEP_SECONDS),
				name: poseImageName(WALK_POSE, index)
			})),
			walkPose: true
		};
	}

	if (walk?.asset) {
		return {
			images: [{dur: DEFAULT_STEP_SECONDS, name: WALK_POSE}],
			walkPose: true
		};
	}

	return {
		images: [{dur: DEFAULT_STEP_SECONDS, name: idlePoseName(character)}],
		walkPose: false
	};
}

/**
 * A path as the step list the renderer already plays: one step per image hold, each
 * gliding `linear` to where the feet are at the end of it, scaled by depth, mirrored by
 * direction. A step also ends at every corner, so a walk never cuts through a block. The
 * last step is `idle`, at the goal. Play it with `poseLoop: once`.
 *
 * Speed is `walkSpeed` (scene x units per second, the same measure up and down the
 * screen) times the depth scale where the feet are: far away is slower on screen, as it
 * should be.
 */
export function compileWalk(options: CompileWalkOptions): CompiledWalk {
	const {character, depth, img, path} = options;
	const aspect = options.aspect ?? WALK_STAGE_ASPECT;
	const base = positive(options.scale, 1);
	const speed = positive(character.walkSpeed, DEFAULT_WALK_SPEED);
	const facesLeft = character.faces === 'left';
	const {images, walkPose} = walkCycle(character);
	const steps: SceneStep[] = [];
	let flip = !!options.flip;
	let seconds = 0;

	if (path.length === 0) {
		return {seconds, steps, walkPose};
	}

	const scene = (p: Frac2) => imageToStage(p, img, aspect);
	/** Scene distance, y rescaled so a unit is the same length both ways. */
	const span = (a: Frac2, b: Frac2) => {
		const sa = scene(a);
		const sb = scene(b);

		return Math.hypot(sb.x - sa.x, (sb.y - sa.y) / aspect);
	};
	const stepAt = (name: string, dur: number, p: Frac2, from: Frac2): SceneStep => {
		const at = scene(p);
		const dx = at.x - scene(from).x;

		if (Math.abs(dx) > 1e-5) {
			flip = dx < 0 !== facesLeft;
		}

		return {
			at: {x: round4(at.x), y: round4(at.y)},
			dur: round4(dur),
			ease: 'linear',
			flip,
			name,
			scale: round4(base * depthScale(depth, p.y))
		};
	};

	let pos = path[0];
	let seg = 0;
	let image = 0;
	let left = images[0].dur;

	while (seg < path.length - 1) {
		const target = path[seg + 1];
		const d = span(pos, target);
		const v = Math.max(0.01, speed * depthScale(depth, pos.y));
		const t = d / v;

		if (t <= left + 1e-9) {
			// The corner comes before this image's hold is up: end a step exactly there.
			if (t > 1e-6) {
				steps.push(stepAt(images[image % images.length].name, t, target, pos));
				seconds += t;
				left -= t;
			}

			pos = target;
			seg++;

			if (left <= 1e-6) {
				image++;
				left = images[image % images.length].dur;
			}
		} else {
			const next = lerpAt(pos, target, (left * v) / d);

			steps.push(stepAt(images[image % images.length].name, left, next, pos));
			seconds += left;
			pos = next;
			image++;
			left = images[image % images.length].dur;
		}
	}

	const goal = path[path.length - 1];

	steps.push(stepAt(idlePoseName(character), DEFAULT_STEP_SECONDS, goal, goal));

	return {seconds: round4(seconds), steps, walkPose};
}

// ---------------------------------------------------------------------------

function positive(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}

function roundFrac(p: Frac2): Frac2 {
	return {x: round3(p.x), y: round3(p.y)};
}
