import {
	RELEASE_GRACE_MS,
	claimDeck,
	playerDeck,
	releaseDeck,
	resetPlayerDeck
} from '../player-deck';

/**
 * The claim decides when the player's music ends. These pin the two orders Chapbook's swap
 * can produce (old stage out first, or new stage in first) and the prose passage that
 * claims nothing.
 */
let silenced: jest.SpyInstance;

beforeEach(() => {
	jest.useFakeTimers();
	resetPlayerDeck();
	silenced = jest.spyOn(playerDeck(), 'music').mockResolvedValue(undefined);
});

afterEach(() => {
	jest.useRealTimers();
});

describe('player deck', () => {
	it('is one deck across stages', () => {
		expect(claimDeck({})).toBe(claimDeck({}));
	});

	it('fades out when nothing claims it after the grace (a prose passage)', () => {
		const stage = {};

		claimDeck(stage);
		releaseDeck(stage);
		jest.advanceTimersByTime(RELEASE_GRACE_MS - 1);
		expect(silenced).not.toHaveBeenCalled();

		jest.advanceTimersByTime(1);
		expect(silenced).toHaveBeenCalledWith(undefined);
	});

	it('keeps playing when the next stage claims after the old one released', () => {
		const old = {};

		claimDeck(old);
		releaseDeck(old);
		claimDeck({});
		jest.advanceTimersByTime(RELEASE_GRACE_MS * 2);

		expect(silenced).not.toHaveBeenCalled();
	});

	it('keeps playing when the next stage claims before the old one released', () => {
		const old = {};

		claimDeck(old);
		claimDeck({});
		releaseDeck(old);
		jest.advanceTimersByTime(RELEASE_GRACE_MS * 2);

		expect(silenced).not.toHaveBeenCalled();
	});

	it('ignores a release from a stage that never claimed', () => {
		claimDeck({});
		releaseDeck({});
		jest.advanceTimersByTime(RELEASE_GRACE_MS * 2);

		expect(silenced).not.toHaveBeenCalled();
	});
});
