/**
 * Config variables the Sliders layer adds to Chapbook's own `config.*` set.
 *
 * All of them are plain state variables, so a story can change them in a vars section the
 * same way it changes `config.header.center`.
 */

import {get} from '../state';

/** Seconds to wait before advancing past a beat on its own. 0 disables it. */
export const AUTO_ADVANCE = 'sliders.autoAdvance';

/** Hide every non-scene block in a passage that has a `[scene]` block. */
export const SCENE_ONLY = 'sliders.sceneOnly';

/** Let a scene take over the whole window rather than sit in the page column. */
export const FULL_SCREEN = 'sliders.fullScreen';

/** Where the current stage is published for other code to read. */
export const STAGE_VAR = 'sliders.stage';

export const DEFAULT_AUTO_ADVANCE = 3;

export const slidersDefaults = {
	[AUTO_ADVANCE]: DEFAULT_AUTO_ADVANCE,
	[FULL_SCREEN]: true,
	[SCENE_ONLY]: true
};

/** Flags default to on, so only an explicit `false` turns one off. */
export function flagOn(name: string): boolean {
	return get(name) !== false;
}

export function fullScreenScenes(): boolean {
	return flagOn(FULL_SCREEN);
}

/** Milliseconds, because that is what `setTimeout` wants. 0 means "wait for a click". */
export function autoAdvanceMs(): number {
	const value = get(AUTO_ADVANCE);

	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? value * 1000
		: 0;
}
