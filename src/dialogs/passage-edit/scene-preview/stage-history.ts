/**
 * Where an entity USED to stand, for the measuring overlay.
 *
 * With the grid on, the editor stops being a picture and becomes a ruler: every entity gets
 * an outline and an origin cross, and anything that has been moved since the scene opened
 * also gets ghost outlines of where it was. Three states are worth drawing, and only three:
 *
 *   ORIG  the arrival stage, `states[0]` — the `cast:` / `props:` block, before any beat.
 *   PREV  the stage the beat before this one left behind, `states[beat - 1]`.
 *   NOW   the stage on screen.
 *
 * Everything here is a total function of its arguments — no DOM, no React, no renderer.
 * The rect of a PAST position cannot be measured (nothing drew it), so it is DERIVED from
 * the rect the renderer reports for NOW: same sprite, same origin fraction, moved to where
 * the old `at` maps and multiplied by the old scale. Deriving it beats re-deriving the
 * sprite metrics from the manifest for the same reason `originFraction` inverts the rect
 * instead of reading the manifest — two sources for one number is how a ghost ends up a few
 * pixels off the thing it is a ghost of.
 */

import {PROP_DESIGN_HEIGHT, STAGE_ASPECT, sceneToBox} from '@sliders/render-dom';
import type {Rect, StageBox} from '@sliders/render-dom';
import type {
	Camera,
	EntityId,
	Stage,
	StageEntity,
	Vec2
} from '@sliders/scene-types';
import {roundCoord, sceneToMount} from './stage-geometry';

/**
 * The resolution scene coordinates are quoted in when they are quoted in pixels.
 *
 * Scene units are resolution independent on purpose, so "image coords" has to name a
 * resolution to mean anything. This is the one the renderer already assumes for a prop with
 * no manifest (`PROP_DESIGN_HEIGHT`), widened to the stage aspect — i.e. 1920x1080. Quoting
 * the on-screen box instead would make the numbers change when the dialog is resized, which
 * is the opposite of what a coordinate readout is for.
 */
export const DESIGN_HEIGHT = PROP_DESIGN_HEIGHT;
export const DESIGN_WIDTH = Math.round(PROP_DESIGN_HEIGHT * STAGE_ASPECT);

const DESIGN_BOX: StageBox = {
	height: DESIGN_HEIGHT,
	left: 0,
	top: 0,
	width: DESIGN_WIDTH
};

/** Which of the three states a drawn outline is. */
export type TraceKind = 'orig' | 'prev' | 'now';

export interface TracePoint {
	kind: TraceKind;
	/** Scene units, ABSOLUTE — `of:` already resolved, the same space the grid is in. */
	at: Vec2;
	scale: number;
	/** Degrees clockwise about the origin. 0 when the entity was never tilted. */
	rot: number;
	/** Scene position in design pixels, 1920x1080, y down. Integers. */
	pixel: Vec2;
	/** Where the outline goes, in MOUNT px. Derived for the past, measured for the present. */
	rect: Rect;
	/** The origin point (a character's feet) in MOUNT px. */
	origin: Vec2;
}

export interface EntityTrace {
	id: EntityId;
	now: TracePoint;
	/** Absent when the entity has not moved since it arrived, or was not on stage then. */
	orig?: TracePoint;
	/**
	 * Absent when there is no earlier beat, when nothing changed across it, or when it says
	 * the same thing as `orig` — two outlines on one rectangle is not two pieces of
	 * information, it is a heavier line.
	 */
	prev?: TracePoint;
}

/** Scene position in design pixels. `sceneToBox` against a 1920x1080 box IS the mapping. */
export function imagePoint(at: Vec2): Vec2 {
	const p = sceneToBox(DESIGN_BOX, at);

	return {x: Math.round(p.x), y: Math.round(p.y)};
}

/**
 * The origin as a fraction of the rect. Same inversion `stage-editor-overlay` does for the
 * resize pivot, kept here so a ghost and a handle can never disagree about where the feet
 * are.
 */
function originFraction(rect: Rect, origin: Vec2): Vec2 {
	if (!(rect.width > 0) || !(rect.height > 0)) {
		return {x: 0.5, y: 1};
	}

	return {
		x: (origin.x - rect.left) / rect.width,
		y: (origin.y - rect.top) / rect.height
	};
}

