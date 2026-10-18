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
import type {EntityId, Stage, StageEntity} from '@sliders/scene-types';
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

/**
 * Who `id` may hang off: every other sprite on the stage, minus its own descendants (that
 * would be a cycle, which the parser refuses) and minus `fit:` planes (no box to hang
 * from — `FIT_IGNORES`). `cast:` and `props:` share one id space, so a prop may follow a
 * character. Stage order, which is the order the YAML lists them in.
 */
export function parentChoices(authored: Stage, id: EntityId): EntityId[] {
	const entities = authored?.entities ?? {};
	const hangsOff = (child: EntityId) => {
		const seen = new Set<EntityId>();

		for (
			let at: EntityId | undefined = child;
			at !== undefined && !seen.has(at);
			at = entities[at]?.of
		) {
			if (at === id) {
				return true;
			}

			seen.add(at);
		}

		return false;
	};

	return Object.keys(entities).filter(
		other => entities[other].fit === undefined && !hangsOff(other)
	);
}

/**
 * `of:` set, changed or cleared, with the `at` that keeps the sprite where it stands.
 *
 * The offset is taken from the DRAWN stage (`resolveStage`): new `at` = where it is now
 * minus where the new parent is, or just where it is once it hangs off nothing. Both go in
 * one batch, so the `at` says outright which space it is in (`relative`) rather than
 * letting the writer read a parent out of text that does not have it yet — the difference
 * matters exactly when y lands on the baseline and the bare form would be read the other
 * way.
 *
 * Clearing is `of: ~` in a patch scene (`from:`), where an absent key would keep a parent
 * inherited from the other passage, and on a beat, which inherits the one before it.
 * Anywhere else it deletes the key.
 */
export function parentWrites(
	authored: StageEntity,
	drawn: Stage,
	parent: EntityId | undefined,
	patchScene: boolean
): EntityKeyWrite[] {
	const self = drawn?.entities?.[authored.id];
	const anchor = parent === undefined ? undefined : drawn?.entities?.[parent];

	if (
		!self ||
		parent === authored.id ||
		(parent ?? undefined) === (authored.of ?? undefined) ||
		(parent !== undefined && !anchor)
	) {
		return [];
	}

	const at = {
		x: roundCoord(self.at.x - (anchor?.at.x ?? 0)),
		y: roundCoord(self.at.y - (anchor?.at.y ?? 0))
	};

	return [
		parent === undefined
			? keyWrite(authored, 'of', patchScene ? null : undefined, null)
			: keyWrite(authored, 'of', parent),
		{...keyWrite(authored, 'at', at), relative: parent !== undefined}
	];
}
