/**
 * The comic typefaces a bubble may be set in, as a catalogue both halves can name.
 *
 * `font:` has always taken a raw CSS font stack, and it still does — `font: 'Georgia,
 * serif'` is a valid thing to write and nothing here rejects it. What this adds is a set of
 * SHORT TOKENS (`bangers`, `patrick-hand`) that expand to a real stack and, unlike a raw
 * stack, can be fetched: a reader who does not own Bangers gets Bangers, not the fallback.
 *
 * Why a closed catalogue rather than "type any Google font". Three consumers have to agree
 * on the same string — the editor's dropdown draws a preview in it, the preview renderer
 * paints a bubble in it, and the player has to LOAD it before the first line appears. A
 * free-text family name would work in the first two and silently fall back in the third,
 * which is the drift `format/README.md` exists to prevent. A token that is in this list is
 * a font every reader gets; a token that is not is a stack the reader may or may not own,
 * and the author can see which they wrote.
 *
 * The stacks all end in a generic comic-ish fallback, so the story still reads as a comic
 * on a reader with no network. That matters more than it looks: the webfont is fetched from
 * Google's CDN (see `bubbleFontHref`), which is the same channel Chapbook's own
 * `config.style.googleFont` uses, and a published story opened offline gets the fallback
 * rather than a blank bubble.
 */

/**
 * One typeface, as the three consumers need it.
 *
 * `family` is the exact Google Fonts family name — the thing the CDN is asked for and the
 * thing `stack` must lead with, or the fetched font would load and then not be used.
 */
export interface BubbleFont {
	/** The token an author writes in `font:`. Kebab-case, stable, never localised. */
	id: string;
	/** What the dropdown calls it. */
	label: string;
	/** Exact Google Fonts family name. */
	family: string;
	/** The full CSS `font-family` value this token expands to. */
	stack: string;
	/** Weights to fetch. Kept to what the presets actually use: normal and bold. */
	weights: number[];
}

/**
 * Eight comic faces, ordered loudest to quietest.
 *
 * Not alphabetical on purpose: an author opening this dropdown is choosing a VOICE, and the
 * useful neighbours are the ones that sound alike. Display faces for shouting first, then
 * the lettering faces a whole book can be set in, then the handwritten ones.
 */
export const BUBBLE_FONTS: readonly BubbleFont[] = [
	{
		id: 'bangers',
		label: 'Bangers',
		family: 'Bangers',
		stack: "'Bangers', 'Comic Sans MS', cursive",
		weights: [400]
	},
	{
		id: 'luckiest-guy',
		label: 'Luckiest Guy',
		family: 'Luckiest Guy',
		stack: "'Luckiest Guy', 'Comic Sans MS', cursive",
		weights: [400]
	},
	{
		id: 'bowlby-one',
		label: 'Bowlby One SC',
		family: 'Bowlby One SC',
		stack: "'Bowlby One SC', 'Comic Sans MS', cursive",
		weights: [400]
	},
	{
		id: 'comic-neue',
		label: 'Comic Neue',
		family: 'Comic Neue',
		stack: "'Comic Neue', 'Comic Sans MS', cursive",
		weights: [400, 700]
	},
	{
		id: 'patrick-hand',
		label: 'Patrick Hand',
		family: 'Patrick Hand',
		stack: "'Patrick Hand', 'Comic Sans MS', cursive",
		weights: [400]
	},
	{
		id: 'gloria-hallelujah',
		label: 'Gloria Hallelujah',
		family: 'Gloria Hallelujah',
		stack: "'Gloria Hallelujah', 'Comic Sans MS', cursive",
		weights: [400]
	},
	{
		id: 'shadows-into-light',
		label: 'Shadows Into Light',
		family: 'Shadows Into Light',
		stack: "'Shadows Into Light', 'Comic Sans MS', cursive",
		weights: [400]
	},
	{
		id: 'architects-daughter',
		label: "Architects Daughter",
		family: 'Architects Daughter',
		stack: "'Architects Daughter', 'Comic Sans MS', cursive",
		weights: [400]
	}
];

const BY_ID = new Map(BUBBLE_FONTS.map(font => [font.id, font]));

/** The catalogue entry a `font:` value names, or nothing when it is a raw stack. */
export function bubbleFont(value: string | undefined): BubbleFont | undefined {
	return value === undefined ? undefined : BY_ID.get(value.trim());
}

/**
 * What a `font:` value means as CSS.
 *
 * A catalogue token expands; anything else is passed through untouched, because it is
 * already a font stack the author wrote by hand and second-guessing it would break every
 * story written before this catalogue existed.
 */
export function bubbleFontStack(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	const trimmed = value.trim();

	if (trimmed === '') {
		return undefined;
	}

	return BY_ID.get(trimmed)?.stack ?? trimmed;
}

/**
 * The one stylesheet URL that fetches every catalogue face.
 *
 * All eight in ONE request rather than one request per font in use. The alternative —
 * fetching only what a scene names — sounds thriftier and is worse in the place it matters:
 * a beat that overrides the font would then fetch mid-scene and the bubble would repaint a
 * beat late, on the reader's screen. Eight families is one ~30KB stylesheet and the faces
 * themselves are only downloaded when something is actually set in them, because that is
 * how `@font-face` works.
 *
 * `display=swap` so a slow CDN shows the fallback stack instead of invisible text.
 */
export function bubbleFontHref(): string {
	const families = BUBBLE_FONTS.map(font => {
		const name = font.family.replace(/ /g, '+');

		return font.weights.length > 1
			? `family=${name}:wght@${font.weights.join(';')}`
			: `family=${name}`;
	});

	return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`;
}
