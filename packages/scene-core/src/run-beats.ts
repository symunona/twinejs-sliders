/**
 * `runBeats` — compile a scene's timeline into the state sequence the whole reuse story
 * depends on (spec 02):
 *
 *   S0 (enter) --beat1--> S1 --beat2--> … --beatN--> Sn (exit)
 *
 * `enter` and `exit` are derived here, never authored, so they cannot drift.
 */

import type {Beat, Stage} from '@sliders/scene-types';
import {cloneStage, mergePatch, upsertFx} from './stage';

/** Apply one beat to a stage in place. The stage must already be a private clone. */
function applyBeat(stage: Stage, beat: Beat): void {
	switch (beat.kind) {
		case 'say': {
			if (beat.patch) {
				const target = stage.entities[beat.who];

				// A patch aimed at somebody who is not on stage is ignored rather than
				// conjuring an entity: the format has no "enter" beat, so this is a typo.
				if (target) {
					stage.entities[beat.who] = mergePatch(target, beat.patch);
				}
			}

			break;
		}

		case 'set': {
			const target = stage.entities[beat.who];

			if (target) {
				stage.entities[beat.who] = mergePatch(target, beat.patch);
			}

			break;
		}

		case 'fx':
			stage.fx = upsertFx(stage.fx, beat.fx);
			break;

		case 'box':
		case 'wait':
		case 'mark':
			// Timeline-only. The stage is unchanged, but the state still gets its own slot
			// so `@mark` can name it and the scrubber can step onto it.
			break;
	}
}

/**
 * The full state sequence, length `beats.length + 1`. `states[0]` is the stage before any
 * beat has run; `states[i + 1]` is the stage after beat `i`.
 */
export function runBeats(stage: Stage, beats: Beat[]): Stage[] {
	const states: Stage[] = [cloneStage(stage)];
	let current = states[0];

	for (const beat of beats) {
		current = cloneStage(current);
		applyBeat(current, beat);
		states.push(current);
	}

	return states;
}

/** Mark name -> index into the sequence returned by `runBeats`. */
export function collectMarks(beats: Beat[]): Map<string, number> {
	const marks = new Map<string, number>();

	for (const beat of beats) {
		if (beat.kind === 'mark') {
			// The state a mark names is the one it sits on: a mark changes nothing, so the
			// state after it is identical to the state before it.
			marks.set(beat.name, beat.index + 1);
		}
	}

	return marks;
}
