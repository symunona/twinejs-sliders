/**
 * Pure coordinate math for the DOM renderer.
 *
 * Nothing here touches the DOM — every function is a total function of its arguments so it
 * can be unit tested without jsdom, and so a future 3D renderer can reuse the same rules.
 *
 * Two coordinate spaces are in play:
 *
 *   SCENE  origin at the CENTRE of the stage box, x: -1 = left edge .. +1 = right edge,
 *          y is UP. Normalized, resolution independent (spec 02).
 *   BOX    pixels relative to the top-left of the letterboxed stage box.
 *   MOUNT  pixels relative to the top-left of the mount element. `Renderer.measure` speaks
 *          this one.
 */

import type {Camera, Character, Frac2, Vec2} from '@sliders/scene-types';

/** The stage is a fixed-aspect box letterboxed inside the mount element. */
export const STAGE_ASPECT = 16 / 9;

/**
 * A character frame's full height maps to this fraction of the stage height at zoom 1.
 * Characters are normalized against each other by their manifest `size`, not by the pixel
 * size of whichever frame happens to be showing.
 */
export const CHARACTER_STAGE_HEIGHT = 0.9;

/**
 * Props have no manifest, so their pixel size is read as if authored against a stage of this
 * height. A 540px-tall prop asset is therefore half the stage tall, at any resolution.
 */
export const PROP_DESIGN_HEIGHT = 1080;

/** Feet, bottom centre (spec 02). */
export const DEFAULT_ORIGIN: Frac2 = {x: 0.5, y: 1};

/** Used when a character manifest is missing so bubbles still land somewhere sane. */
export const DEFAULT_ANCHORS: Readonly<Record<string, Frac2>> = {
	bubble: {x: 0.62, y: 0.18},
	mouth: {x: 0.5, y: 0.22},
	head: {x: 0.5, y: 0.1},
	origin: DEFAULT_ORIGIN,
	centre: {x: 0.5, y: 0.5},
	center: {x: 0.5, y: 0.5},
	top: {x: 0.5, y: 0},
	bottom: {x: 0.5, y: 1}
};

/** Frame size assumed for an unresolvable character. */
export const PLACEHOLDER_FRAME = {w: 512, h: 1024};

/** Frame size assumed for an unresolvable prop. */
export const PLACEHOLDER_PROP = {w: 256, h: 256};

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** The letterboxed stage box, in MOUNT pixels. */
export type StageBox = Rect;

export interface SpriteMetrics {
	width: number;
	height: number;
	origin: Frac2;
}

/**
 * Letterbox a fixed-aspect box inside `mountW` x `mountH`, centred. Degenerate mount sizes
 * (zero, negative, NaN) produce a zero box rather than NaN soup.
 */
export function computeStageBox(
	mountW: number,
	mountH: number,
	aspect = STAGE_ASPECT
): StageBox {
	const w = Number.isFinite(mountW) ? Math.max(0, mountW) : 0;
	const h = Number.isFinite(mountH) ? Math.max(0, mountH) : 0;

	if (w === 0 || h === 0) {
		return {left: 0, top: 0, width: 0, height: 0};
	}

	// Pillarbox when the mount is wider than the aspect, letterbox when it is taller.
	const width = Math.min(w, h * aspect);
	const height = width / aspect;

	return {
		left: (w - width) / 2,
		top: (h - height) / 2,
		width,
		height
	};
}

/** Scene coords -> BOX pixels. This is the one place the y flip lives. */
export function sceneToBox(box: StageBox, at: Vec2): Vec2 {
	return {
		x: box.width / 2 + at.x * (box.width / 2),
		y: box.height / 2 - at.y * (box.height / 2)
	};
}

/** BOX pixels -> scene coords. Inverse of {@link sceneToBox}. */
export function boxToScene(box: StageBox, p: Vec2): Vec2 {
	if (box.width === 0 || box.height === 0) {
		return {x: 0, y: 0};
	}

	return {
		x: (p.x - box.width / 2) / (box.width / 2),
		y: (box.height / 2 - p.y) / (box.height / 2)
	};
}

/** BOX pixels -> MOUNT pixels. */
export function boxToMount(box: StageBox, p: Vec2): Vec2 {
	return {x: box.left + p.x, y: box.top + p.y};
}

/**
 * Where a sprite's frame sits, in BOX pixels, such that its `origin` fraction lands exactly
 * on the scene position. For a character the origin is its feet, so `at: {x: 0, y: 0}` means
 * standing on the centre of the stage, not floating with its middle there.
 */
