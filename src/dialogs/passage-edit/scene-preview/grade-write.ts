/**
 * What the grade popover writes, and where (spec 02, "Colour grade").
 *
 * Pure, like the rest of the writer's rules: WHICH keys a slider move puts on which line is
 * a rule, and a rule only checkable by dragging a slider in a browser is one nobody checks.
 *
 * `grade:` MERGES on a beat, so a beat line says only what differs from the stage before
 * it. The popover works in whole grades (what the author sees); this turns one into the
 * smallest line that produces it.
 */

import {
	GRADE_KEYS,
	gradeDelta,
	gradeLevel,
	gradeNeutral,
	normalizeGrade
} from '@sliders/scene-types';
import type {
	EntityGrade,
	Scene,
	Stage,
	StageEntity
} from '@sliders/scene-types';
import {planEntityWrite, type EntityKeyWrite} from './use-scene-writer';

/**
 * Slider bursts merge into one undo step, like a nudge burst — dragging warmth from 0 to
 * 40 is one decision, not forty. `+` so CodeMirror stops merging once the author pauses.
 */
export const GRADE_ORIGIN = '+sliders-grade';

export type GradeTarget = 'beat' | 'newBeat' | 'entry';

/** Where a grade write for this entity lands with the scrubber where it is. */
export function gradeTarget(
	scene: Scene | undefined,
	beat: number,
	entity: Pick<StageEntity, 'id' | 'kind'>
): GradeTarget {
	const plan = planEntityWrite(scene, beat, entity.kind, entity.id);

	if (plan.insertBeat) {
		return 'newBeat';
	}

	return plan.targets.some(target => target.beat !== undefined)
		? 'beat'
		: 'entry';
}

export interface GradeWriteInput {
	scene: Scene | undefined;
	/** The parsed state sequence: `states[n]` is the stage at scrubber `n`. */
	states: Stage[];
	/** Scrubber position. */
	beat: number;
	entity: Pick<StageEntity, 'id' | 'kind' | 'ref'>;
	/** The whole grade the author wants on screen. */
	next: EntityGrade | undefined;
}

/**
 * The one write that puts `next` on screen.
 *
 * - On a beat the entity owns: the keys that differ from the stage BEFORE that beat. A key
 *   the author took back to rest is written as its rest value, because a beat inherits
 *   what it leaves out.
 * - On somebody else's beat: a new beat, saying what differs from the stage shown now.
 * - At the top: the whole grade, keys at rest left out. In a `from:` scene the entry is a
 *   patch too, so a key going back to rest there is said out loud as well.
 *
 * `value: undefined` removes the key — the beat has nothing left to say, or the entry has
 * no grade left.
 */
export function gradeWrite(input: GradeWriteInput): EntityKeyWrite {
	const {beat, entity, next, scene, states} = input;
	const target = gradeTarget(scene, beat, entity);
	const at = (index: number) => states[index]?.entities?.[entity.id]?.grade;
	let value: EntityGrade | undefined;

	if (target === 'beat') {
		value = gradeDelta(at(beat - 1), next);
	} else if (target === 'newBeat') {
		value = gradeDelta(at(beat), next);
	} else {
		value = normalizeGrade(next);

		if (scene?.from) {
			const current = at(0);
			const reset: EntityGrade = {};

			for (const key of GRADE_KEYS) {
				if (
					gradeLevel(current, key) !== gradeNeutral(key) &&
					gradeLevel(next, key) === gradeNeutral(key)
				) {
					reset[key] = gradeNeutral(key);
				}
			}

			value = Object.keys(reset).length ? {...value, ...reset} : value;
		}
	}

	return {
		id: entity.id,
		key: 'grade',
		kind: entity.kind,
		ref: entity.ref,
		value
	};
}
