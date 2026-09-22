import {applyStoryStartVars} from '../story-start-vars';
import {get} from '../../state';
import {loadFromData} from '../../story';
import * as renderParsedModule from '../../template/render-parsed';

/**
 * A stand-in for Chapbook's state.
 *
 * `state/state.ts` imports `lodash-es`, which is ESM-only and sits in `node_modules`, which
 * `transformIgnorePatterns` does not transform — so the real module cannot be loaded under
 * jest at all. `config.test.ts` and `scene-modifier.test.ts` mock it for the same reason.
 * The store is flat, keyed by the dotted name, which is exactly how
 * `get('sliders.bubble.font')` is asked and answered here; the deep merge underneath is
 * Chapbook's and is not what this file is about.
 *
 * Plain functions, not `jest.fn()`: `resetMocks: true` in `jest.config.js` strips a mock's
 * implementation before every test (`.claude/TRAPS.md` § Tests).
 */
jest.mock('../../state', () => {
	const store: Record<string, unknown> = {};
	const names: string[] = [];

	return {
		get: (name: string) => store[name],
		set: (name: string, value: unknown) => {
			store[name] = value;
			names.push(name);
		},
		setDefault: () => {},
		setDefaults: () => {},
		setLookup: () => {},
		__names: names,
		__reset: () => {
			for (const key of Object.keys(store)) {
				delete store[key];
			}

			names.length = 0;
		}
	};
});

// `logger/index.ts` re-exports Chapbook's `init.ts`, which does not type-check on its own
// (`event.detail` off a plain `Event`). The bundler never type-checks it and the player is
// fine; ts-jest does, and would otherwise let a vendored bug decide whether this file can
// run. Nothing here reads a log line.
jest.mock('../../logger', () => ({
	createLoggers: () => ({log: () => {}, warn: () => {}})
}));

const {__names: setNames, __reset: resetState} = jest.requireMock(
	'../../state'
) as {__names: string[]; __reset: () => void};

interface PassageSpec {
	name: string;
	source: string;
}

/**
 * Build the `<tw-storydata>` a publish would have written and load it the way `init()`
 * does.
 *
 * `startnode` is 2 throughout: the publish launched the passage under test, not the
 * story's real start, which is the whole situation being covered.
 */
function story(
	passages: PassageSpec[],
	attributes: Record<string, string> = {}
): void {
	document.body.innerHTML = '';

	const el = document.createElement('tw-storydata');

	el.setAttribute('name', 'Test Story');
	el.setAttribute('ifid', 'C0FFEE00-0000-0000-0000-000000000000');
	el.setAttribute('startnode', '2');

	for (const [name, value] of Object.entries(attributes)) {
		el.setAttribute(name, value);
	}

	passages.forEach((passage, index) => {
		const passageEl = document.createElement('tw-passagedata');

		passageEl.setAttribute('pid', String(index + 1));
		passageEl.setAttribute('name', passage.name);
		passageEl.textContent = passage.source;
		el.append(passageEl);
	});

	document.body.append(el);
	loadFromData(el);
}

declare global {
	interface Window {
		storyStartBodyRan?: boolean;
	}
}

/**
 * Passage 1, the story's real start: the story-defaults dialog's vars, plus a body with a
 * side effect so that "the body did not run" is something a test can see.
 */
const startPassage = {
	name: 'Start',
	source: [
		"sliders.bubble.font: 'Comic Neue'",
		'sliders.autoAdvance: 5',
		'--',
		'[JavaScript]',
		'window.storyStartBodyRan = true;'
	].join('\n')
};

/** Passage 2, the one the author asked to test from. */
const testedPassage = {name: 'Chapter Four', source: 'Halfway in.'};

describe('applyStoryStartVars', () => {
	beforeEach(() => {
		delete window.storyStartBodyRan;
		resetState();
	});

	it('sets the real start passage vars when the publish named one', () => {
		story([startPassage, testedPassage], {'data-sliders-story-start': '1'});
		applyStoryStartVars();
		expect(get('sliders.bubble.font')).toBe('Comic Neue');
		expect(get('sliders.autoAdvance')).toBe(5);
	});

	// A normal play renders the start passage itself. Doing this as well would set a
	// passage's vars twice, once out of order.
	it('does nothing when the attribute is absent', () => {
		story([startPassage, testedPassage]);
		applyStoryStartVars();
		expect(setNames).toEqual([]);
	});

	it('does nothing when the pid is not a number', () => {
		story([startPassage, testedPassage], {
			'data-sliders-story-start': 'nonsense'
		});
		applyStoryStartVars();
		expect(setNames).toEqual([]);
	});

	it('does nothing when no passage has that pid', () => {
		story([startPassage, testedPassage], {'data-sliders-story-start': '99'});
		applyStoryStartVars();
		expect(setNames).toEqual([]);
	});

	it('does nothing when there is no story data at all', () => {
		story([startPassage, testedPassage], {'data-sliders-story-start': '1'});
		document.body.innerHTML = '';
		expect(() => applyStoryStartVars()).not.toThrow();
		expect(setNames).toEqual([]);
	});

	it('does nothing when the start passage has no vars section', () => {
		story([{name: 'Start', source: 'Just prose.'}, testedPassage], {
			'data-sliders-story-start': '1'
		});
		expect(() => applyStoryStartVars()).not.toThrow();
		expect(setNames).toEqual([]);
	});

	// The author asked to start in the middle of the story, not to play its opening scene
	// first. Asserted at the renderer's door rather than on the discarded markup: what the
	// body could actually DO is run its modifiers and inserts, and an empty block list is
	// what stops that.
	it('hands the renderer the vars and no blocks', () => {
		const renderParsed = jest.spyOn(renderParsedModule, 'renderParsed');

		story([startPassage, testedPassage], {'data-sliders-story-start': '1'});
		applyStoryStartVars();

		const [parsed, inserts, modifiers] = renderParsed.mock.calls[0];

		expect(parsed.blocks).toEqual([]);
		expect(parsed.vars).toHaveLength(2);
		expect(inserts).toEqual([]);
		expect(modifiers).toEqual([]);
		renderParsed.mockRestore();
	});

	// And the same thing seen from the story's side: the `[JavaScript]` block in
	// `startPassage` runs only if something rendered the body.
	it('does not render the start passage body', () => {
		story([startPassage, testedPassage], {'data-sliders-story-start': '1'});
		applyStoryStartVars();
		expect(window.storyStartBodyRan).toBeUndefined();
	});

	// `initStory()` has not run yet at this point, and nothing here may stand in for it: a
	// trail seeded with the start passage would play the story from the top.
	it('leaves the trail alone', () => {
		story([startPassage, testedPassage], {'data-sliders-story-start': '1'});
		applyStoryStartVars();
		expect(setNames).not.toContain('trail');
		expect(get('trail')).toBeUndefined();
	});
});
