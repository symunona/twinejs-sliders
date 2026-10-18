/**
 * The stage the timing overlay's hover asks for: the scene at one moment, drawn still.
 *
 * Hover a beat's time = every entity where it is at that moment (`stageAt`). Hover one
 * entity's bar = the same, plus that entity's start and end of the beat as faded ghosts, so
 * the path it is on reads at a glance.
 */

import {beatTransitions, resolveStage, resolveZ, stageAt} from '@sliders/scene-core';
import type {TimelineBeat} from '@sliders/scene-core';
import type {BeatEase, Stage, StageEntity} from '@sliders/scene-types';

export interface TimingScrub {
	/** Beat index, 0-based: the beat that turns state `beat` into state `beat + 1`. */
	beat: number;
	/** Seconds into that beat. */
	t: number;
	/** Set on a bar hover: the entity whose start and end are ghosted. */
	entity?: string;
}

/** How visible a ghost is, times the entity's own opacity. */
export const GHOST_OPACITY = 0.35;

export const GHOST_PREFIX = '__timing-ghost-';

function ghost(entity: StageEntity, end: 'from' | 'to', z: number): StageEntity {
	// Scenery: a ghost is not a way out, cannot be grabbed and does not glow.
	const out: StageEntity = {
		...entity,
		id: `${GHOST_PREFIX}${end}-${entity.id}`,
		opacity: entity.opacity * GHOST_OPACITY,
		// Just under the solid one, whatever height it is drawn at.
		z: z - 0.001
	};

	delete out.link;
	delete out.highlight;
	delete out.locked;

	return out;
}

function samePicture(a: StageEntity, b: StageEntity): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * `states` = `runBeats` output (unresolved), `beats` = `sceneTimeline(…).beats`.
 * Undefined when the scrub names no beat.
 */
export function scrubStage(
	states: Stage[],
	beats: TimelineBeat[],
	scrub: TimingScrub,
	sceneEase?: BeatEase
): Stage | undefined {
	const beat = beats[scrub.beat];
	const rawBefore = states[scrub.beat];

	if (!beat || !rawBefore) {
		return undefined;
	}

	const rawAfter = states[scrub.beat + 1] ?? rawBefore;
	const before = resolveStage(rawBefore);
	const after = resolveStage(rawAfter);
	const now = stageAt(
		before,
		after,
		beatTransitions(rawBefore, rawAfter, beat.beat, sceneEase),
		scrub.t
	);
	const id = scrub.entity;

	if (id === undefined) {
		return now;
	}

	const start = before.entities[id];
	const end = after.entities[id];
	const solid = now.entities[id] ?? end ?? start;

	if (!solid || (start && end && samePicture(start, end))) {
		return now;
	}

	const z = resolveZ(solid);
	const entities = {...now.entities};

	if (start) {
		const one = ghost(start, 'from', z);

		entities[one.id] = one;
	}

	if (end) {
		const one = ghost(end, 'to', z);

		entities[one.id] = one;
	}

	return {...now, entities};
}