export function spriteRect(
	box: StageBox,
	at: Vec2,
	metrics: SpriteMetrics
): Rect {
	const p = sceneToBox(box, at);

	return {
		left: p.x - metrics.origin.x * metrics.width,
		top: p.y - metrics.origin.y * metrics.height,
		width: metrics.width,
		height: metrics.height
	};
}

/**
 * An anchor (a fraction of the sprite frame) resolved to a point inside the sprite's rect.
 *
 * `flip` mirrors the sprite about its origin — the same thing `scaleX(-1)` with the origin as
 * `transform-origin` does on screen — so the anchor has to be mirrored the same way or every
 * speech bubble on a flipped character points at the wrong shoulder.
 */
export function anchorPointInRect(
	rect: Rect,
	origin: Frac2,
	anchor: Frac2,
	flip: boolean
): Vec2 {
	const fx = flip ? 2 * origin.x - anchor.x : anchor.x;

	return {
		x: rect.left + fx * rect.width,
		y: rect.top + anchor.y * rect.height
	};
}

/**
 * Apply the camera to a BOX-space point. Mirrors exactly what the CSS transform on the layer
 * stack does, so `measure()` agrees with what the eye sees:
 *
 *   transform-origin: 50% 50%;  transform: scale(zoom) translate(-offX, -offY)
 */
export function applyCamera(box: StageBox, camera: Camera, p: Vec2): Vec2 {
	const offset = cameraOffsetPx(box, camera);
	const zoom = safeZoom(camera.zoom);
	const cx = box.width / 2;
	const cy = box.height / 2;

	return {
		x: cx + zoom * (p.x - cx - offset.x),
		y: cy + zoom * (p.y - cy - offset.y)
	};
}

/** The camera's `at` in BOX pixels. y flips, same as any scene coordinate. */
export function cameraOffsetPx(box: StageBox, camera: Camera): Vec2 {
	const at = camera?.at ?? {x: 0, y: 0};

	return {
		x: (at.x ?? 0) * (box.width / 2),
		y: -(at.y ?? 0) * (box.height / 2)
	};
}

export function safeZoom(zoom: number | undefined): number {
	return Number.isFinite(zoom) && (zoom as number) > 0 ? (zoom as number) : 1;
}

/**
 * The sort key that decides draw order within a layer.
 *
 * Explicit `z` wins. Otherwise it derives from y: lower on screen means nearer the viewer,
 * so it is drawn later. Derived keys land in 0..1 (y=+1 -> 0, y=-1 -> 1), which is also the
 * space explicit `z` is read in — `z: 2` is "in front of everything derived", `z: -1` behind.
 */
export function resolveZ(entity: {at: Vec2; z?: number}): number {
	if (typeof entity.z === 'number' && Number.isFinite(entity.z)) {
		return entity.z;
	}

	return (1 - (entity.at?.y ?? 0)) / 2;
}

/**
 * Draw order within one layer. Ties break on id so the same stage always produces the same
 * z-indexes — a stable order matters more than which entity wins the tie.
 */
export function sortByZ<T extends {id: string; at: Vec2; z?: number}>(
	entities: T[]
): T[] {
	return [...entities].sort((a, b) => {
		const d = resolveZ(a) - resolveZ(b);

		return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});
}

/** Sprite metrics for a cast member with a resolved manifest. */
export function characterMetrics(
	box: StageBox,
	character: Pick<Character, 'size' | 'origin'>
): SpriteMetrics {
	const h = character.size?.h > 0 ? character.size.h : PLACEHOLDER_FRAME.h;
	const w = character.size?.w > 0 ? character.size.w : PLACEHOLDER_FRAME.w;
	const height = box.height * CHARACTER_STAGE_HEIGHT;
	const scale = height / h;

	return {
		width: w * scale,
		height,
		origin: character.origin ?? DEFAULT_ORIGIN
	};
}

/** Sprite metrics for a prop, from its asset's pixel size. */
export function propMetrics(
	box: StageBox,
	size: {w: number; h: number},
	origin: Frac2 = DEFAULT_ORIGIN
): SpriteMetrics {
	const scale = box.height / PROP_DESIGN_HEIGHT;

	return {
		width: Math.max(1, size.w) * scale,
		height: Math.max(1, size.h) * scale,
		origin
	};
}
