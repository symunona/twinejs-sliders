import {extractSceneBlock} from '@sliders/scene-index';
import {splitVarsSection} from '@sliders/scene-schema';

/**
 * A passage's text with its vars section and its `[scene]` block cut out--what the
 * passage SAYS, as opposed to what it sets up and what it stages.
 *
 * Both halves are machinery: the vars section is the passage's front matter, the scene
 * block is the picture. An excerpt that quotes either one spends the card on text the
 * author already knows is there, and buries the one line that tells the cards apart.
 */
export function passageProse(text: string): string {
	return stripVars(stripScene(text)).trim();
}

function stripScene(text: string): string {
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
	].join('\n');
}

function stripVars(text: string): string {
	// The same split the player makes, so what the excerpt calls prose is what the reader
	// will be shown. A passage with no separator has no vars section, only a body.
	return splitVarsSection(text)?.body ?? text;
}
