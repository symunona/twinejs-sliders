import {
	BUBBLE_FONTS,
	bubbleFont,
	bubbleFontHref,
	bubbleFontStack
} from '../bubble-fonts';

describe('BUBBLE_FONTS', () => {
	it('ships the eight comic faces the dropdown offers', () => {
		expect(BUBBLE_FONTS).toHaveLength(8);
	});

	it('has no duplicate ids — an id is what a story writes into font:', () => {
		const ids = BUBBLE_FONTS.map(font => font.id);

		expect(new Set(ids).size).toBe(ids.length);
	});

	/*
	 * The stack has to LEAD with the family the CDN is asked for. A stack that names the
	 * family second would fetch the webfont and then not use it, which is the failure
	 * nobody notices: the page looks right on a machine that owns the fallback.
	 */
	it('leads every stack with the family it fetches', () => {
		for (const font of BUBBLE_FONTS) {
			expect(font.stack.startsWith(`'${font.family}'`)).toBe(true);
		}
	});

	// A reader with no network, a blocked CDN or a file:// story still gets comic
	// lettering. That is the whole reason the catalogue carries stacks and not bare names.
	it('ends every stack in a generic fallback', () => {
		for (const font of BUBBLE_FONTS) {
			expect(font.stack.endsWith('cursive')).toBe(true);
		}
	});
});

describe('bubbleFont', () => {
	it('finds a catalogue face by its token', () => {
		expect(bubbleFont('bangers')?.family).toBe('Bangers');
		expect(bubbleFont(' bangers ')?.family).toBe('Bangers');
	});

	it('does not find a raw stack or nothing at all', () => {
		expect(bubbleFont('Georgia, serif')).toBeUndefined();
		expect(bubbleFont(undefined)).toBeUndefined();
	});
});

describe('bubbleFontStack', () => {
	it('expands a catalogue token', () => {
		expect(bubbleFontStack('bangers')).toBe(
			"'Bangers', 'Comic Sans MS', cursive"
		);
	});

	// `font:` took a raw CSS stack long before this catalogue existed, and every story
	// that wrote one has to keep working untouched.
	it('passes a hand-written stack straight through', () => {
		expect(bubbleFontStack('Georgia, serif')).toBe('Georgia, serif');
	});

	it('treats empty and absent as no font at all', () => {
		expect(bubbleFontStack('')).toBeUndefined();
		expect(bubbleFontStack('   ')).toBeUndefined();
		expect(bubbleFontStack(undefined)).toBeUndefined();
	});
});

describe('bubbleFontHref', () => {
	const href = bubbleFontHref();

	it('asks for every catalogue family in one request', () => {
		for (const font of BUBBLE_FONTS) {
			expect(href).toContain(font.family.replace(/ /g, '+'));
		}
	});

	// Without it a slow CDN shows invisible text rather than the fallback stack.
	it('swaps rather than hiding text while the fetch is in flight', () => {
		expect(href).toContain('display=swap');
	});

	it('asks for the extra weights a multi-weight face needs', () => {
		expect(href).toContain('Comic+Neue:wght@400;700');
	});
});
