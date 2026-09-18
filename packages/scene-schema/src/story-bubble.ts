/**
 * Story-wide speech bubble defaults, as variables.
 *
 * The widest of the four layers (`Scene.bubble` documents all of them): whatever every
 * line in the story looks like unless something narrower says otherwise. A story picks its
 * typeface and its bubble style once, here, and a scene or a beat departs from it.
 *
 * They are Chapbook VARIABLES — `sliders.bubble.font: 'Bangers, cursive'` in a vars
 * section — for the same reason `sliders.autoAdvance` is one: it is the channel the format
 * already has, the player reads it with no new plumbing, and the author can see and change
 * it in the passage rather than in a settings file they cannot diff. The editor writes them
 * from a dialog and reads them back by scanning vars sections, which is why the names live
 * in this leaf module: the format's runtime and the editor both import it, and a second
 * spelling of `sliders.bubble.font` anywhere would be a bug nobody could see.
 *
 * Deliberately NOT localStorage like `sliders.insertScene.autoAdvance`: that one is a
 * template seed for new scenes and never reaches the player. These ARE the player's
 * defaults, so they have to travel with the story.
 */

/** The prefix every story-level bubble variable shares. */
export const STORY_BUBBLE_PREFIX = 'sliders.bubble';

/**
 * The `BubbleStyle` keys a story may default, and the variable each one is spelled as.
 *
 * `at` and `place` are missing on purpose. A position is about one line in one shot — a
 * story-wide default that parked every bubble in the same corner would be unusable, and
 * the author who wants that writes it on the scene.
 */
export const STORY_BUBBLE_KEYS = [
	'as',
	'anchor',
	'sizing',
	'w',
	'h',
	'bg',
	'accent',
	'color',
	'font',
	'size'
] as const;

export type StoryBubbleKey = (typeof STORY_BUBBLE_KEYS)[number];

export function storyBubbleVar(key: StoryBubbleKey): string {
	return `${STORY_BUBBLE_PREFIX}.${key}`;
}

/** The keys that are numbers when they arrive, whatever a vars line happens to say. */
const NUMERIC: ReadonlySet<string> = new Set(['w', 'h', 'size']);

/**
 * Collect the story defaults out of anything that can answer "what is this variable?".
 *
 * A reader, not a parser: the player passes Chapbook's `get`, the editor passes a lookup
 * over the vars lines it scanned. Values that are the wrong shape are dropped rather than
 * coerced — a `size: "big"` is a typo, and guessing what it meant would paint one bubble
 * in a size the author never chose and never see it again.
 */
export function storyBubbleStyle(
	get: (name: string) => unknown
): Record<string, string | number> | undefined {
	const style: Record<string, string | number> = {};

	for (const key of STORY_BUBBLE_KEYS) {
		const value = get(storyBubbleVar(key));

		if (value === undefined || value === null || value === '') {
			continue;
		}

		if (NUMERIC.has(key)) {
			const n = typeof value === 'number' ? value : Number(value);

			if (Number.isFinite(n) && n > 0) {
				style[key] = n;
			}

			continue;
		}

		if (typeof value === 'string' && value.trim() !== '') {
			style[key] = value.trim();
		}
	}

	return Object.keys(style).length > 0 ? style : undefined;
}
