/**
 * What one websocket message means for this browser's stories.
 *
 * This was a `React.useCallback` inside `use-server-sync.ts`, closing over six refs and
 * two state setters. That made it the one input to sync that could not be driven from a
 * test: the only way to deliver a message was to render the hook, stub `fetch`, wire a
 * fake socket and then assert on whatever came out the far end. The two tests that
 * managed it (`use-server-sync.test.tsx`) assert that a GET went out and that a record
 * reached `gone` — nothing about the decision, because the decision was not reachable.
 *
 * So it takes its dependencies by hand, the way `reconcile.ts` does, and it is split the
 * same way that file is split:
 *
 *   - `planServerMessage` is PURE. It answers "what does this message ask for", as a list
 *     of effects, given only what this browser holds. A test can state the situation and
 *     compare the whole answer with one `toEqual` — ordering included — with no stubs, no
 *     promises and no renderer.
 *   - `handleServerMessage` runs that plan against an env. It is deliberately thin: every
 *     branch worth arguing about is in the planner, so this cannot quietly grow a second
 *     opinion.
 *
 * `reconcileDecision` / `reconcileVerified` are the same pair, for the same reason.
 *
 * # Why presence is NOT here
 *
 * Every message is folded into presence as well, by `presenceReducer`. That is already a
 * pure function with its own 16 tests, and it is a fold over a different piece of state:
 * who is here, not what our stories should do. Pulling it in would mean every plan in
 * this file carried a `presence` entry that is always present and never interesting, and
 * two orthogonal reductions of one message would have to be read together to understand
 * either. The hook calls both, one line apart.
 *
 * # What a message may NOT do
 *
 * It may not write a story. A message carries a rev and a writer, never bytes — every
 * path that changes text goes through `reconcileStory`, which decides on evidence. That
 * is why `reconcile` is an effect here rather than something this file carries out.
 */

import {logSync} from './sync-log';
import type {SyncRecordStore} from './sync-record';
import type {ServerMessage, StoryIndexEntry} from './server.types';
import type {Story} from '../../stories';

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** The server's state for one story, in the shape the reconcile table wants it. */
export interface ServerStoryState {
	rev: number;
	deleted: boolean;
	lastClient?: string;
}

/**
 * What one index row should now say.
 *
 * A patch rather than a whole row: a socket message knows the rev, the writer and whether
 * there is a tombstone, and nothing else. Passage counts and byte totals stay whatever the
 * last poll said until the next one corrects them.
 */
export interface IndexRowPatch {
	deleted?: boolean;
	lastClient?: string;
	rev?: number;
}

export type ServerMessageEffect =
	/** Patch the row we already have for this story. Never inserts one. */
	| {type: 'index'; id: string; patch: IndexRowPatch}
	/** Re-read `GET /stories`. */
	| {type: 'refresh'}
	/** Put one story through the same decision table the poll uses. */
	| {type: 'reconcile'; story: Story; server: ServerStoryState}
	/** Fetch whatever art this story is now missing. */
	| {type: 'pullAssets'; storyId: string}
	/** Tell whoever is showing this story's revision list that a row's meta moved. */
	| {type: 'revisionMeta'; id: string; rev: number};

// ---------------------------------------------------------------------------
// Revision meta listeners
// ---------------------------------------------------------------------------

const revisionMetaListeners = new Set<(id: string, rev: number) => void>();

/**
 * Fires when someone else labelled or pinned a revision of a story.
 *
 * A module-level table, like `onStoryPulled` and `sync-reason.ts`, and for the same
 * reason: the only subscriber is a dialog that may not be mounted, and the alternative is
 * threading a subscription through the sync context for one consumer. Nothing about the
 * story changed — no rev, no bytes, no record — so there is nothing here for the rest of
 * the app to hear about.
 */
export function onRevisionMeta(
	listener: (id: string, rev: number) => void
): () => void {
	revisionMetaListeners.add(listener);

	return () => {
		revisionMetaListeners.delete(listener);
	};
}

