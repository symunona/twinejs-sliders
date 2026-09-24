/**
 * Apply a scene's entity and beat `if:` conditions: what is left is the scene the reader
 * sees this time round.
 *
 * Here and not in the player, because the rule — "an entity gated out takes its beats with
 * it" — must read the same wherever a scene is played against state, and the player is
 * only the first such place. `holds` is the state; this file has none.
 *
 * Links are not gated here. The player already filters them against the same `holds`,
 * and moves them out of the scene into its own payload while it does.
 */

import type {Beat, Scene} from '@sliders/scene-types';

export function gateScene(scene: Scene, holds: (condition: string) => boolean): Scene {
	const gone = new Set<string>();
	const entities = {...scene.entities};

	for (const [id, condition] of Object.entries(scene.entityIfs ?? {})) {
		if (holds(condition)) {
			continue;
		}

		gone.add(id);

		// With `from:`, the entity may be inherited, and a gated entry that failed means
		// "not here" — so it must remove, not merely stop patching. Without `from:` the
		// scene is a snapshot, and leaving the entry out already says it.
		if (scene.from !== undefined) {
			entities[id] = null;
		} else {
			delete entities[id];
		}
	}

	const beats = scene.beats
		.filter(
			beat =>
				!(beat.if !== undefined && !holds(beat.if)) &&
				// A line said by a prop that is not on stage has nothing to hang off, and a
				// move of it moves nothing. Gating the entity gates its beats, so a
				// first-visit drone does not need the same `if:` written on every line.
				!('who' in beat && gone.has(beat.who))
		)
		// Renumbered: `index` is a position in THIS list, and `@mark` resolution reads it.
		.map((beat, index): Beat => (beat.index === index ? beat : {...beat, index}));

	const gated: Scene = {...scene, beats, entities};

	delete gated.entityIfs;
	return gated;
}
