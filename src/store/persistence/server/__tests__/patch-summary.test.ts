/**
 * The derived History sentence, against the REAL locale file.
 *
 * `setupTests.ts` mocks `util/i18n` for every suite, so `t()` normally answers with its own
 * key — the right call everywhere else and useless here, because the strings ARE the
 * deliverable. So this file replaces that mock with a translator that reads
 * `public/locales/en-US.json` and interpolates it. Two things follow: the assertions below
 * are the exact text a person sees in History, and a key missing from the shipped locale
 * file fails here rather than rendering as `store.patchSummary.something` in the dialog.
 *
 * `mock`-prefixed names because the factory below is hoisted above every import.
 */

import en from '../../../../../public/locales/en-US.json';
import {
	clampSummary,
	patchSummary,
	reasonSummary,
	SUMMARY_MAX_BYTES
} from '../patch-summary';
import {testPassage, testStory} from '../test-fixtures';
import type {Passage, Story} from '../../../stories';
import type {StoryPatch} from '../server.types';

jest.mock('../../../../util/i18n', () => ({i18n: {t: mockTranslate}}));

function mockLookup(key: string): unknown {
	return key
		.split('.')
		.reduce<unknown>(
			(node, part) => (node as Record<string, unknown> | undefined)?.[part],
			en as unknown
		);
}

/** i18next v19 rules, minus everything these keys do not use. */
function mockTranslate(
	key: string,
	options: Record<string, unknown> = {}
): string {
	const count = options.count as number | undefined;
	let template =
		count !== undefined && count !== 1 ? mockLookup(`${key}_plural`) : undefined;

	if (typeof template !== 'string') {
		template = mockLookup(key);
	}

	if (typeof template !== 'string') {
		throw new Error(`No such key in public/locales/en-US.json: ${key}`);
	}

	return template.replace(/{{(\w+)}}/g, (_, name: string) =>
		String(options[name] ?? '')
	);
}

function passage(overrides: Partial<Passage>): Passage {
	return testPassage('story-1', overrides);
}

function base(...passages: Passage[]): Story {
	return testStory({passages});
}

const tavern = passage({id: 'p1', name: 'Tavern Night', text: 'The fire is low.'});
const oldIntro = passage({id: 'p2', name: 'Old Intro', text: 'Once.'});
const cellar = passage({id: 'p3', name: 'Cellar', text: 'Damp.'});
const roof = passage({id: 'p4', name: 'Roof', text: 'Windy.'});

describe('patchSummary', () => {
	it('names the one passage whose text changed', () => {
		const patch: StoryPatch = {
			passages: {changed: [{...tavern, text: 'The fire is out.'}]}
		};

		expect(patchSummary(patch, base(tavern))).toBe('Tavern Night');
	});

	it('names the first of three and counts the rest', () => {
		const patch: StoryPatch = {
			passages: {
				changed: [
					{...tavern, text: 'one'},
					{...cellar, text: 'two'},
					{...roof, text: 'three'}
				]
			}
		};

		expect(patchSummary(patch, base(tavern, cellar, roof))).toBe(
			'Tavern Night +2 more'
		);
	});

	it('marks a created passage with a plus', () => {
		const street = passage({id: 'new', name: 'Street Dawn'});
		const patch: StoryPatch = {passages: {changed: [street]}};

		expect(patchSummary(patch, base(tavern))).toBe('+ Street Dawn');
	});

	it('marks a deleted passage with a minus sign, by the name the base held', () => {
		const patch: StoryPatch = {passages: {removed: ['p2']}};

		expect(patchSummary(patch, base(tavern, oldIntro))).toBe('− Old Intro');
		// U+2212 MINUS SIGN, not a hyphen. It is what the plan specifies and what the
		// History dialog will render beside the `+` of a creation.
		expect(patchSummary(patch, base(tavern, oldIntro)).charCodeAt(0)).toBe(0x2212);
	});

	it('spells a rename out when only the name moved', () => {
		const patch: StoryPatch = {
			passages: {changed: [{...tavern, name: 'Tavern Dusk'}]}
		};

		expect(patchSummary(patch, base(tavern))).toBe(
			'Tavern Night renamed → Tavern Dusk'
		);
	});

	it('counts passages that only moved', () => {
		const moved = [tavern, oldIntro, cellar, roof].map((p, index) => ({
			...p,
			left: 100 + index,
			top: 40
		}));
		const patch: StoryPatch = {passages: {changed: moved}};

		expect(patchSummary(patch, base(tavern, oldIntro, cellar, roof))).toBe(
			'moved 4 passages'
		);
	});

	it('says passage in the singular for one move', () => {
		const patch: StoryPatch = {passages: {changed: [{...tavern, left: 60}]}};

		expect(patchSummary(patch, base(tavern))).toBe('moved 1 passage');
	});

	it('falls back to story settings when no passage changed', () => {
		const patch: StoryPatch = {story: {name: 'Lamplight'}};

		expect(patchSummary(patch, base(tavern))).toBe('story settings');
	});

	it('says nothing at all about an empty patch', () => {
		expect(patchSummary({}, base(tavern))).toBe('');
		expect(patchSummary({passages: {changed: [], removed: []}}, base(tavern))).toBe(
			''
		);
		expect(patchSummary({story: {}}, base(tavern))).toBe('');
	});

	it('ignores a passage resent for a selection flag alone', () => {
		const patch: StoryPatch = {
			passages: {changed: [{...tavern, highlighted: true, selected: true}]}
		};

		expect(patchSummary(patch, base(tavern))).toBe('');
	});

	it('reads a rename that also moved the card as a rename', () => {
		const patch: StoryPatch = {
			passages: {changed: [{...tavern, left: 500, name: 'Tavern Dusk'}]}
		};

		expect(patchSummary(patch, base(tavern))).toBe(
			'Tavern Night renamed → Tavern Dusk'
		);
	});
});

