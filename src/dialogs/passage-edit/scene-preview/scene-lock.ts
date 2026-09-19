/**
 * What is locked on the stage right now: the scene's word, then the author's preference.
 *
 * Two sources with different lifetimes. `sliders.preview.locked` and the camera tool
 * (`sliders.preview.camera`) are a PREFERENCE and follow the author from passage to
 * passage. `locked:` in the scene is a PROPERTY of that shot: it is framed, and nobody
 * opening the passage should pan it by accident.
 *
 * So the scene wins where it speaks, and only where it speaks. A scene with `locked: [bg]`
 * pins its camera for everyone while leaving the author's own stage-lock preference to
 * decide about sprites.
 *
 * Pure, and its own module, so the precedence is one testable function rather than two
 * ternaries buried in a 1400-line component.
 */

import type {Scene, SceneLock} from '@sliders/scene-types';

export interface StageLocks {
	/** No gesture may edit the scene: what `editable` is derived from. */
	locked: boolean;
	/** No pan, no wheel zoom. Entities stay draggable. */
	cameraLocked: boolean;
}

/** What the author's own toggles say, read straight off the bar buttons' state. */
export interface StoredLocks {
	locked: boolean;
	cameraLocked: boolean;
}

function pins(scene: Scene | undefined, target: SceneLock): boolean {
	const own = scene?.locked;

	if (own === true) {
		return true;
	}

	return Array.isArray(own) && own.includes(target);
}

/**
 * `locked: true` locks everything, so it implies the background too — a stage nobody may
 * edit is not a stage whose camera should still swing when you grab the floor.
 */
export function effectiveLocks(
	scene: Scene | undefined,
	stored: StoredLocks
): StageLocks {
	const whole = scene?.locked === true || pins(scene, 'entities');

	return {
		cameraLocked: whole || pins(scene, 'bg') || stored.cameraLocked,
		locked: whole || stored.locked
	};
}

/**
 * Why a lock cannot be toggled off from the bar, when it cannot.
 *
 * The bar buttons stay visible and keep showing the truth — pressed, because the stage IS
 * locked — but pressing them would write a preference the scene is overriding, so the
 * author would click and watch nothing happen. Saying which line is responsible is what
 * turns that into a rule instead of a broken button.
 */
export function lockReason(
	scene: Scene | undefined,
	target: SceneLock
): 'scene' | undefined {
	return scene?.locked === true || pins(scene, target) ? 'scene' : undefined;
}
