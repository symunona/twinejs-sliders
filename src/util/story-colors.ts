/**
 * Every colour a story already uses, for the colour controls' quick list.
 *
 * A plain text scan, not a parse: the colours an author has picked live in scene YAML
 * (`bubble: {bg: …}`), in the start passage's `sliders.bubble.*` vars, in prose CSS and in
 * the story stylesheet, and no one parser reads all four. What they share is the spelling
 * of a CSS colour literal, so that is what is matched.
 *
 * Literal forms only — `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`,
 * `hsl()`/`hsla()`. Named colours are left out on purpose: `red` and `white` are English
 * words too, and a story's prose would flood the list with every one it mentions.
 */

/** Longest list the controls are handed. A quick list is not a palette manager. */
export const STORY_COLOR_LIMIT = 24;

/**
 * One colour literal.
 *
 * The hex arm refuses a preceding `&` or word character, so `&#123;` (an HTML entity)
 * and `foo#abc` are not colours, and a trailing word character, so `#abcdefg` is not
 * `#abcdef` with a `g` after it.
 */
const COLOR_LITERAL =
	/(?<![&\w])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])|\b(?:rgba?|hsla?)\([^()]*\)/gi;

/** Two spellings of the same colour count once: case and inner spacing do not matter. */
function colorKey(value: string): string {
	return value.toLowerCase().replace(/\s+/g, '');
}

export interface StoryColorSource {
	passages: {text: string}[];
	stylesheet?: string;
}

/**
 * The story's colours, most used first.
 *
 * Ties keep first-seen order, so the list does not reshuffle while the author types in a
 * passage that changes nothing about which colours win. Each colour is returned as it was
 * FIRST written, which is what the author will recognise.
 */
export function storyColors(
	{passages, stylesheet}: StoryColorSource,
	limit = STORY_COLOR_LIMIT
): string[] {
	const found = new Map<string, {count: number; value: string}>();

	function scan(text: string) {
		for (const match of text.matchAll(COLOR_LITERAL)) {
			const key = colorKey(match[0]);
			const entry = found.get(key);

			if (entry) {
				entry.count++;
			} else {
				found.set(key, {count: 1, value: match[0].trim()});
			}
		}
	}

	for (const passage of passages) {
		scan(passage.text);
	}

	if (stylesheet) {
		scan(stylesheet);
	}

	return Array.from(found.values())
		.map((entry, index) => ({...entry, index}))
		.sort((a, b) => b.count - a.count || a.index - b.index)
		.slice(0, limit)
		.map(({value}) => value);
}
