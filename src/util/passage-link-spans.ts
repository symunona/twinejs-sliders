/*
Where every link in a passage was written, and which passage it opens.

`passage-links.ts` next door answers "what does this passage point at" for the story map.
This answers "what is under the cursor", which needs offsets as well as targets, and needs
a bare `[[stay]]` already resolved through the scene's `links:` block -- the author
ctrl-clicking it means to go where the reader would go, not to a passage called `stay`.

Both scanners it composes are the same ones the map and the CLI use. A link the author can
see an arrow for is a link the author can follow.
*/

import {extractSceneBlock} from '@sliders/scene-index';
import {
	sceneEntityLinkSpans,
	sceneLinkTargetSpans
} from '@sliders/scene-schema';
import {isInternalLink, parseLinkSpans} from './parse-links';

export interface PassageLinkSpan {
	/** Offset just past the clickable text. */
	end: number;
	/** Offset of the clickable text within the passage. */
	start: number;
	/** The passage name this link opens, already resolved through `links:`. */
	target: string;
}

/**
 * Every clickable link in a passage, in the order written.
 *
 * External targets (`https://…`) are left out: this list exists to open passage editors,
 * and a URL has none.
 */
export function passageLinkSpans(text: string): PassageLinkSpan[] {
	const block = extractSceneBlock(text);
	const out: PassageLinkSpan[] = [];
	// Name -> target for this scene's choices. Built from the same spans scanned below so
	// the two cannot disagree about what `links:` says.
	const named = new Map<string, string>();

	if (block) {
		for (const span of sceneLinkTargetSpans(block.text)) {
			named.set(span.name, span.target);
		}
	}

	function push(start: number, end: number, target: string) {
		if (target !== '' && isInternalLink(target)) {
			out.push({end, start, target});
		}
	}

	// `[[…]]` is scanned over the whole passage, not just the scene block: Chapbook prose
	// above and below a `[scene]` carries links too.
	for (const span of parseLinkSpans(text)) {
		const name = span.target.trim();

		push(span.start, span.end, (span.bare && named.get(name)) || name);
	}

	if (!block) {
		return out;
	}

	for (const span of sceneLinkTargetSpans(block.text)) {
		push(block.offset + span.start, block.offset + span.end, span.target);
	}

	// `link:` on an entity may name a `links:` entry rather than a passage -- the clickable
	// door borrows the choice's target, and so does the click.
	for (const span of sceneEntityLinkSpans(block.text)) {
		push(
			block.offset + span.start,
			block.offset + span.end,
			named.get(span.value) ?? span.value
		);
	}

	return out;
}

/** The link the given offset falls inside, if any. */
export function passageLinkAt(
	text: string,
	offset: number
): PassageLinkSpan | undefined {
	return passageLinkSpans(text).find(
		span => offset >= span.start && offset < span.end
	);
}