describe('patchSummary precedence', () => {
	// deleted > created > renamed > edited > moved > story settings, and `+N more` counts
	// every other passage the patch touched whatever kind it was.
	const street = passage({id: 'new', name: 'Street Dawn'});

	it('puts a creation ahead of an edit', () => {
		const patch: StoryPatch = {
			passages: {changed: [{...tavern, text: 'edited'}, street]}
		};

		expect(patchSummary(patch, base(tavern))).toBe('+ Street Dawn +1 more');
	});

	it('puts a deletion ahead of a creation', () => {
		const patch: StoryPatch = {
			passages: {changed: [street], removed: ['p2']}
		};

		expect(patchSummary(patch, base(tavern, oldIntro))).toBe(
			'− Old Intro +1 more'
		);
	});

	it('puts a rename ahead of an edit', () => {
		const patch: StoryPatch = {
			passages: {
				changed: [
					{...cellar, text: 'edited'},
					{...tavern, name: 'Tavern Dusk'}
				]
			}
		};

		expect(patchSummary(patch, base(tavern, cellar))).toBe(
			'Tavern Night renamed → Tavern Dusk +1 more'
		);
	});

	it('puts an edit ahead of a move', () => {
		const patch: StoryPatch = {
			passages: {
				changed: [
					{...cellar, left: 900},
					{...tavern, text: 'edited'}
				]
			}
		};

		expect(patchSummary(patch, base(tavern, cellar))).toBe(
			'Tavern Night +1 more'
		);
	});

	it('puts any passage change ahead of story settings', () => {
		const patch: StoryPatch = {
			passages: {changed: [{...tavern, left: 900}]},
			story: {name: 'Lamplight'}
		};

		expect(patchSummary(patch, base(tavern))).toBe('moved 1 passage');
	});

	it('drops a removal the base never held rather than naming an id', () => {
		const patch: StoryPatch = {
			passages: {changed: [{...tavern, text: 'edited'}], removed: ['ghost']}
		};

		expect(patchSummary(patch, base(tavern))).toBe('Tavern Night');
	});
});

describe('clamping', () => {
	it('leaves a short summary exactly as it is', () => {
		expect(clampSummary('Tavern Night')).toBe('Tavern Night');
	});

	it('collapses control characters and runs of whitespace', () => {
		expect(clampSummary('Tavern\nNight\t\t Dusk ')).toBe('Tavern Night Dusk');
	});

	it('cuts a long summary to the byte budget and marks the cut', () => {
		const clamped = clampSummary('x'.repeat(400));

		expect(byteLength(clamped)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
		expect(clamped.endsWith('…')).toBe(true);
	});

	it('clamps what patchSummary returns, not just what it is handed', () => {
		const long = passage({id: 'p1', name: '☂'.repeat(300)});
		const patch: StoryPatch = {passages: {changed: [{...long, text: 'edited'}]}};
		const summary = patchSummary(patch, base(long));

		expect(byteLength(summary)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
	});

	it('never cuts a multi-byte character in half', () => {
		// Astral plane: two UTF-16 units, four UTF-8 bytes. A naive slice of either
		// makes a lone surrogate, which is not text.
		const clamped = clampSummary('𝄞'.repeat(200));

		expect(byteLength(clamped)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
		expect(clamped).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
		expect(clamped).not.toMatch(/(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/);
	});
});

describe('reasonSummary', () => {
	it('turns the wire tokens into words', () => {
		expect(reasonSummary('find-replace')).toBe('find & replace');
		expect(reasonSummary('import')).toBe('imported');
		expect(reasonSummary('restore')).toBe('restored');
	});

	it('keeps a voice tool name', () => {
		expect(reasonSummary('voice:patch_scene')).toBe('voice: patch_scene');
	});

	it('clamps a reason too', () => {
		expect(
			byteLength(reasonSummary(`voice:${'t'.repeat(400)}`))
		).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
	});
});

function byteLength(text: string): number {
	let bytes = 0;

	for (const char of text) {
		const code = char.codePointAt(0) as number;

		bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
	}

	return bytes;
}
