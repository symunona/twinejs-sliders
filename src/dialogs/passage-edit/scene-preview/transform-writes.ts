/**
 * The Transform tab's writes: `at`, `scale`, `rot` and `z`, typed as exact numbers.
 *
 * The same keys the stage's handles write (`stage-editor-overlay.tsx`), with the same
 * bargains — a default deletes the key on the entry and is said out loud on a beat — so a
 * number typed into the box and a drag that lands on the same value produce the same text.
 * Pure, like `scene-gestures.ts`, so the rules are checked by a test, not by a browser.
 *
 * Every builder reads the current value off the entity and returns `undefined` when there
 * is nothing to write: a box committed on blur with the value it already showed, or emptied
 * where there is no key to take away, must not add `scale: 1` to a beat line.
 */

import {resolveZ} from '@sliders/render-dom';
import type {StageEntity} from '@sliders/scene-types';
import {roundCoord} from './stage-geometry';
import type {EntityKeyWrite} from './use-scene-writer';

/** The parser's bounds (`parse-scene.ts`): a scale past these is warned about or refused. */
export const TRANSFORM_MIN_SCALE = 0.01;
export const TRANSFORM_MAX_SCALE = 10;
/** `rot` past a full turn draws as `rot % 360`, and the parser warns. */
export const TRANSFORM_MAX_ROT = 360;

function keyWrite(
	entity: StageEntity,
	key: string,
	value: unknown,
	reset?: unknown
): EntityKeyWrite {
	return {
		id: entity.id,
		key,
		kind: entity.kind,
		ref: entity.ref,
		...(reset === undefined ? {} : {reset}),
		value
	};
}

/**
 * One axis of `at`. `entity` is the AUTHORED one (`localStage`, before `resolveStage`):
 * an `of:` child's `at` is an offset from its parent, and that offset is what the YAML
 * holds and what the box shows. The writer formats it — bare when y sits on the baseline,
 * which is `LAYER_BASELINE` for a top-level sprite and 0 for a child (`formatAt`).
 *
 * An emptied box writes nothing: `at` has no default to fall back to that the author
 * could mean by "no number here".
 */
export function atAxisWrite(
	entity: StageEntity,
	axis: 'x' | 'y',
	value: number | undefined
): EntityKeyWrite | undefined {
	if (value === undefined || !Number.isFinite(value)) {
		return undefined;
	}

	const at = {x: roundCoord(entity.at.x), y: roundCoord(entity.at.y)};
	const next = roundCoord(value);

	if (at[axis] === next) {
		return undefined;
	}

	return keyWrite(entity, 'at', {...at, [axis]: next});
}

/** `scale:`. 1 or empty deletes the key on the entry and says `scale: 1` on a beat. */
export function scaleKeyWrite(
	entity: StageEntity,
	value: number | undefined
): EntityKeyWrite | undefined {
	const next = value === undefined ? 1 : roundCoord(value);

	if (
		next <= 0 ||
		next > TRANSFORM_MAX_SCALE ||
		next === roundCoord(entity.scale)
	) {
		return undefined;
	}

	return keyWrite(entity, 'scale', next === 1 ? undefined : next, 1);
}

/** `rot:`, degrees. 0 or empty deletes the key on the entry and says `rot: 0` on a beat. */
export function rotKeyWrite(
	entity: StageEntity,
	value: number | undefined
): EntityKeyWrite | undefined {
	const next = value === undefined ? 0 : roundCoord(value);

	if (
		Math.abs(next) > TRANSFORM_MAX_ROT ||
		next === roundCoord(entity.rot ?? 0)
	) {
		return undefined;
	}

	return keyWrite(entity, 'rot', next === 0 ? undefined : next, 0);
}

/**
 * What z the entity would have with no `z:` key: derived from its DRAWN y. `drawn` is the
 * resolved entity — an `of:` child is ordered by where it stands, not by its offset.
 */
export function derivedZ(drawn: StageEntity): number {
	return roundCoord(resolveZ({at: drawn.at}));
}

/**
 * `z:`. Empty deletes the key, handing the order back to y.
 *
 * On a beat "back to y" cannot be said — `z:` takes a number, not `~` — so the beat gets
 * the number y would give it right now. It stops following y from there on, which is the
 * nearest honest thing a beat line can say.
 */
export function zKeyWrite(
	drawn: StageEntity,
	value: number | undefined
): EntityKeyWrite | undefined {
	if (value === undefined) {
		return drawn.z === undefined
			? undefined
			: keyWrite(drawn, 'z', undefined, derivedZ(drawn));
	}

	const next = roundCoord(value);

	if (drawn.z !== undefined && roundCoord(drawn.z) === next) {
		return undefined;
	}

	return keyWrite(drawn, 'z', next);
}
