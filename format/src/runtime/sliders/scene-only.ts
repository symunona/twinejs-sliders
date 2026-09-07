/**
 * `sliders.sceneOnly`: in a passage that has a `[scene]` block, only scene blocks render.
 *
 * A scene fills the window, so prose written above or below it in the same passage would
 * be pushed off screen with no way to reach it. Dropping it is more honest than hiding it
 * under the stage. Turn the flag off and everything renders in source order.
 */

import type {ContentBlock} from '../template/types';
import {SCENE_ONLY, flagOn} from './config';

export const SCENE_MODIFIER = /^scene$/i;

/**
 * Blocks arrive flat — modifier, modifier, text, modifier, text — so they are grouped back
 * into "the modifiers that apply, plus the text they apply to" before filtering, or a
 * `[scene]` line would survive while its own body was dropped.
 */
export function sceneOnlyBlocks(blocks: ContentBlock[]): ContentBlock[] {
	const groups: ContentBlock[][] = [];
	let current: ContentBlock[] = [];

	for (const block of blocks) {
		current.push(block);

		if (block.type === 'text') {
			groups.push(current);
			current = [];
		}
	}

	if (current.length > 0) {
		groups.push(current);
	}

	const scenes = groups.filter(group =>
		group.some(
			block => block.type === 'modifier' && SCENE_MODIFIER.test(block.content)
		)
	);

	return scenes.length > 0 && flagOn(SCENE_ONLY) ? scenes.flat() : blocks;
}
