/*
Where a passage's scene names art, a character or a pose — in passage offsets.

`passage-link-spans.ts` next door does the same job for links. Both exist so the passage
editor can answer "what is under the cursor" without knowing anything about the scene
block's place in the passage: the scanners work on the block, this adds the offset back.
*/

import {extractSceneBlock} from '@sliders/scene-index';
import {SceneRefSpan, sceneRefSpans} from '@sliders/scene-schema';

export type PassageRefSpan = SceneRefSpan;

/** Every art/character/pose reference in the passage's scene block, in the order written. */
export function passageRefSpans(text: string): PassageRefSpan[] {
	const block = extractSceneBlock(text);

	if (!block) {
		return [];
	}

	return sceneRefSpans(block.text).map(span => ({
		...span,
		end: block.offset + span.end,
		start: block.offset + span.start
	}));
}

/** The reference the given offset falls inside, if any. */
export function passageRefAt(
	text: string,
	offset: number
): PassageRefSpan | undefined {
	return passageRefSpans(text).find(
		span => offset >= span.start && offset < span.end
	);
}