/**
 * Where the sprite WOULD be drawn if its origin sat at `origin` and it were `ratio` times
 * its current size. Scale is about the origin, so the origin fraction is what stays put.
 */
export function ghostRect(
	rect: Rect,
	fraction: Vec2,
	origin: Vec2,
	ratio: number
): Rect {
	const width = rect.width * ratio;
	const height = rect.height * ratio;

	return {
		height,
		left: origin.x - fraction.x * width,
		top: origin.y - fraction.y * height,
		width
	};
}

/** Two positions are the same position when they round to the same written coordinate. */
function samePlace(a: StageEntity, b: StageEntity): boolean {
	return (
		roundCoord(a.at.x) === roundCoord(b.at.x) &&
		roundCoord(a.at.y) === roundCoord(b.at.y) &&
		roundCoord(a.scale) === roundCoord(b.scale) &&
		(a.rot ?? 0) === (b.rot ?? 0)
	);
}

export interface TraceOptions {
	/** The stage on screen, `of:` RESOLVED. */
	stage: Stage;
	/** `states[0]`, resolved. Undefined while the parse has nothing to say. */
	orig?: Stage;
	/** `states[beat - 1]`, resolved. Undefined at beat 0 and 1 — there is no earlier beat. */
	prev?: Stage;
	/** What the renderer measured, MOUNT px. An entity with no rect gets no trace. */
	rects: Map<EntityId, Rect>;
	box?: StageBox;
	camera: Camera;
}

function pointFor(
	kind: TraceKind,
	entity: StageEntity,
	rect: Rect,
	fraction: Vec2,
	nowScale: number,
	box: StageBox,
	camera: Camera
): TracePoint {
	const origin = sceneToMount(box, camera, entity.at);
	const ratio = nowScale > 0 ? entity.scale / nowScale : 1;

	return {
		at: {...entity.at},
		kind,
		origin,
		pixel: imagePoint(entity.at),
		// The rect stays AXIS-ALIGNED here, at every state. A tilt is drawn by turning the
		// box about its origin in CSS, exactly as the sprite itself is turned, so the
		// geometry this derives never has to know about it.
		rect: kind === 'now' ? rect : ghostRect(rect, fraction, origin, ratio),
		rot: entity.rot ?? 0,
		scale: entity.scale
	};
}

/**
 * One trace per entity the renderer has measured, in the stage's own key order.
 *
 * An entity that was not on stage at a past state has no ghost for it rather than a ghost
 * at the origin: it did not move, it did not exist, and a box at (0, 0) would read as the
 * first of those.
 */
export function entityTraces(options: TraceOptions): EntityTrace[] {
	const {box, camera, orig, prev, rects, stage} = options;

	if (!box || !(box.width > 0) || !(box.height > 0)) {
		return [];
	}

	const traces: EntityTrace[] = [];

	for (const id of Object.keys(stage?.entities ?? {})) {
		const entity = stage.entities[id];
		const rect = rects.get(id);

		if (!entity || !rect) {
			continue;
		}

		const origin = sceneToMount(box, camera, entity.at);
		const fraction = originFraction(rect, origin);
		const now = pointFor('now', entity, rect, fraction, entity.scale, box, camera);
		const wasOrig = orig?.entities?.[id];
		const wasPrev = prev?.entities?.[id];
		const trace: EntityTrace = {id, now};

		if (wasOrig && !samePlace(wasOrig, entity)) {
			trace.orig = pointFor(
				'orig',
				wasOrig,
				rect,
				fraction,
				entity.scale,
				box,
				camera
			);
		}

		if (
			wasPrev &&
			!samePlace(wasPrev, entity) &&
			!(wasOrig && samePlace(wasPrev, wasOrig))
		) {
			trace.prev = pointFor(
				'prev',
				wasPrev,
				rect,
				fraction,
				entity.scale,
				box,
				camera
			);
		}

		traces.push(trace);
	}

	return traces;
}

/** Has this entity moved at all? What decides whether ghosts are drawn for it. */
export function hasGhosts(trace: EntityTrace): boolean {
	return !!trace.orig || !!trace.prev;
}
