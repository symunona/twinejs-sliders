/**
 * How long a beat holds the screen — the one schedule the editor plays and draws to.
 *
 * Its own module because both the play loop and the timeline strip need it, and the strip
 * must not import the preview that renders it.
 */

import type {Beat, Scene} from '@sliders/scene-types';

/**
 * How long a beat that did not time itself holds the screen while playing.
 *
 * Matches the player's own `sliders.autoAdvance` default, so pressing play in the editor
 * and reading the scene in the player run at the same pace.
 */
export const AUTO_ADVANCE_MS = 3000;

/**
 * The scene's own answer for the beats that did not time themselves, in ms, or `undefined`
 * when the scene expresses no opinion.
 *
 * `0` is kept as `0`, because it is an answer: "wait for a click", the same thing the
 * reader's own zero means. Collapsing it here would destroy it before the one caller that
 * can act on it — full-screen playback, where tapping the stage IS the click — ever sees
 * it. Callers that need a LENGTH want `sceneHoldMs` instead.
 */
export function sceneAutoAdvanceMs(scene: Scene | undefined): number | undefined {
	const own = scene?.autoAdvance;

	return typeof own === 'number' && Number.isFinite(own)
		? Math.max(0, own) * 1000
		: undefined;
}

/**
 * The same thing as a length of time that can be drawn and scrubbed through.
 *
 * "Waits for a click" has no length, so it takes the standard beat: a timeline marker needs
 * a gap and the scrubber needs somewhere to land. Only the play timer, which can actually
 * decline to schedule, should be reading the raw answer.
 */
export function sceneHoldMs(scene: Scene | undefined): number {
	return sceneAutoAdvanceMs(scene) || AUTO_ADVANCE_MS;
}

/**
 * How long the scrubber rests on the state a beat produced.
 *
 * `beat` is the beat that PRODUCED the state on screen — for scrubber position N that is
 * `beats[N - 1]`, and position 0 was produced by nothing and takes the default.
 *
 * `defaultMs` is the scene's `autoAdvance:` resolved through `sceneAutoAdvanceMs`, and its
 * own default keeps the old arity working for callers and tests that have no scene to
 * hand. Precedence mirrors the player exactly: the beat's own `dur:`, then `- wait:`'s
 * seconds, then the scene, then the standard beat.
 *
 * This used to be a flat 3s for everything, which meant editor playback and the player
 * disagreed the moment a scene used `- wait:` — the one timing primitive the language had
 * before `dur:`.
 */
export function beatHoldMs(
	beat: Beat | undefined,
	defaultMs: number = AUTO_ADVANCE_MS
): number {
	if (beat?.dur !== undefined) {
		return beat.dur * 1000;
	}

	if (beat?.kind === 'wait') {
		return beat.seconds * 1000;
	}

	return defaultMs;
}
