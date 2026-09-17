/**
 * How long a beat holds the screen — the one schedule the editor plays and draws to.
 *
 * Its own module because both the play loop and the timeline strip need it, and the strip
 * must not import the preview that renders it.
 */

import type {Beat} from '@sliders/scene-types';

/**
 * How long a beat that did not time itself holds the screen while playing.
 *
 * Matches the player's own `sliders.autoAdvance` default, so pressing play in the editor
 * and reading the scene in the player run at the same pace.
 */
export const AUTO_ADVANCE_MS = 3000;

/**
 * How long the scrubber rests on the state a beat produced.
 *
 * `beat` is the beat that PRODUCED the state on screen — for scrubber position N that is
 * `beats[N - 1]`, and position 0 was produced by nothing and takes the default.
 *
 * This used to be a flat 3s for everything, which meant editor playback and the player
 * disagreed the moment a scene used `- wait:` — the one timing primitive the language had
 * before `dur:`.
 */
export function beatHoldMs(beat: Beat | undefined): number {
	if (beat?.dur !== undefined) {
		return beat.dur * 1000;
	}

	if (beat?.kind === 'wait') {
		return beat.seconds * 1000;
	}

	return AUTO_ADVANCE_MS;
}
