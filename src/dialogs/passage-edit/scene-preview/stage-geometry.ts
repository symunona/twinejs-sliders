/**
 * Pure geometry for the visual scene editor (spec 09, phases 2 and 3).
 *
 * `coords.ts` in `@sliders/render-dom` maps scene -> screen. The editor needs the other
 * direction — where did the pointer land, in scene units — plus snapping and handle math.
 * That lives here rather than in the renderer because the story format bundles
 * `packages/*`, and none of this ships to play mode. It lives here rather than inside the
 * overlay component because a React hook cannot be unit tested without jsdom, and this is
 * the part that has to be right.
 *
 * Everything is a total function of its arguments. No DOM, no React, no module state.
 *
 * The forward functions are IMPORTED, never reimplemented: if this module's idea of where a
 * sprite sits ever drifts from the renderer's, the handles drift off the sprite and no test
 * in either package notices. Invert `coords.ts`; do not copy its formulas.
 *
 * Three coordinate spaces, same names `coords.ts` uses:
 *
 *   SCENE  origin at the CENTRE of the stage box, x: -1 = left edge .. +1 = right edge,
 *          y is UP. This is what gets written back into the YAML.
 *   BOX    pixels relative to the top-left of the letterboxed stage box.
 *   MOUNT  pixels relative to the top-left of the mount element. Pointer events, sprite
 *          rects from `DomRenderer.rectOf`, and drawn handles all speak this one.
 */

import {
	applyCamera,
	boxToMount,
	boxToScene,
	cameraOffsetPx,
	safeZoom,
	sceneToBox
} from '@sliders/render-dom';
import type {Rect, StageBox} from '@sliders/render-dom';
import {LAYER_BASELINE} from '@sliders/scene-types';
import type {Camera, Frac2, Vec2} from '@sliders/scene-types';

/** Snap tolerance when the caller does not care, in MOUNT px. */
export const DEFAULT_SNAP_TOLERANCE_PX = 6;

/** Scale bounds. The schema warns above 10 and errors at or below 0. */
export const MIN_SCALE = 0.05;
export const MAX_SCALE = 10;

/** Scene x of the rule-of-thirds lines. */
export const THIRD = 1 / 3;

const ORIGIN: Vec2 = {x: 0, y: 0};

/** Distances closer than this count as equal, so tie-breaks are decided by kind, not noise. */
const EPSILON = 1e-9;

