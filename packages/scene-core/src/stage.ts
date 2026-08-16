/**
 * Stage helpers shared by the merger, the beat runner and the differ.
 *
 * Everything in here is pure: no Stage passed in is ever mutated, because the index keeps
 * every intermediate state alive and a shared sub-object would corrupt the history.
 */

import {LAYER_BASELINE} from '@sliders/scene-types';
import type {
	Camera,
	EntityPatch,
	Layer,
	Stage,
	StageEntity,
	StageFx,
	Vec2
} from '@sliders/scene-types';

/** Defaults applied whenever a patch declares an entity that did not exist before. */
export const ENTITY_DEFAULTS = {
	at: {x: 0, y: LAYER_BASELINE} as Vec2,
	flip: false,
	layer: 'mid' as Layer,
	opacity: 1,
	scale: 1
};

export const CAMERA_DEFAULT: Camera = {at: {x: 0, y: 0}, zoom: 1};

export function cloneVec(v: Vec2): Vec2 {
	return {x: v.x, y: v.y};
}

export function cloneCamera(camera: Camera): Camera {
	return {at: cloneVec(camera.at), zoom: camera.zoom};
}

export function cloneEntity(entity: StageEntity): StageEntity {
	return {...entity, at: cloneVec(entity.at)};
}

export function cloneFx(fx: StageFx[]): StageFx[] {
	return fx.map(f => ({...f}));
}

export function cloneStage(stage: Stage): Stage {
	const entities: Record<string, StageEntity> = {};

	for (const id of Object.keys(stage.entities)) {
		entities[id] = cloneEntity(stage.entities[id]);
	}

	return {
		bg: stage.bg,
		camera: cloneCamera(stage.camera),
		entities,
		fx: cloneFx(stage.fx)
	};
}

/**
 * z within a layer. An explicit `z:` always wins; otherwise it derives from y — y is UP, so
 * lower on screen means nearer the camera and therefore drawn later (spec 02, Layers).
 */
export function resolveZ(entity: StageEntity): number {
	return entity.z ?? -entity.at.y;
}

/** Copy only the keys a patch actually declared onto a (cloned) entity. */
export function mergePatch(
	target: StageEntity,
	patch: Omit<EntityPatch, 'kind' | 'ref'>
): StageEntity {
	const next = cloneEntity(target);

	if (patch.at !== undefined) {
		next.at = cloneVec(patch.at);
	}

	// The one key a patch can also clear: `of: ~` detaches a child that `from:` handed down.
	// Every other key here is set-or-inherit, so `undefined` has to keep meaning "untouched".
	if (patch.of !== undefined) {
		next.of = patch.of ?? undefined;
	}

	if (patch.frame !== undefined) {
		next.frame = patch.frame;
	}

	if (patch.flip !== undefined) {
		next.flip = patch.flip;
	}

	if (patch.layer !== undefined) {
		next.layer = patch.layer;
	}

	if (patch.z !== undefined) {
		next.z = patch.z;
	}

	if (patch.opacity !== undefined) {
		next.opacity = patch.opacity;
	}

	if (patch.scale !== undefined) {
		next.scale = patch.scale;
	}

	return next;
}

/** Turn a patch into a whole entity, filling every gap with a default. */
export function materialize(id: string, patch: EntityPatch): StageEntity {
	return {
		at: patch.at ? cloneVec(patch.at) : cloneVec(ENTITY_DEFAULTS.at),
		flip: patch.flip ?? ENTITY_DEFAULTS.flip,
		frame: patch.frame,
		id,
		kind: patch.kind,
		layer: patch.layer ?? ENTITY_DEFAULTS.layer,
		// No default: an entity with no `of` is in world space, and `of: ~` on a brand-new
		// entity says the same thing.
		of: patch.of ?? undefined,
		opacity: patch.opacity ?? ENTITY_DEFAULTS.opacity,
		ref: patch.ref,
		scale: patch.scale ?? ENTITY_DEFAULTS.scale,
		z: patch.z
	};
}

/** Insert or update an fx by id, without mutating the array passed in. */
export function upsertFx(list: StageFx[], fx: StageFx): StageFx[] {
	const index = list.findIndex(f => f.id === fx.id);

	if (index === -1) {
		return [...list, {...fx}];
	}

	const next = cloneFx(list);

	next[index] = {...fx};
	return next;
}
