import {
	noteNameUsed,
	orderByRecent,
	RECENT_LIMIT,
	RECENT_NAMES_KEY,
	recentNames,
	resetRecentNamesCache
} from '../sliders-recent-names';

describe('recently used scene names', () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetRecentNamesCache();
	});

	describe('noteNameUsed()', () => {
		it('remembers a name', () => {
			noteNameUsed('bg', 'tavern-night');
			expect(recentNames('bg')).toEqual(['tavern-night']);
		});

		it('puts the newest first', () => {
			noteNameUsed('bg', 'street');
			noteNameUsed('bg', 'tavern-night');
			expect(recentNames('bg')).toEqual(['tavern-night', 'street']);
		});

		it('moves a name already remembered instead of duplicating it', () => {
			noteNameUsed('bg', 'street');
			noteNameUsed('bg', 'tavern-night');
			noteNameUsed('bg', 'street');
			expect(recentNames('bg')).toEqual(['street', 'tavern-night']);
		});

		it('keeps slots apart', () => {
			noteNameUsed('bg', 'street');
			noteNameUsed('frame:mira', 'angry');
			expect(recentNames('bg')).toEqual(['street']);
			expect(recentNames('frame:mira')).toEqual(['angry']);
		});

		it('forgets past the limit', () => {
			for (let i = 0; i <= RECENT_LIMIT; i++) {
				noteNameUsed('bg', `bg-${i}`);
			}

			const names = recentNames('bg');

			expect(names).toHaveLength(RECENT_LIMIT);
			expect(names[0]).toBe(`bg-${RECENT_LIMIT}`);
			expect(names).not.toContain('bg-0');
		});

		it('ignores a blank name', () => {
			noteNameUsed('bg', '   ');
			expect(recentNames('bg')).toEqual([]);
		});

		it('survives a reload', () => {
			noteNameUsed('bg', 'tavern-night');
			resetRecentNamesCache();
			expect(recentNames('bg')).toEqual(['tavern-night']);
		});
	});

	describe('reading storage', () => {
		it('ignores a value it did not write', () => {
			window.localStorage.setItem(RECENT_NAMES_KEY, 'not json at all');
			resetRecentNamesCache();
			expect(recentNames('bg')).toEqual([]);
		});

		it('drops slots that are not lists of strings', () => {
			window.localStorage.setItem(
				RECENT_NAMES_KEY,
				JSON.stringify({bg: ['street', 7, null], cast: 'mira'})
			);
			resetRecentNamesCache();
			expect(recentNames('bg')).toEqual(['street']);
			expect(recentNames('cast')).toEqual([]);
		});
	});

	describe('orderByRecent()', () => {
		it('flags nothing when no name has been used', () => {
			expect(orderByRecent(['street', 'tavern'], 'bg')).toEqual([
				{name: 'street', recent: false},
				{name: 'tavern', recent: false}
			]);
		});

		it('lifts used names to the top, newest first', () => {
			noteNameUsed('bg', 'tavern');
			noteNameUsed('bg', 'street');

			expect(orderByRecent(['alley', 'street', 'tavern'], 'bg')).toEqual([
				{name: 'street', recent: true},
				{name: 'tavern', recent: true},
				{name: 'alley', recent: false}
			]);
		});

		it('leaves the rest in the order it was given', () => {
			noteNameUsed('bg', 'street');

			// The list builders group by asset kind; re-sorting here would throw
			// that grouping away.
			expect(
				orderByRecent(['zeta', 'alpha', 'street'], 'bg').map(one => one.name)
			).toEqual(['street', 'zeta', 'alpha']);
		});

		it('ignores remembered names that are no longer in the library', () => {
			noteNameUsed('bg', 'deleted-asset');

			expect(orderByRecent(['street'], 'bg')).toEqual([
				{name: 'street', recent: false}
			]);
		});
	});
});
