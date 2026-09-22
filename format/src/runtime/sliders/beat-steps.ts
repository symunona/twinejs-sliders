/**
 * Which beat a reader is standing on, and which one is behind them.
 *
 * Pure arithmetic over the beat list, kept out of `stage-element.ts` so it can be tested
 * without a renderer, a DOM or a scene: everything else about stepping backwards is
 * drawing, and drawing is the part that needs a browser.
 *
 * The unit is a STOP, not a beat. A `say` or a `box` is somewhere a reader stands; a
 * `set`, an `fx` or a `wait` is machinery that runs on the way past. One press of Left is
 * one line back — the thing the reader can see — rather than one internal step that may
 * change nothing on screen.
 */

import type {Beat} from '@sliders/scene-types';

/** `-1` means the scene's opening stage: before every beat, with nothing said yet. */
export const SCENE_START = -1;

/** The indices of the beats the scene stops on, in order. */
export function stopIndices(beats: Beat[]): number[] {
	const stops: number[] = [];

	for (let i = 0; i < beats.length; i++) {
		if (beats[i].kind === 'say' || beats[i].kind === 'box') {
			stops.push(i);
		}
	}

	return stops;
}

/**
 * The stop the reader is standing on, given the next beat to play.
 *
 * `beatIndex` is the player's own cursor — the beat that has NOT run yet — so the stop
 * being read is the last one strictly before it.
 */
export function currentStop(stops: number[], beatIndex: number): number {
	let out = SCENE_START;

	for (const index of stops) {
		if (index < beatIndex) {
			out = index;
		}
	}

	return out;
}

/** The stop before `from`, or `SCENE_START` when there is none. */
export function previousStop(stops: number[], from: number): number {
	let out = SCENE_START;

	for (const index of stops) {
		if (index < from) {
			out = index;
		}
	}

	return out;
}

/** The last stop in the scene, i.e. where a reader walking backwards into it lands. */
export function lastStop(stops: number[]): number {
	return stops.length > 0 ? stops[stops.length - 1] : SCENE_START;
}
