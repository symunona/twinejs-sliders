/**
 * The Sliders layer over Chapbook: a `[scene]` modifier, the element it renders to, and the
 * config variables that control both.
 *
 * Everything scene-shaped lives under this directory. Chapbook's own files reach in at
 * exactly four points — this init, the modifier list, the block filter in `render-parsed`,
 * and the stylesheet — so a Chapbook upgrade is a merge with four conflicts, not a rewrite.
 */

import {setDefaults} from '../state';
import {defineElements} from '../util/custom-element';
import {resetManifests} from './assets';
import {slidersDefaults} from './config';
import {initSceneIndex} from './scene-graph';
import {SlidersStage} from './stage-element';

export {sceneModifier} from './scene-modifier';
export {sceneOnlyBlocks} from './scene-only';

export function initSliders(): void {
	setDefaults(slidersDefaults);
	resetManifests();
	initSceneIndex();
	defineElements({'sliders-stage': SlidersStage});
}
