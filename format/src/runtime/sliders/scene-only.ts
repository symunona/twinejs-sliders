/**
 * `sliders.sceneOnly`: in a passage that has a `[scene]` block, only scene blocks render.
 *
 * A scene fills the window, so prose written above or below it in the same passage would
 * be pushed off screen with no way to reach it. Dropping it is more honest than hiding it
 * under the stage. Turn the flag off and everything renders in source order.
 */

import {
	VARS_SEPARATOR,
	looksLikeVarsSection,
	nearMissSeparator
} from '@sliders/scene-schema';
import type {ContentBlock} from '../template/types';
import {SCENE_ONLY, flagOn} from './config';

export const SCENE_MODIFIER = /^scene$/i;

/**
 * Says so when the thing being dropped was meant to be a vars section.
 *
 * A vars section is split off before blocks exist, so a correct one never reaches here. One
 * whose separator is wrong — `---`, the Markdown rule an author reaches for — is not a vars
 * section at all, just a text block, and dropping it silently is how
 * `sliders.autoAdvance: 0` came to do nothing with no way to find out: no error, nothing on
 * screen, an empty warning list.
 *
 * Bare `console.warn`, not the module logger. That was once because `unmuted` carries only
 * `inserts` in a production build, so a logger warning reached nobody; `warn()` is no longer
 * muted (see `logger/logger.ts`), so either would work now. It stays bare because
 * `<warning-list>` spies on `console.warn` and this message is aimed squarely at it.
 */
function warnIfVarsSection(group: ContentBlock[]): void {
	const text = group
		.filter(block => block.type === 'text')
		.map(block => block.content)
		.join('\n');

	if (text.trim() === '') {
		return;
	}

	const nearMiss = nearMissSeparator(text);

	if (nearMiss) {
		console.warn(
			`This looks like a vars section closed with '${nearMiss.text.trim()}', which is ` +
				`not a separator — the line must be exactly '${VARS_SEPARATOR}'. The variables ` +
				'above it were not set, and the lines were dropped because the passage has a ' +
				'[scene] block.'
		);
		return;
	}

	if (looksLikeVarsSection(text)) {
		console.warn(
			`This looks like a vars section with no '${VARS_SEPARATOR}' line under it. The ` +
				'variables were not set, and the lines were dropped because the passage has a ' +
				'[scene] block.'
		);
	}
}

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

	if (scenes.length === 0 || !flagOn(SCENE_ONLY)) {
		return blocks;
	}

	for (const group of groups) {
		if (!scenes.includes(group)) {
			warnIfVarsSection(group);
		}
	}

	return scenes.flat();
}
