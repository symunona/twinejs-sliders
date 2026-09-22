/**
 * Why a story went dirty, noted by the gesture that dirtied it.
 *
 * # Why a side table and not an argument
 *
 * The autosave path is a STORE WATCHER: `use-server-sync` notices a story changed and
 * calls `SyncQueue.push` with it. Nothing about the gesture survives that trip — a find &
 * replace across forty passages and a typed sentence arrive as the same thing, a new
 * `Story`. The gesture is the only thing that ever knew, so it leaves a note here on its
 * way past and the queue picks it up.
 *
 * The producers are thunks in `src/store/stories/action-creators`, which hold a `dispatch`
 * and nothing else. Handing them a queue reference would mean every action creator in the
 * editor knowing that sync exists. `sync-log.ts` is a module-level table for the same
 * reason.
 *
 * This file imports NOTHING on purpose: an action creator can take it without pulling the
 * sync graph — client, reconcile, records — into the store's half of the bundle, and there
 * is no import cycle to argue with.
 *
 * # Lifetime
 *
 * In memory, never persisted, never sent anywhere as-is: `patchSummary` turns a reason
 * into words first.
 *
 * A note is consumed by the push that queues it. One that is never consumed — the gesture
 * changed nothing, or the story is parked in `conflict` and `push` returns early — outlives
 * its gesture and can label that story's NEXT save instead. That is at most one wrong
 * label in a list of right ones, and the alternative is a timer or a second bookkeeping
 * table for a string that is only ever decoration.
 */

/**
 * Narrow on purpose: a new reason should need a locale key, and the compiler is what asks
 * for one. `voice:<tool>` is open-ended because the tool names belong to voice mode.
 */
export type SyncReason =
	| 'find-replace'
	| 'import'
	| 'restore'
	| `voice:${string}`;

const notes = new Map<string, SyncReason>();

/** Say why this story is about to change. Last note before the push wins. */
export function noteSyncReason(storyId: string, reason: SyncReason): void {
	notes.set(storyId, reason);
}

/** The note, removed. Nothing reads one twice. */
export function takeSyncReason(storyId: string): SyncReason | undefined {
	const reason = notes.get(storyId);

	notes.delete(storyId);

	return reason;
}

/** The note, left in place. For asserting, and for deciding without consuming. */
export function peekSyncReason(storyId: string): SyncReason | undefined {
	return notes.get(storyId);
}

/** Tests only — the table is process-wide, like every other module-level store here. */
export function clearSyncReasons(): void {
	notes.clear();
}
