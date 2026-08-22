/**
 * Deterministic fixtures for the sync tests. Mirrors `packages/asset-store/src/
 * test-fixtures.ts` — a helper next to the code, not inside `__tests__`, which jest reads
 * as a suite with no tests in it.
 */

import type {Passage, Story} from '../../stories';

/**
 * A story with no random parts. `fakeStory()` randomises `selected` and `lastUpdate`,
 * which are the two things these tests need to control by hand.
 */
export function testStory(overrides: Partial<Story> = {}): Story {
	const id = overrides.id ?? 'story-1';

	return {
		ifid: 'IFID-1',
		id,
		lastUpdate: new Date('2026-01-01T00:00:00.000Z'),
		name: 'Lighthouse',
		passages: [testPassage(id)],
		script: '',
		selected: false,
		snapToGrid: false,
		startPassage: 'p1',
		storyFormat: 'Sliders',
		storyFormatVersion: '1.0.0',
		stylesheet: '',
		sync: true,
		tagColors: {},
		tags: [],
		zoom: 1,
		...overrides
	};
}

export function testPassage(
	storyId: string,
	overrides: Partial<Passage> = {}
): Passage {
	return {
		height: 100,
		highlighted: false,
		id: 'p1',
		left: 0,
		name: 'Harbour',
		selected: false,
		story: storyId,
		tags: [],
		text: 'The lamp is lit.',
		top: 0,
		width: 100,
		...overrides
	};
}

/** Story with one passage whose text is `text`. */
export function storyWithText(id: string, text: string): Story {
	return testStory({id, passages: [testPassage(id, {text})]});
}

/** Fake timers plus a promise chain do not settle on their own. */
export async function settle(turns = 6): Promise<void> {
	for (let i = 0; i < turns; i++) {
		await Promise.resolve();
	}
}
