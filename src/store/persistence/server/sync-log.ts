/**
 * A ring buffer of what sync just did, and why.
 *
 * Sync is the one module here whose bugs are all invisible: a dropped receipt, a decision
 * taken on a stale hash, a pull that reported success without landing. Every one of those
 * was found by reconstructing it from symptoms hours later — see the sync entries in
 * `CLAUDE.md`, several of which say "measured exactly that way".
 *
 * So this records the DECISIONS, not the traffic. A log of requests would have shown
 * nothing in any of those cases; what was missing every time was the input a decision was
 * taken on. `reconcile` entries therefore carry the whole `ReconcileInput` and the answer
 * it produced, which is enough to replay the argument without the browser.
 *
 * It is a TEST ORACLE first and a debugging aid second. Asserting on the decision trace
 * pins the behaviour that matters — "B came back online and PULLED" — where asserting on
 * a rendered badge pins the thing that happens to be on screen when it does.
 *
 * In memory only. Nothing here is persisted, sent anywhere, or shown to an author.
 */

/** What kind of thing happened. Narrow on purpose: a new value should need a reason. */
export type SyncLogEvent =
	/** A story-level decision came out of the reconcile table. */
	| 'reconcile'
	/** A push was attempted, landed, or failed. */
	| 'push'
	/** A pull was attempted, landed, or was answered 304. */
	| 'pull'
	/** The record's rev or hash was written, by whichever path. */
	| 'record'
	/** A message arrived off the websocket. */
	| 'socket'
	/** Art moving in either direction. */
	| 'asset'
	/** Something threw. */
	| 'error';

export interface SyncLogEntry {
	/** `Date.now()` when it happened. */
	at: number;
	event: SyncLogEvent;
	/** Absent for connection-level entries that belong to no one story. */
	storyId?: string;
	/** Short verb phrase: `'landed'`, `'412'`, `'skipped: same hash'`. */
	note: string;
	/**
	 * Whatever the reader would need to argue with the decision. Kept as a plain object
	 * so a test can match on it; never a class, never a live store reference.
	 */
	detail?: Record<string, unknown>;
}

/**
 * How many entries to keep.
 *
 * A session's worth of autosaves is a few hundred at most, and a bug worth chasing is
 * always in the last handful. Sized to survive an afternoon rather than a week.
 */
export const SYNC_LOG_LIMIT = 500;

let entries: SyncLogEntry[] = [];
let listeners = new Set<(entry: SyncLogEntry) => void>();
/**
 * Off by default.
 *
 * Every sync decision would otherwise allocate a detail object on a 30-second timer in
 * every tab for the whole life of the app, to be read by nobody. Tests turn it on; the
 * debug hook below turns it on for a human.
 */
let enabled = false;

/** Turn recording on or off. Returns the previous setting, so a test can restore it. */
export function setSyncLogEnabled(next: boolean): boolean {
	const previous = enabled;

	enabled = next;

	return previous;
}

export function syncLogEnabled(): boolean {
	return enabled;
}

/**
 * Record one entry.
 *
 * `detail` is taken by thunk so that building it costs nothing while logging is off —
 * which is the normal state, and the reason this can be called from the hot paths.
 */
export function logSync(
	event: SyncLogEvent,
	note: string,
	storyId?: string,
	detail?: () => Record<string, unknown>
): void {
	if (!enabled) {
		return;
	}

	const entry: SyncLogEntry = {
		at: Date.now(),
		event,
		note,
		...(storyId === undefined ? {} : {storyId}),
		...(detail === undefined ? {} : {detail: detail()})
	};

	entries.push(entry);

	if (entries.length > SYNC_LOG_LIMIT) {
		// Splice rather than shift-per-entry: a burst of pushes would otherwise memmove
		// the whole buffer once per entry.
		entries.splice(0, entries.length - SYNC_LOG_LIMIT);
	}

	for (const listener of listeners) {
		listener(entry);
	}
}

/** Everything recorded, oldest first. A copy — callers filter and sort freely. */
export function syncLog(filter?: {
	storyId?: string;
	event?: SyncLogEvent;
}): SyncLogEntry[] {
	if (!filter) {
		return [...entries];
	}

	return entries.filter(
		entry =>
			(filter.storyId === undefined || entry.storyId === filter.storyId) &&
			(filter.event === undefined || entry.event === filter.event)
	);
}

/**
 * The notes of the matching entries, in order.
 *
 * The shape most assertions actually want: `expect(syncLogNotes({event: 'reconcile'}))
 * .toEqual(['pull'])` says what a test means far more directly than digging through
 * entry objects.
 */
export function syncLogNotes(filter?: {
	storyId?: string;
	event?: SyncLogEvent;
}): string[] {
	return syncLog(filter).map(entry => entry.note);
}

export function onSyncLog(
	listener: (entry: SyncLogEntry) => void
): () => void {
	listeners.add(listener);

	return () => {
		listeners.delete(listener);
	};
}

/** Drop everything. Tests call this in `beforeEach`. */
export function clearSyncLog(): void {
	entries = [];
}

/** Tests only: forget listeners too, so one suite cannot leak into the next. */
export function resetSyncLogForTests(): void {
	entries = [];
	listeners = new Set();
	enabled = false;
}

/**
 * `window.__slidersSyncLog()` — a human's way in, and agent-browser's.
 *
 * Attached unconditionally because it costs one property and is useless until someone
 * calls `enable()`, which is the point: a bug reported from a live session can be armed
 * from the console without a rebuild.
 */
export function installSyncLogDebugHook(target: Record<string, unknown>): void {
	target.__slidersSyncLog = Object.assign(
		(filter?: {storyId?: string; event?: SyncLogEvent}) => syncLog(filter),
		{
			clear: clearSyncLog,
			disable: () => setSyncLogEnabled(false),
			enable: () => setSyncLogEnabled(true),
			enabled: syncLogEnabled,
			notes: syncLogNotes
		}
	);
}
