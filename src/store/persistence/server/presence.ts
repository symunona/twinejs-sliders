/**
 * Presence and the soft locks that fall out of it (spec 11).
 *
 * There is no lock table anywhere — not here and not on the server. A lock is nothing more
 * than someone else's presence entry naming a passage, and everything below is a query
 * over the last `welcome` / `presence` payload the socket delivered. That is deliberate:
 * the only state that can go stale is state somebody has to keep in step, and a value
 * recomputed from the newest broadcast cannot.
 *
 * Every function here is pure so the rules — self is never a lock, the first arrival keeps
 * the passage, a steal makes both sides writable — can be tested without a socket.
 */

import type {PresenceClient, ServerMessage} from './server.types';

/**
 * One announced takeover. A pair rather than a joined string key: passage ids are opaque
 * and a separator is one more thing that can be wrong.
 */
export interface StolenPassage {
	story: string;
	passage: string;
}

export interface PresenceState {
	/** This browser's client id. The one entry that is never a lock. */
	selfId: string;
	/** Oldest arrival first — the server sorts, and we keep its order. */
	clients: PresenceClient[];
	/** Passages someone has taken over, for as long as two people are still in them. */
	stolen: StolenPassage[];
}

export function emptyPresence(selfId = ''): PresenceState {
	return {clients: [], selfId, stolen: []};
}

/**
 * A passage that has more than one editor in it.
 *
 * `shared` is what a steal produced: both editors stay writable, both show a banner. Until
 * then the later arrival is read-only and `by` is the person who got there first.
 */
export interface PassageLock {
	by: PresenceClient;
	shared: boolean;
}

// ---------------------------------------------------------------------------
// Reducing the wire messages
// ---------------------------------------------------------------------------

/**
 * Folds one `ServerMessage` into presence state. Anything that is not about people is
 * returned unchanged, so a caller can hand it every message it receives.
 */
export function presenceReducer(
	state: PresenceState,
	message: ServerMessage
): PresenceState {
	switch (message.t) {
		case 'welcome':
		case 'presence':
			return pruneStolen({...state, clients: message.clients});

		case 'stolen':
			if (isStolen(state, message.story, message.passage)) {
				return state;
			}

			return {
				...state,
				stolen: [
					...state.stolen,
					{passage: message.passage, story: message.story}
				]
			};

		default:
			return state;
	}
}

/** Drops the socket's view of the world without forgetting who we are. */
export function presenceDisconnected(state: PresenceState): PresenceState {
	if (state.clients.length === 0 && state.stolen.length === 0) {
		return state;
	}

	return {...state, clients: [], stolen: []};
}

/**
 * Forgets a steal once the other party has left the passage.
 *
 * Without this a shared banner would outlive the person it names: the steal itself is a
 * one-shot announcement, so presence is the only thing that can retire it.
 */
function pruneStolen(state: PresenceState): PresenceState {
	if (state.stolen.length === 0) {
		return state;
	}

	const live = state.stolen.filter(
		entry => othersInPassage(state, entry.story, entry.passage).length > 0
	);

	return live.length === state.stolen.length ? state : {...state, stolen: live};
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

function selfEntry(state: PresenceState): PresenceClient | undefined {
	return state.clients.find(client => client.id === state.selfId);
}

/** Everyone else in a story, in arrival order. Two tabs of one person are two people. */
export function clientsInStory(
	state: PresenceState,
	storyId: string
): PresenceClient[] {
	return state.clients.filter(
		client => client.story === storyId && client.id !== state.selfId
	);
}

/** Everyone else in one passage. */
export function othersInPassage(
	state: PresenceState,
	storyId: string,
	passageId: string
): PresenceClient[] {
	return state.clients.filter(
		client =>
			client.story === storyId &&
			client.passage === passageId &&
			client.id !== state.selfId
	);
}

/**
 * Who holds this passage against us, if anyone.
 *
 * Never ourselves — that is the whole reason presence carries client ids rather than
 * names, since the same person in two tabs would otherwise lock themselves out. And when
 * we were in the passage first, nobody holds it against us: the late arrival is the one
 * who reads a banner, which is what makes "open a passage and start typing" the normal
 * case rather than a race.
 */
export function lockFor(
	state: PresenceState,
	storyId: string,
	passageId: string
): PresenceClient | undefined {
	const others = othersInPassage(state, storyId, passageId);

	if (others.length === 0) {
		return undefined;
	}

	const self = selfEntry(state);
	const holders =
		self && self.story === storyId && self.passage === passageId
			? others.filter(other => earlierThan(other, self))
			: others;

	return [...holders].sort(byArrival)[0];
}

/** Has anyone taken this passage over? Both sides see the same answer. */
export function isStolen(
	state: PresenceState,
	storyId: string,
	passageId: string
): boolean {
	return state.stolen.some(
		entry => entry.story === storyId && entry.passage === passageId
	);
}

/**
 * The banner state for one passage: `undefined` means nobody else is in it.
 *
 * After a steal both editors are writable, so `shared` is reported for the person who was
 * there first as well — they did not lose the passage, they gained company.
 */
export function passageLock(
	state: PresenceState,
	storyId: string,
	passageId: string
): PassageLock | undefined {
	if (isStolen(state, storyId, passageId)) {
		const by = [...othersInPassage(state, storyId, passageId)].sort(
			byArrival
		)[0];

		return by ? {by, shared: true} : undefined;
	}

	const by = lockFor(state, storyId, passageId);

	return by ? {by, shared: false} : undefined;
}

/** Passage id -> the name to draw on its card, for every held passage in a story. */
export function lockedPassages(
	state: PresenceState,
	storyId: string
): Record<string, string> {
	const out: Record<string, string> = {};

	for (const client of clientsInStory(state, storyId)) {
		if (client.passage && !(client.passage in out)) {
			out[client.passage] = client.name;
		}
	}

	return out;
}

/** Display names, deduplicated and sorted, for a badge's `data-names`. */
export function presenceNames(clients: PresenceClient[]): string[] {
	return [...new Set(clients.map(client => client.name))].sort((a, b) =>
		a.localeCompare(b)
	);
}

function earlierThan(a: PresenceClient, b: PresenceClient): boolean {
	return a.since === b.since ? a.id < b.id : a.since < b.since;
}

function byArrival(a: PresenceClient, b: PresenceClient): number {
	if (a.since !== b.since) {
		return a.since < b.since ? -1 : 1;
	}

	return a.id < b.id ? -1 : 1;
}
