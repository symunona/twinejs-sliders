/**
 * Walk areas (point-and-click/walk-area.md): where a character may stand on a backdrop,
 * and how big it is at each height.
 *
 * Its own file rather than more of `index.ts`, which every session edits. Re-exported from
 * there, so nothing imports this path directly.
 */

import type {Frac2} from './index';

/** `walk` is floor. `block` is a hole in it — a table, a pillar. */
export type WalkOp = 'walk' | 'block';

export const WALK_OPS: readonly WalkOp[] = ['walk', 'block'];

export interface WalkShape {
	id: string;
	op: WalkOp;
	/**
	 * Fractions of the BAKED image, three decimals. The ring closes itself.
	 *
	 * Baked, not source like `MaskShape`: mask points feed a bake, walk points are read by
	 * whoever draws the finished picture — the player — and it only ever has the bytes.
	 */
	points: Frac2[];
}

/**
 * Image-fraction y (0 top, 1 bottom) → character scale. Linear between the two lines,
 * clamped outside them.
 */
export interface WalkDepth {
	far: {y: number; scale: number};
	near: {y: number; scale: number};
}

/**
 * Where a character may walk on a backdrop. Walkable = union(`walk`) − union(`block`).
 *
 * On the bg ASSET's meta, not on a scene: same room, many scenes, one floor. Metadata, not
 * a sidecar, for the reason `effect` is: it is an instruction to whoever draws the asset,
 * so it has to ride sync, bundles and the player.
 */
export interface WalkArea {
	shapes: WalkShape[];
	/** Absent = scale 1 everywhere. */
	depth?: WalkDepth;
}

/**
 * `Character.walkSpeed` when absent: scene x units (half a stage width) per second at depth
 * scale 1. 0.6 crosses a 16:9 stage in about 3.3 s, a stroll.
 */
export const DEFAULT_WALK_SPEED = 0.6;

/**
 * One image of a pose, as a scene step can name it: `walk#3` is the third image of the
 * `walk` pose (1-based, like the files it came from). A still pose has one image, `#1`.
 *
 * Exists for compiled walks. A scene step naming a stepped pose shows its FIRST image for
 * the hold, so a walk cycle cannot be spelled with pose names alone.
 */
export const POSE_IMAGE_SEPARATOR = '#';

/** `walk`, 0 → `walk#1`. */
export function poseImageName(pose: string, index: number): string {
	return `${pose}${POSE_IMAGE_SEPARATOR}${index + 1}`;
}

/**
 * `walk#3` → `{pose: 'walk', index: 2}`. Undefined for a plain pose name, or a suffix that
 * is not a positive integer — `a#b` is then just a pose called `a#b`.
 */
export function splitPoseImage(
	name: string | undefined
): {pose: string; index: number} | undefined {
	if (!name) {
		return undefined;
	}

	const at = name.lastIndexOf(POSE_IMAGE_SEPARATOR);

	if (at <= 0) {
		return undefined;
	}

	const digits = name.slice(at + 1);

	if (!/^[1-9]\d*$/.test(digits)) {
		return undefined;
	}

	return {pose: name.slice(0, at), index: Number(digits) - 1};
}
