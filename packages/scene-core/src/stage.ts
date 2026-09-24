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
	SceneStep,
	Stage,
	StageEntity,
	StageFx,
	Vec2
} from '@sliders/scene-types';

/** Defaults applied whenever a patch declares an entity that did not exist before. */
export const ENTITY_DEFAULTS = {
	at: {x: 0, y: LAYER_BASELINE} as Vec2,
	flip: false,
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

export function cloneSteps(steps: SceneStep[]): SceneStep[] {
	return steps.map(step => (step.at ? {...step, at: cloneVec(step.at)} : {...step}));
}

export function cloneEntity(entity: StageEntity): StageEntity {
	return {
		...entity,
		at: cloneVec(entity.at),
		...(entity.steps ? {steps: cloneSteps(entity.steps)} : {}),
		// Copied for the same reason `at` is: a stage sequence is many clones of one
		// declaration, and a shared object is a beat able to edit the beat before it.
		...(entity.link ? {link: {...entity.link}} : {})
	};
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
		...(stage.bgFx ? {bgFx: {...stage.bgFx}} : {}),
		camera: cloneCamera(stage.camera),
		entities,
		fx: cloneFx(stage.fx),
		...(stage.music ? {music: {...stage.music}} : {})
	};
}

/**
 * Draw order. An explicit `z:` always wins; otherwise it derives from y — y is UP, so
 * lower on screen means nearer the camera and therefore drawn later (spec 02). One space
 * for the whole stage: there is nothing to partition it.
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

	if (patch.pose !== undefined) {
		next.pose = patch.pose;
	}

	// `pose` and `steps` are two halves of ONE YAML key, so they move together: a patch
	// naming a single pose STOPS a step list an earlier beat started. Reading it off the
	// absence of `steps` is what keeps a `steps: null` out of every ordinary patch — and
	// the rule is the author's own, since `pose: idle` cannot be written in the same breath
	// as a list.
	if (patch.steps !== undefined) {
		next.steps = cloneSteps(patch.steps);
	} else if (patch.pose !== undefined) {
		next.steps = undefined;
	}

	if (patch.poseLoop !== undefined) {
		next.poseLoop = patch.poseLoop;
	}

	if (patch.flip !== undefined) {
		next.flip = patch.flip;
	}

	if (patch.z !== undefined) {
		next.z = patch.z;
	}

	// Set-or-inherit like everything around it: a beat that turns an entity into a plane
	// keeps it one, and there is deliberately no `fit: ~`. A plane going back to being a
	// sprite needs an `at:` to go back to, so it is a new declaration, not a cleared key.
	if (patch.fit !== undefined) {
		next.fit = patch.fit;
	}

	if (patch.opacity !== undefined) {
		next.opacity = patch.opacity;
	}

	if (patch.scale !== undefined) {
		next.scale = patch.scale;
	}

	if (patch.rot !== undefined) {
		next.rot = patch.rot;
	}

	// Clearable, like `of` and unlike everything above: a link is state that every later
	// beat inherits, so `link: ~` is the only way to say "this door stops being a way out".
	if (patch.link !== undefined) {
		next.link = patch.link ?? undefined;
	}

	if (patch.highlight !== undefined) {
		next.highlight = patch.highlight ?? undefined;
	}

	return next;
}

/** Turn a patch into a whole entity, filling every gap with a default. */
export function materialize(id: string, patch: EntityPatch): StageEntity {
	return {
		at: patch.at ? cloneVec(patch.at) : cloneVec(ENTITY_DEFAULTS.at),
		flip: patch.flip ?? ENTITY_DEFAULTS.flip,
		// No default: absent means "an ordinary sprite", which is what every renderer draws
		// when it sees no key.
		fit: patch.fit,
		id,
		kind: patch.kind,
		// No default: an entity with no `of` is in world space, and `of: ~` on a brand-new
		// entity says the same thing.
		of: patch.of ?? undefined,
		opacity: patch.opacity ?? ENTITY_DEFAULTS.opacity,
		// No default for either: absent means scenery, and `link: ~` on a brand-new entity
		// says the same thing.
		link: patch.link ?? undefined,
		highlight: patch.highlight ?? undefined,
		pose: patch.pose,
		poseLoop: patch.poseLoop,
		ref: patch.ref,
		// No default: absent is 0, and 0 is the identity — so an entity that was never
		// rotated carries no key rather than a number every renderer has to read.
		rot: patch.rot,
		scale: patch.scale ?? ENTITY_DEFAULTS.scale,
		steps: patch.steps && cloneSteps(patch.steps),
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
