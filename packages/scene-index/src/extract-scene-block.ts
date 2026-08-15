/**
 * Pull the `[scene]` block out of a Chapbook passage (spec 02, "Passage shape").
 *
 * A Chapbook modifier is a line that is nothing but `[...]`. The scene block starts on the
 * line after `[scene]` and runs until the next modifier line or the end of the passage.
 */

/** `[note]`, `[if x]`, `[continued]` — but never a `[[link]]` sitting on its own line. */
const MODIFIER_RE = /^\[(?!\[)[^\]]*\]$/;
const SCENE_RE = /^\[scene\]$/i;

export interface SceneBlock {
	/** The block's text, with the `[scene]` line itself removed. */
	text: string;
	/**
	 * 0-based index of the block's first line within the passage. Add it to a parser's
	 * 1-indexed line to get the real passage line.
	 */
	lineOffset: number;
}

export function extractSceneBlock(passageText: string): SceneBlock | undefined {
	if (!passageText.includes('[scene]') && !/\[scene\]/i.test(passageText)) {
		return undefined;
	}

	const lines = passageText.split('\n');
	let start = -1;

	for (let i = 0; i < lines.length; i++) {
		if (SCENE_RE.test(lines[i].trim())) {
			start = i + 1;
			break;
		}
	}

	if (start === -1) {
		return undefined;
	}

	let end = lines.length;

	for (let i = start; i < lines.length; i++) {
		if (MODIFIER_RE.test(lines[i].trim())) {
			end = i;
			break;
		}
	}

	return {lineOffset: start, text: lines.slice(start, end).join('\n')};
}
