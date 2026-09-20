/**
 * Config variables the Sliders layer adds to Chapbook's own `config.*` set.
 *
 * All of them are plain state variables, so a story can change them in a vars section the
 * same way it changes `config.header.center`.
 */

import {storyBubbleStyle as bubbleStyleFromVars} from '@sliders/scene-schema';
import type {BubbleStyle} from '@sliders/scene-types';
import {get} from '../state';

/** Seconds to wait before advancing past a beat on its own. 0 disables it. */
export const AUTO_ADVANCE = 'sliders.autoAdvance';

/** Hide every non-scene block in a passage that has a `[scene]` block. */
export const SCENE_ONLY = 'sliders.sceneOnly';

/** Let a scene take over the whole window rather than sit in the page column. */
export const FULL_SCREEN = 'sliders.fullScreen';

/**
 * Draw the scene's `links:` as a list under the stage.
 *
 * Three-valued, unlike the flags above, because the default is neither on nor off: absent
 * means "decide per scene" — see `showSceneLinks`. Set it to `true` for a story that wants
 * the list under every scene, `false` for one that never wants it.
 */
export const SHOW_LINKS = 'sliders.showLinks';

/** Where the current stage is published for other code to read. */
export const STAGE_VAR = 'sliders.stage';

/**
 * Silence a scene's `music:` and `sfx:`.
 *
 * A story sets it (`sliders.mute: true` in a vars section) for a chapter that should be
 * read in silence; the reader has the browser's own tab mute, which no story can override
 * and which is the control they already know.
 */
export const MUTE = 'sliders.mute';

/**
 * The story's own speech bubble defaults, or nothing when it stated none.
 *
 * Read fresh on every line rather than cached: they are ordinary state variables, so a
 * passage may change the look of the story halfway through it, and a cache would make that
 * work for the next chapter but not for the next line.
 */
export function storyBubbleDefaults(): BubbleStyle | undefined {
	return bubbleStyleFromVars(get) as BubbleStyle | undefined;
}

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

/**
 * Should this scene draw its `links:` under the stage?
 *
 * Unset (the default) is per scene: the list is drawn only when the beats offer the reader
 * nothing to click, because a scene that ends on `[[stay]] or [[go]]` would otherwise show
 * the same two choices twice, the second copy visible from the first beat on. A story that
 * disagrees says so with `sliders.showLinks`, which wins either way.
 */
export function showSceneLinks(beatsOfferLinks: boolean): boolean {
	const flag = get(SHOW_LINKS);

	return typeof flag === 'boolean' ? flag : !beatsOfferLinks;
}

/** Opt-IN to silence, unlike the flags above: absent means a scene may be heard. */
export function muted(): boolean {
	return get(MUTE) === true;
}

/** Milliseconds, because that is what `setTimeout` wants. 0 means "wait for a click". */
export function autoAdvanceMs(): number {
	const value = get(AUTO_ADVANCE);

	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? value * 1000
		: 0;
}
