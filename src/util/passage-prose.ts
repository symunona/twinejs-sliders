import {extractSceneBlock} from '@sliders/scene-index';

/**
 * A passage's text with its `[scene]` block cut out--what the passage says, as opposed to
 * what it stages.
 *
 * Only for a card that draws the scene itself: the YAML is already on screen as a
 * picture there, and quoting it as an excerpt above the picture says the same thing twice
 * in the worse of the two languages. Everywhere else the excerpt stays the raw text.
 */
export function passageProse(text: string): string {
	const block = extractSceneBlock(text);

	if (!block) {
		return text;
	}

	const lines = text.split('\n');
	const blockLines = block.text === '' ? 0 : block.text.split('\n').length;

	// `lineOffset` is the first line INSIDE the block, so the `[scene]` line itself is the
	// one before it and goes too.
	return [
		...lines.slice(0, Math.max(0, block.lineOffset - 1)),
		...lines.slice(block.lineOffset + blockLines)
	]
		.join('\n')
		.trim();
}
