/**
 * "Open the character editor on THIS character, and on THIS pose."
 *
 * A module-level bus for the same reason `sliders-assets/focus-request.ts` is one: the
 * dialog reducer dedupes an `addDialog` by comparing `props` with `isEqual`, so a character
 * — let alone a pose — carried in the props would open a SECOND character editor every time
 * the author ctrl-clicked a different one. Dispatching with no props raises the editor that
 * is already open, and the target rides alongside on this channel.
 *
 * Held rather than only broadcast, because the click that opens the dialog publishes before
 * the dialog exists to hear it. Taken once and then gone: a request nobody consumed must not
 * make the next ordinary open jump to an old character.
 */

export interface CharacterFocusRequest {
	characterId: string;
	/** Absent when the author clicked the character rather than one of its poses. */
	pose?: string;
	/** Bumped per request, so asking for the same pose twice still counts as twice. */
	serial: number;
}

/** A request older than this was not caused by whatever is opening the dialog now. */
const FRESH_MS = 5000;

let current: CharacterFocusRequest | undefined;
let madeAt = 0;
let serial = 0;
const listeners = new Set<(request: CharacterFocusRequest) => void>();

export function requestCharacterFocus(
	characterId: string,
	pose?: string
): void {
	current = {characterId, pose, serial: ++serial};
	madeAt = Date.now();

	for (const listener of [...listeners]) {
		listener(current);
	}
}

/** The last unconsumed request, for a dialog that mounted after it was made. */
export function takePendingCharacterFocus(): CharacterFocusRequest | undefined {
	const request =
		current && Date.now() - madeAt < FRESH_MS ? current : undefined;

	current = undefined;

	return request;
}

export function onCharacterFocus(
	listener: (request: CharacterFocusRequest) => void
): () => void {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}
