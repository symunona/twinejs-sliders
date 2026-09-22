import {showSceneLinks} from '../config';
import {get} from '../../state';

jest.mock('../../state', () => ({get: jest.fn(), set: jest.fn()}));

const mockGet = get as jest.MockedFunction<typeof get>;

/** Only `sliders.showLinks` matters here; everything else reads as unset. */
function storyFlag(value: unknown) {
	mockGet.mockImplementation(name =>
		name === 'sliders.showLinks' ? value : undefined
	);
}

/**
 * The three tiers, and which one gets to answer.
 *
 * Each tier is checked against a case where the tier BELOW it would have said the opposite,
 * because "wins" is the whole content of the rule — a test that agrees with every tier at
 * once proves nothing about precedence.
 */
describe('showSceneLinks', () => {
	describe('auto — the story said nothing and the scene said nothing', () => {
		beforeEach(() => storyFlag(undefined));

		it('draws the list when the beats offer no way out', () => {
			expect(showSceneLinks(false)).toBe(true);
		});

		it('leaves it out when the beats already offer one', () => {
			expect(showSceneLinks(true)).toBe(false);
		});

		it('reads `show: auto` as saying nothing', () => {
			expect(showSceneLinks(true, 'auto')).toBe(false);
			expect(showSceneLinks(false, 'auto')).toBe(true);
		});
	});

	describe('sliders.showLinks — the story overruling auto', () => {
		it('draws the list even though the beats offer a way out', () => {
			storyFlag(true);
			expect(showSceneLinks(true)).toBe(true);
		});

		it('leaves it out even though the beats offer none', () => {
			storyFlag(false);
			expect(showSceneLinks(false)).toBe(false);
		});

		it('is ignored when it is not a boolean', () => {
			storyFlag('yes');
			expect(showSceneLinks(true)).toBe(false);
		});
	});

	describe('linkList: {show:} — the scene overruling both', () => {
		it('`always` beats a story flag of false', () => {
			storyFlag(false);
			expect(showSceneLinks(false, 'always')).toBe(true);
		});

		it('`always` beats beats that already offer a way out', () => {
			storyFlag(undefined);
			expect(showSceneLinks(true, 'always')).toBe(true);
		});

		it('`never` beats a story flag of true', () => {
			storyFlag(true);
			expect(showSceneLinks(true, 'never')).toBe(false);
		});

		it('`never` beats beats that offer no way out at all', () => {
			storyFlag(undefined);
			expect(showSceneLinks(false, 'never')).toBe(false);
		});

		it('`auto` does NOT beat the story flag — it defers to it', () => {
			storyFlag(true);
			expect(showSceneLinks(true, 'auto')).toBe(true);
			storyFlag(false);
			expect(showSceneLinks(false, 'auto')).toBe(false);
		});
	});
});
