/**
 * Walking back down the trail.
 *
 * The note a back-step leaves for the passage it lands in is the whole reason this module
 * exists, and the thing most likely to rot: it is module-scope state that nothing clears,
 * kept honest only by the passage name and the trail depth it was addressed to. These
 * tests are what says a stale note can never open a scene at its end by accident.
 */

const store: Record<string, unknown> = {};

jest.mock('../../state', () => ({
	get: (name: string) => store[name],
	set: (name: string, value: unknown) => {
		store[name] = value;
	}
}));

import {
	clearResume,
	currentPassage,
	resumeAtEnd,
	stepBackPassage
} from '../history';

function trail(...names: string[]) {
	store.trail = names;
}

beforeEach(() => {
	clearResume();
	trail('Start');
});

describe('stepBackPassage', () => {
	it('pops the last passage off the trail', () => {
		trail('Start', 'Hall', 'Cellar');

		expect(stepBackPassage()).toBe(true);
		expect(store.trail).toEqual(['Start', 'Hall']);
		expect(currentPassage()).toBe('Hall');
	});

	it('refuses at the first passage, leaving the key to the browser', () => {
		trail('Start');

		expect(stepBackPassage()).toBe(false);
		expect(store.trail).toEqual(['Start']);
	});

	it('refuses on a broken trail rather than throwing', () => {
		store.trail = 'not an array';

		expect(stepBackPassage()).toBe(false);
	});
});

describe('resumeAtEnd', () => {
	it('is set for the passage the reader stepped back into', () => {
		trail('Start', 'Hall', 'Cellar');
		stepBackPassage();

		expect(resumeAtEnd('Hall')).toBe(true);
	});

	it('is not set when nobody stepped back', () => {
		trail('Start', 'Hall');

		expect(resumeAtEnd('Hall')).toBe(false);
	});

	it('ignores a stage in some other passage', () => {
		trail('Start', 'Hall', 'Cellar');
		stepBackPassage();

		expect(resumeAtEnd('Cellar')).toBe(false);
		expect(resumeAtEnd(undefined)).toBe(false);
	});

	// The note is never cleared, so its only defence against opening a LATER scene at its
	// end is the depth it was written for. Walking forward again — even back into the same
	// passage — is a deeper trail, and misses.
	it('goes stale the moment the reader walks forward again', () => {
		trail('Start', 'Hall', 'Cellar');
		stepBackPassage();
		expect(resumeAtEnd('Hall')).toBe(true);

		trail('Start', 'Hall', 'Hall');
		expect(resumeAtEnd('Hall')).toBe(false);
	});
});
