/**
 * The story's speech bubble defaults, read out of and written into its vars sections.
 *
 * The player reads them with Chapbook's `get` and needs nothing else; the editor has no
 * state machine to ask, so it reads the passages the way a reader's Chapbook would — the
 * `name: value` lines above a `--` line. Same names either way
 * (`@sliders/scene-schema`'s `storyBubbleVar`), so the dialog, the preview and the player
 * cannot drift.
 *
 * Deliberately NOT in `@sliders/scene-schema`: scanning whole passages is exactly the job
 * `validate-vars.ts` explains does not belong to the one-block parser.
 */

import {
	STORY_BUBBLE_KEYS,
	VARS_LINE_RE,
	VARS_SEPARATOR,
	isVarsSeparator,
	looksLikeVarsLine,
	storyBubbleStyle,
	storyBubbleVar
} from '@sliders/scene-schema';
import {BubbleStyle} from '@sliders/scene-types';

export interface VarsPassage {
	name: string;
	text: string;
}

/**
 * Every variable the story sets in a vars section, last write winning.
 *
 * Passage ORDER is the only ordering there is here — the editor cannot know which passage
 * a reader reaches first — so a story that sets the same default twice gets whichever the
 * list happens to end with. The dialog only ever writes one passage, so that is a story
 * somebody hand-edited, and the preview being one of the two answers is better than it
 * showing neither.
 */
export function scanVars(passages: VarsPassage[]): Record<string, string> {
	const out: Record<string, string> = {};

	for (const passage of passages) {
		for (const line of varsLines(passage.text)) {
			const name = VARS_LINE_RE.exec(line)?.[1];

			if (!name) {
				continue;
			}

			out[name] = line.slice(line.indexOf(':', name.length) + 1).trim();
		}
	}

	return out;
}

/** The lines above the separator, or none when the passage has no vars section. */
function varsLines(text: string): string[] {
	const lines = text.split(/\r?\n/);
	const end = lines.findIndex(isVarsSeparator);

	if (end < 0) {
		return [];
	}

	return lines.slice(0, end).filter(looksLikeVarsLine);
}

/**
 * A vars value as the player would see it, near enough for a default.
 *
 * Chapbook values are expressions, and evaluating them is the player's job — but a bubble
 * default is a literal in every story that has one, so a quoted string, a number and a
 * boolean are all that is understood. Anything else comes back as the raw text, which is
 * what an unquoted `font: Bangers` is and what the author meant by it.
 */
export function varValue(raw: string | undefined): string | number | undefined {
	if (raw === undefined) {
		return undefined;
	}

	const text = raw.trim();

	if (text === '') {
		return undefined;
	}

	const quoted = /^(['"])(.*)\1$/.exec(text);

	if (quoted) {
		return quoted[2];
	}

	const number = Number(text);

	return Number.isFinite(number) ? number : text;
}

/** What every line in this story looks like before a scene, character or beat speaks up. */
export function storyBubbleDefaults(
	passages: VarsPassage[]
): BubbleStyle | undefined {
	const vars = scanVars(passages);

	return storyBubbleStyle(name => varValue(vars[name])) as
		| BubbleStyle
		| undefined;
}

/**
 * Rewrite one passage's vars section so it states exactly this style.
 *
 * Only the `sliders.bubble.*` lines are touched: every other variable keeps its place and
 * its spelling, because this passage is the author's and the dialog is a guest in it. A
 * key the style does not carry has its line REMOVED rather than written empty — an absent
 * variable is how "no default" is spelled, and `sliders.bubble.font: ''` would set the
 * font to nothing.
 */
export function writeStoryBubbleVars(
	text: string,
	style: BubbleStyle | undefined
): string {
	const managed = new Set(STORY_BUBBLE_KEYS.map(storyBubbleVar));
	const lines = text.split(/\r?\n/);
	const end = lines.findIndex(isVarsSeparator);
	const hasSection = end >= 0;
	const head = hasSection ? lines.slice(0, end) : [];
	const body = hasSection ? lines.slice(end + 1) : lines;
	const kept = head.filter(line => {
		const name = VARS_LINE_RE.exec(line)?.[1];

		return !name || !managed.has(name);
	});
	const written = STORY_BUBBLE_KEYS.flatMap(key => {
		const value = style?.[key as keyof BubbleStyle];

		if (value === undefined || value === '') {
			return [];
		}

		return [
			`${storyBubbleVar(key)}: ${
				typeof value === 'number' ? value : JSON.stringify(value)
			}`
		];
	});
	const vars = [...kept, ...written].filter(
		(line, index, all) => line.trim() !== '' || index < all.length - 1
	);

	if (vars.length === 0) {
		// Nothing left to declare: the separator goes too, or the passage opens with a bare
		// `--` that reads as a broken vars section.
		return body.join('\n').replace(/^\n+/, '');
	}

	return [...vars, VARS_SEPARATOR, ...body].join('\n');
}