/** Exported for the same reason `handleServerMessage` is: so a test can drive it. */
export function notifyRevisionMeta(id: string, rev: number): void {
	for (const listener of revisionMetaListeners) {
		listener(id, rev);
	}
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * What the planner is allowed to read.
 *
 * `stories` is a function, not an array: the hook reads `storiesRef.current`, and a
 * message may arrive at any moment between renders. An array captured at render time
 * would answer for a browser that no longer exists.
 */
export interface ServerMessageView {
	stories(): readonly Story[];
	records: SyncRecordStore;
}

/**
 * One message, as a list of things to do, in order.
 *
 * The rule that shapes all of it: a `story` for something we hold goes straight through
 * the reconcile table, because the message carries the rev and the rev is the only thing
 * an index row would have added. A message about a story we do NOT hold needs the round
 * trip — the ghost list is built from the index, so a story we have never seen has to
 * arrive as an index row before it can be drawn at all.
 */
export function planServerMessage(
	message: ServerMessage,
	view: ServerMessageView
): ServerMessageEffect[] {
	const held = (id: string) => view.stories().find(story => story.id === id);

	switch (message.t) {
		case 'story':
		case 'revived': {
			const story = held(message.id);
			const server: ServerStoryState = {
				deleted: false,
				lastClient: message.by,
				rev: message.rev
			};
			const effects: ServerMessageEffect[] = [
				{
					id: message.id,
					patch: {deleted: false, lastClient: message.by, rev: message.rev},
					type: 'index'
				}
			];

			effects.push(
				story ? {server, story, type: 'reconcile'} : {type: 'refresh'}
			);

			return effects;
		}

		case 'deleted': {
			const story = held(message.id);
			const effects: ServerMessageEffect[] = [
				{id: message.id, patch: {deleted: true}, type: 'index'}
			];

			if (!story) {
				effects.push({type: 'refresh'});

				return effects;
			}

			// A tombstone carries no rev, and none is needed: the decision table only
			// looks at `deleted` once it is set. The rev we hand over is our own, so that
			// a message which turns out NOT to mean `gone` cannot also move the record
			// backwards on its way past.
			effects.push({
				server: {
					deleted: true,
					lastClient: message.by,
					rev: view.records.get(message.id).rev
				},
				story,
				type: 'reconcile'
			});

			return effects;
		}

		case 'revmeta':
			// A label or a pin. Not a write: the rev did not move, the bytes did not
			// move, and no record here describes either. So there is no index patch and
			// nothing to reconcile — the one thing that wants to know is an open History
			// dialog, and it is told whether or not this browser holds the story, since
			// a dialog can be open on a ghost.
			return [{id: message.id, rev: message.rev, type: 'revisionMeta'}];

		case 'assets':
			// Asset bytes are not part of the story document, so there is nothing to
			// reconcile — what changed is the index row's counts. Ask for the whole index
			// rather than patching a row, since the counts are what moved, and fetch
			// whatever art we are now missing.
			return [{type: 'refresh'}, {storyId: message.story, type: 'pullAssets'}];

		default:
			// `welcome`, `presence`, `stolen`, `pong`, and anything a newer server sends
			// that this build has never heard of. None of them says anything about a
			// story; the first three are presence's, and presence sees every message.
			return [];
	}
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

export interface ServerMessageEnv extends ServerMessageView {
	/** Patch the index in place. Same updater shape `setIndex` takes. */
	setIndex(update: (current: StoryIndexEntry[]) => StoryIndexEntry[]): void;
	/** Re-read the index from the server. */
	refresh(): void;
	/** The hook's `reconcileStory`. */
	reconcile(story: Story, server: ServerStoryState): Promise<void>;
	/** The hook's `pullAssetsRef.current`. */
	pullAssets(storyId: string): void;
	/**
	 * A reconcile has finished and may have rewritten records.
	 *
	 * Separate from `reconcile` because the hook's copy of the records is React state:
	 * something has to re-read the store once the work is done, and it is not the
	 * reconcile's job to know that anyone is watching.
	 *
	 * KNOWN GAP, left as it was found: the runner chains this with `.then(f)` and no
	 * rejection arm, so a `reconcile` that REJECTS neither re-reads records nor reports
	 * anything — it escapes as an unhandled rejection and the sync badge keeps whatever it
	 * was showing until the next poll, which with a socket up is 300 seconds. The hook's
	 * `reconcileStory` reaches that only through a store dispatch that throws (a full
	 * `localStorage` on the `gone` branch), which is why it has never been seen. `.then(f,
	 * f)` is the fix; it is a behaviour change, so it is not made here. There is no test
	 * for it because jest attributes an unhandled rejection to whichever test is running
	 * and `it.failing` cannot invert that.
	 */
	onReconciled(): void;
}

/**
 * Plan the message and carry the plan out.
 *
 * Returns what it ran, which is what a test asserts on when it wants both halves at once.
 * The caller ignores it.
 */
export function handleServerMessage(
	message: ServerMessage,
	env: ServerMessageEnv
): ServerMessageEffect[] {
	const effects = planServerMessage(message, env);

	logSync('socket', noteFor(message, effects), storyIdOf(message), () => ({
		by: 'by' in message ? message.by : undefined,
		did: effects.map(effect => effect.type),
		rev: 'rev' in message ? message.rev : undefined,
		t: message.t
	}));

	for (const effect of effects) {
		switch (effect.type) {
			case 'index':
				env.setIndex(current =>
					current.map(entry =>
						entry.id === effect.id ? {...entry, ...effect.patch} : entry
					)
				);
				break;

			case 'refresh':
				env.refresh();
				break;

			case 'reconcile':
				void env
					.reconcile(effect.story, effect.server)
					.then(() => env.onReconciled());
				break;

			case 'pullAssets':
				env.pullAssets(effect.storyId);
				break;

			case 'revisionMeta':
				// Straight to the module table rather than through `env`: the hook has
				// no part in this and would only be a place for the message to get lost.
				notifyRevisionMeta(effect.id, effect.rev);
				break;
		}
	}

	return effects;
}

// ---------------------------------------------------------------------------
// Log notes
// ---------------------------------------------------------------------------

/**
 * A short phrase naming the decision, for `syncLogNotes({event: 'socket'})`.
 *
 * Derived from the plan rather than written per branch, so a note cannot come to describe
 * something the planner stopped doing.
 */
function noteFor(
	message: ServerMessage,
	effects: ServerMessageEffect[]
): string {
	if (effects.length === 0) {
		return `${message.t}: no story effect`;
	}

	if (effects.some(effect => effect.type === 'reconcile')) {
		return `${message.t}: reconcile`;
	}

	if (effects.some(effect => effect.type === 'pullAssets')) {
		return `${message.t}: refresh and pull assets`;
	}

	if (effects.some(effect => effect.type === 'revisionMeta')) {
		return `${message.t}: revision list changed`;
	}

	return `${message.t}: not held, refresh`;
}

function storyIdOf(message: ServerMessage): string | undefined {
	switch (message.t) {
		case 'story':
		case 'revived':
		case 'deleted':
		case 'revmeta':
			return message.id;

		case 'assets':
		case 'stolen':
			return message.story;

		default:
			return undefined;
	}
}
