/**
 * The player's one sound deck: music that outlives a passage.
 *
 * Every `<sliders-stage>` builds its own `DomRenderer`, and a renderer lives exactly as long
 * as its passage — Chapbook swaps the whole body on every link. A deck OWNED by that
 * renderer was stopped with it, so music never carried: a chapter of scenes that all said
 * `music: rain` restarted the rain on every page. Here the deck lives at module scope and
 * every stage's renderer plays through it (`DomRendererOptions.deck`). The deck diffs each
 * new stage against what it is HOLDING, so the same key with the same id plays straight
 * through the page turn.
 *
 * Who decides when music ends? The claim. A stage claims the deck while it is connected; a
 * passage with no stage (prose, the end of the story) leaves it unclaimed, and an unclaimed
 * deck fades its music out — scene music does not leak under prose that never asked for it.
 * Released on a short grace rather than at once, because Chapbook's swap disconnects the
 * old stage and connects the new one in either order (`innerHTML` removes first; a view
 * transition may hold either side), and fading out between the two would be audible.
 *
 * Mute is the deck's own and starts on, exactly as an owned deck did: the first gesture
 * unmutes it through whichever stage is up (`SlidersStage.unlockSound`), and every later
 * stage finds it already unmuted — renderers never push a muted default into a shared deck.
 */

import {SoundDeck} from '@sliders/render-dom';

/**
 * How long a released deck waits for the next stage before fading out, in ms.
 *
 * Covers the gap between an old stage's disconnect and the new one's connect, which in
 * the same `innerHTML` is zero ticks and under a view transition is still one task. Short
 * enough that a prose passage after a scene hears the music go at once.
 */
export const RELEASE_GRACE_MS = 120;

let deck: SoundDeck | undefined;
const claims = new Set<object>();
let releaseTimer: number | undefined;

/** The deck, built on first use. One per page; it is never stopped, only silenced. */
export function playerDeck(): SoundDeck {
	if (!deck) {
		deck = new SoundDeck({doc: document});
		// On the window for e2e and debugging: the deck's <audio> elements are detached, so
		// `slidersPlayerDeck.held()` is the only way to ask what is audible across passages
		// (`data-music` says what ONE stage wants). Also the string the format's build guard
		// looks for (`sliders-markers.json`), so a bundle that lost the carry fails the build.
		(window as unknown as {slidersPlayerDeck?: SoundDeck}).slidersPlayerDeck =
			deck;
	}

	return deck;
}

/**
 * A stage is up and will drive the deck. Synchronous on purpose — call it before the first
 * `await` of a connect, so a release scheduled by the outgoing stage finds it.
 */
export function claimDeck(owner: object): SoundDeck {
	claims.add(owner);
	window.clearTimeout(releaseTimer);
	releaseTimer = undefined;
	return playerDeck();
}

/**
 * A stage went away. If nothing else claims the deck within the grace, the music fades out
 * (each track over its own `fade`). A claim arriving in time cancels it, and the new stage's
 * own `apply()` then decides what keeps playing.
 */
export function releaseDeck(owner: object): void {
	if (!claims.delete(owner) || claims.size > 0) {
		return;
	}

	window.clearTimeout(releaseTimer);
	releaseTimer = window.setTimeout(() => {
		releaseTimer = undefined;

		if (claims.size === 0) {
			void deck?.music(undefined);
		}
	}, RELEASE_GRACE_MS);
}

/** Tests only: forget the deck and every claim. */
export function resetPlayerDeck(): void {
	window.clearTimeout(releaseTimer);
	releaseTimer = undefined;
	claims.clear();
	deck?.stop();
	deck = undefined;
}
