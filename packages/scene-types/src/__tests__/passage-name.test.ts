import {
	foldPassageName,
	isCaseOnlyMatch,
	matchPassageName
} from '../passage-name';

describe('foldPassageName()', () => {
	it('folds case and surrounding whitespace, nothing else', () => {
		expect(foldPassageName('  Start ')).toBe('start');
		expect(foldPassageName('The Tavern Fight')).toBe('the tavern fight');
		// Inner spacing and punctuation are part of the name.
		expect(foldPassageName('Tavern  Fight')).not.toBe('tavern fight');
	});
});

describe('matchPassageName()', () => {
	const names = ['Start', 'Tavern Fight', 'Cellar'];

	it('returns the name for an exact match', () => {
		expect(matchPassageName(names, 'Cellar')).toBe('Cellar');
	});

	it('matches a target that differs only in case', () => {
		expect(matchPassageName(names, 'start')).toBe('Start');
		expect(matchPassageName(names, 'TAVERN FIGHT')).toBe('Tavern Fight');
	});

	it('matches a target with surrounding whitespace', () => {
		expect(matchPassageName(names, ' cellar ')).toBe('Cellar');
	});

	it('returns undefined when nothing matches', () => {
		expect(matchPassageName(names, 'Streetz')).toBeUndefined();
		// Case is the only looseness: a near miss is still a miss.
		expect(matchPassageName(names, 'Tavern Fights')).toBeUndefined();
	});

	// An exact match anywhere in the list beats a case-only one earlier in it, or a story
	// holding both spellings would navigate to whichever came first in passage order.
	it('prefers an exact match over an earlier case-only one', () => {
		expect(matchPassageName(['Start', 'start'], 'start')).toBe('start');
		expect(matchPassageName(['start', 'Start'], 'Start')).toBe('Start');
	});

	it('resolves an ambiguous case-only match to the first in order', () => {
		expect(matchPassageName(['START', 'Start'], 'start')).toBe('START');
	});
});

describe('isCaseOnlyMatch()', () => {
	it('is true only when the two differ in case alone', () => {
		expect(isCaseOnlyMatch('Start', 'start')).toBe(true);
		expect(isCaseOnlyMatch('Start', 'Start')).toBe(false);
		expect(isCaseOnlyMatch('Start', 'Streetz')).toBe(false);
	});
});