function finite(n: number | undefined, fallback = 0): number {
	return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

/** A degenerate box (collapsed preview, unmeasured mount) has no interior to speak of. */
function isDegenerate(box: StageBox | undefined): boolean {
	return (
		!box ||
		!Number.isFinite(box.width) ||
		!Number.isFinite(box.height) ||
		box.width <= 0 ||
		box.height <= 0
	);
}

/**
 * Round to 3 decimals and strip trailing zeros.
 *
 * Coordinates are written back as TEXT, so `at: -0.40000000000000002` is not a rounding
 * curiosity, it is what the author has to look at forever. `-0` comes back as `0` for the
 * same reason: `at: -0` renders as a bug report.
 */
export function roundCoord(n: number): number {
	if (!Number.isFinite(n)) {
		return 0;
	}

	// Dividing an integer by 1000 lands on the double whose shortest representation IS the
	// 3-decimal number, so `String()` never grows a tail of nines.
	const rounded = Math.round(n * 1000) / 1000;

	return rounded === 0 ? 0 : rounded;
}

/** MOUNT px -> BOX px. Inverse of `boxToMount`. */
function mountToBox(box: StageBox, p: Vec2): Vec2 {
	return {x: p.x - box.left, y: p.y - box.top};
}

/**
 * Undo `applyCamera`, which is `c + zoom * (p - c - offset)` about the box centre `c`.
 * Solving for `p`: `c + (q - c) / zoom + offset`. `safeZoom` guarantees a positive finite
 * divisor, so there is no zero to guard here.
 */
function unapplyCamera(box: StageBox, camera: Camera, p: Vec2): Vec2 {
	const offset = cameraOffsetPx(box, camera);
	const zoom = safeZoom(camera?.zoom);
	const cx = box.width / 2;
	const cy = box.height / 2;

	return {
		x: cx + (p.x - cx) / zoom + offset.x,
		y: cy + (p.y - cy) / zoom + offset.y
	};
}

/**
 * MOUNT px -> scene coords. Exact inverse of the renderer's
 * `boxToMount(applyCamera(sceneToBox(at)))` chain.
 */
export function mountToScene(box: StageBox, camera: Camera, p: Vec2): Vec2 {
	if (isDegenerate(box) || !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) {
		return {...ORIGIN};
	}

	return boxToScene(box, unapplyCamera(box, camera, mountToBox(box, p)));
}

/** Scene coords -> MOUNT px. The forward chain, straight out of the renderer. */
export function sceneToMount(box: StageBox, camera: Camera, at: Vec2): Vec2 {
	if (isDegenerate(box)) {
		return {...ORIGIN};
	}

	const safe = {x: finite(at?.x), y: finite(at?.y)};

	return boxToMount(box, applyCamera(box, camera, sceneToBox(box, safe)));
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

export interface HitTarget {
	id: string;
	/** MOUNT px, camera already applied — i.e. what the eye sees. */
	rect: Rect;
	zIndex: number;
}

/**
 * Topmost entity whose rect contains the point, or undefined.
 *
 * By rect and not by DOM event, because `.sliders-entity` is `pointer-events: none` and
 * because a rect test survives the camera transform without the renderer knowing the editor
 * exists. Transparent pixels inside the frame count as hits — accepted for v1 (spec 09).
 *
 * Ties on `zIndex` go to the LAST target in the list: same rule the painter's algorithm
 * uses, so whatever was drawn on top is what gets picked.
 */
export function hitTest(targets: HitTarget[], p: Vec2): string | undefined {
	if (!targets?.length || !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) {
		return undefined;
	}

	let best: HitTarget | undefined;

	for (const t of targets) {
		const r = t?.rect;

		// A zero-width rect is an unmeasured sprite, not an infinitely thin one.
		if (!r || !(r.width > 0) || !(r.height > 0)) {
			continue;
		}

		if (
			p.x < r.left ||
			p.x > r.left + r.width ||
			p.y < r.top ||
			p.y > r.top + r.height
		) {
			continue;
		}

		if (!best || finite(t.zIndex) >= finite(best.zIndex)) {
			best = t;
		}
	}

	return best?.id;
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

export interface SnapTarget {
	value: number;
	kind: 'centre' | 'baseline' | 'third' | 'entity';
}

/**
 * Which line wins when two sit the same distance away. Deterministic beats clever: the
 * author who lines a character up on the centre gets the centre, not whichever other
 * entity happens to be parked there too.
 */
const KIND_PRIORITY: Record<SnapTarget['kind'], number> = {
	centre: 0,
	baseline: 1,
	third: 2,
	entity: 3
};

/** Snap lines on the x axis, in scene units: the centre line, the thirds, other entities. */
export function snapTargetsX(otherEntityXs: number[] = []): SnapTarget[] {
	return [
		{value: 0, kind: 'centre'},
		{value: -THIRD, kind: 'third'},
		{value: THIRD, kind: 'third'},
		...otherEntityXs
			.filter(Number.isFinite)
			.map(value => ({value, kind: 'entity' as const}))
	];
}

/**
 * Snap lines on the y axis. There is no centre line here: y = 0 is the vertical middle of
 * the stage, which is mid-air. The floor is `LAYER_BASELINE`.
 */
export function snapTargetsY(otherEntityYs: number[] = []): SnapTarget[] {
	return [
		{value: LAYER_BASELINE, kind: 'baseline'},
		...otherEntityYs
			.filter(Number.isFinite)
			.map(value => ({value, kind: 'entity' as const}))
	];
}

/**
 * A pixel tolerance converted to scene units, per axis.
 *
 * One scene x unit covers `zoom * width / 2` MOUNT px, so at zoom 2 the same 6 px grab
 * radius is half as many scene units — snapping gets finer as the author zooms in, which is
 * exactly what zooming in is for. A degenerate box yields zero, i.e. no snapping at all,
 * rather than an infinite tolerance that would glue everything to the centre line.
 */
export function sceneTolerance(
	box: StageBox,
	camera: Camera,
	px = DEFAULT_SNAP_TOLERANCE_PX
): Vec2 {
	const p = Math.max(0, finite(px));

	if (isDegenerate(box) || p === 0) {
		return {...ORIGIN};
	}

	const zoom = safeZoom(camera?.zoom);

	return {x: (2 * p) / (zoom * box.width), y: (2 * p) / (zoom * box.height)};
}

/** The nearest target within `tolerance`, or undefined. */
export function nearestSnap(
	value: number,
	targets: SnapTarget[],
	tolerance: number
): SnapTarget | undefined {
	if (!Number.isFinite(value) || !targets?.length || !(tolerance > 0)) {
		return undefined;
	}

	let best: SnapTarget | undefined;
	let bestDistance = Infinity;

	for (const t of targets) {
		if (!t || !Number.isFinite(t.value)) {
			continue;
		}

		const d = Math.abs(t.value - value);

		if (d > tolerance) {
			continue;
		}

		if (d < bestDistance - EPSILON) {
			best = t;
			bestDistance = d;
		} else if (
			best &&
			Math.abs(d - bestDistance) <= EPSILON &&
			KIND_PRIORITY[t.kind] < KIND_PRIORITY[best.kind]
		) {
			best = t;
			bestDistance = Math.min(bestDistance, d);
		}
	}

	return best;
}

// ---------------------------------------------------------------------------
// Dragging
// ---------------------------------------------------------------------------

export interface DragOptions {
	/** Shift-drag. Constrains the RESULT to one axis; the other keeps its start value. */
	axisLock?: 'x' | 'y';
	/** False while alt is held. Defaults to true. */
	snap?: boolean;
	snapTargetsX?: SnapTarget[];
	snapTargetsY?: SnapTarget[];
	/** Snap tolerance in MOUNT px, converted to scene units internally. */
	tolerancePx?: number;
}

export interface DragResult {
	at: Vec2;
	snappedX?: SnapTarget;
	snappedY?: SnapTarget;
}

/**
 * Where an entity lands, given where its drag started and how far the pointer moved.
 *
 * The delta is taken in SCENE space (both pointers inverted, then subtracted) rather than by
 * scaling a pixel delta, so the camera is undone by the same code path `mountToScene` uses
 * and there is only ever one inverse to keep correct.
 *
 * The entity's own start position is carried through instead of being derived from the
 * pointer, so grabbing a character by the shoulder does not teleport its feet to the cursor.
 */
export function dragTo(
	startAt: Vec2,
	startPointer: Vec2,
	pointer: Vec2,
	box: StageBox,
	camera: Camera,
	options: DragOptions = {}
): DragResult {
	const from = {x: finite(startAt?.x), y: finite(startAt?.y)};
	const a = mountToScene(box, camera, startPointer);
	const b = mountToScene(box, camera, pointer);
	const at = {x: from.x + (b.x - a.x), y: from.y + (b.y - a.y)};
	const lock = options.axisLock;

	// Axis lock first: a locked component is pinned to where it started, and must not then be
	// snapped somewhere else — that would let shift-drag move the very axis it constrains.
	if (lock === 'x') {
		at.y = from.y;
	} else if (lock === 'y') {
		at.x = from.x;
	}

	const result: DragResult = {at};

	if (options.snap === false) {
		return result;
	}

	const tolerance = sceneTolerance(box, camera, options.tolerancePx);

	if (lock !== 'y') {
		const snapped = nearestSnap(
			at.x,
			options.snapTargetsX ?? snapTargetsX(),
			tolerance.x
		);

		if (snapped) {
			at.x = snapped.value;
			result.snappedX = snapped;
		}
	}

	if (lock !== 'x') {
		const snapped = nearestSnap(
			at.y,
			options.snapTargetsY ?? snapTargetsY(),
			tolerance.y
		);

		if (snapped) {
			at.y = snapped.value;
			result.snappedY = snapped;
		}
	}

	return result;
}

// ---------------------------------------------------------------------------
// Resize handles
// ---------------------------------------------------------------------------

export type HandleId = 'nw' | 'ne' | 'se' | 'sw';

const HANDLE_IDS: readonly HandleId[] = ['nw', 'ne', 'se', 'sw'];

export interface ScaleOptions {
	/** Alt-resize. Scale about the rect centre instead of the entity's origin. */
	aboutCentre?: boolean;
	min?: number;
	max?: number;
}

/** The four corner handle positions in MOUNT px, for drawing them. */
export function handlePoints(rect: Rect): Record<HandleId, Vec2> {
	const left = finite(rect?.left);
	const top = finite(rect?.top);
	const right = left + Math.max(0, finite(rect?.width));
	const bottom = top + Math.max(0, finite(rect?.height));

	return {
		nw: {x: left, y: top},
		ne: {x: right, y: top},
		se: {x: right, y: bottom},
		sw: {x: left, y: bottom}
	};
}

/**
 * The anchor a resize pivots around, in the rect's own space.
 *
 * Normally the entity's ORIGIN — a character's origin is its feet, so growing one must not
 * lift it off the floor; this is the same point `transform-origin` uses in the renderer, so
 * the preview and the handles agree. `aboutCentre` (alt) pivots on the rect centre instead.
 */
function scaleAnchor(rect: Rect, origin: Frac2, aboutCentre: boolean): Vec2 {
	const fx = aboutCentre ? 0.5 : finite(origin?.x, 0.5);
	const fy = aboutCentre ? 0.5 : finite(origin?.y, 1);

	return {
		x: finite(rect?.left) + fx * finite(rect?.width),
		y: finite(rect?.top) + fy * finite(rect?.height)
	};
}

/**
 * The new uniform scale for a resize drag on one corner handle.
 *
 * The factor is the pointer's distance from the anchor now over its distance at drag start —
 * PROJECTED onto the start direction rather than taken as a raw distance ratio. For a drag
 * that stays roughly radial (what pulling a corner outward actually is) the two agree, but
 * the projection stays monotone: dragging past the anchor and out the far side keeps
 * shrinking towards `min` instead of growing again, and a sideways wobble on a diagonal drag
 * does not inflate the sprite.
 *
 * `handle` does not enter the arithmetic — which corner was grabbed is already implied by
 * the pointer's offset from the anchor — but an unknown handle id means the caller lost
 * track of the gesture, so nothing is scaled.
 */
export function scaleFrom(
	handle: HandleId,
	startScale: number,
	rect: Rect,
	origin: Frac2,
	startPointer: Vec2,
	pointer: Vec2,
	options: ScaleOptions = {}
): number {
	const base = finite(startScale, 1);
	const min = Math.max(0, finite(options.min, MIN_SCALE));
	const max = Math.max(min, finite(options.max, MAX_SCALE));
	const clampedBase = Math.min(max, Math.max(min, base));

	if (
		!HANDLE_IDS.includes(handle) ||
		!rect ||
		!Number.isFinite(startPointer?.x) ||
		!Number.isFinite(startPointer?.y) ||
		!Number.isFinite(pointer?.x) ||
		!Number.isFinite(pointer?.y)
	) {
		return clampedBase;
	}

	const anchor = scaleAnchor(rect, origin, options.aboutCentre === true);
	const sx = startPointer.x - anchor.x;
	const sy = startPointer.y - anchor.y;
	const d0 = Math.hypot(sx, sy);

	// Grabbed exactly on the anchor: there is no direction to scale along, and every ratio
	// would be a division by zero.
	if (!(d0 > 0)) {
		return clampedBase;
	}

	const factor =
		((pointer.x - anchor.x) * sx + (pointer.y - anchor.y) * sy) / (d0 * d0);

	if (!Number.isFinite(factor)) {
		return clampedBase;
	}

	return Math.min(max, Math.max(min, base * factor));
}
