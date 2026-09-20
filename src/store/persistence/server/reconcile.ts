/**
 * What to do about one story, and — when the answer is `conflict` — whether that answer
 * survives being checked.
 *
 * The decision table used to live in `use-server-sync.ts`. It moved here so that the
 * verification step can sit next to it without the hook and the push queue importing each
 * other: both of them need the check, and neither has any business knowing about the
 * other. `use-server-sync.ts` re-exports the table, so nothing outside had to change.
 *
 * # Why a conflict has to be VERIFIED
 *
 * `reconcileDecision` decides `conflict` on a PROXY: "my hash differs from the hash I
 * last pushed, and the server is ahead of the rev I last recorded". That is two
 * statements about this browser's bookkeeping and none about the server's bytes. Every
 * false conflict found so far has been exactly that gap:
 *
 *   - `docs/sliders/bugs/rev-lag.md` — a `keepalive` push on tab-hide LANDS, and the
 *     `.then` that would have recorded its rev and hash dies with the page. Next load the
 *     record is behind and reads dirty, so one browser conflicts with itself over text it
 *     sent itself.
 *   - A cleared `localStorage`: no record at all, so everything is dirty and at rev 0.
 *   - View state that used to be hashed (`zoom`, `snapToGrid`) — fixed at the hash, but
 *     the same shape of mistake.
 *
 * So: decide `conflict` on EVIDENCE. Fetch the server's copy and compare content. If the
 * two agree there is nothing for a person to resolve, and the honest repair is to write
 * down the rev this browser should have had. If they disagree, park — that is a real
 * disagreement and only the author can settle it.
 *
 * The check costs a round trip, so it runs ONLY on a suspected conflict, which is rare
 * and already about to cost an author a dialog.
 */

import {NOT_MODIFIED, type FetchedStory, type ServerClient} from './client';
import {logSync} from './sync-log';
import {storyHash, type SyncRecordStore} from './sync-record';
import {usableSnapshot} from './story-diff';
import {mergeStories} from './story-merge';
import type {Story} from '../../stories';

// ---------------------------------------------------------------------------
// The connect / refresh decision table
// ---------------------------------------------------------------------------

export type ReconcileAction =
	| 'ghost'
	| 'none'
	| 'pull'
	| 'conflict'
	| 'gone'
	| 'push';

export interface ReconcileInput {
	/** Absent when this browser has no copy of the story. */
	local?: {sync: boolean; dirty: boolean; rev: number};
	/** Absent when the server has never heard of it. */
	server?: {rev: number; deleted: boolean};
}

/**
 * One row of spec 11's "Connect / refresh" table, as a pure function.
 *
 * | local | server | result |
 * |---|---|---|
 * | — | present | `ghost` |
 * | `sync: false` | present | `none` — the card just notes "also on server" |
 * | `sync: true`, clean, behind | present | `pull` |
 * | `sync: true`, dirty, behind | present | `conflict` — SUSPECTED; see below |
 * | `sync: true` | tombstone / absent | `gone` |
 * | `sync: true`, dirty, current | present | `push` |
 *
 * Pure, and deliberately kept that way: it is the readable statement of the rule, and a
 * network call inside it could not be tested as a table. `conflict` out of here means
 * "suspected" — `verifyConflict` turns that into an answer.
 */
export function reconcileDecision(input: ReconcileInput): ReconcileAction {
	const {local, server} = input;

	if (!local) {
		return server && !server.deleted ? 'ghost' : 'none';
	}

	if (!local.sync) {
		return 'none';
	}

	if (!server || server.deleted) {
		return 'gone';
	}

	if (server.rev > local.rev) {
		return local.dirty ? 'conflict' : 'pull';
	}

	return local.dirty ? 'push' : 'none';
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * `resolved` — the two copies say the same thing, and the record has been repaired.
 * `conflict` — they genuinely differ, or we could not find out.
 */
export type ConflictVerdict = 'resolved' | 'conflict';

export interface VerifyConflictOptions {
	client: ServerClient;
	/** This browser's copy — the one that was about to be called conflicted. */
	local: Story;
	records: SyncRecordStore;
	/** `storyHash(local)`, when the caller already computed it. */
	hash?: string;
	/**
	 * Try a per-passage merge before parking. OFF by default, and deliberately: the
	 * merged story has to reach the local store, and a caller that cannot land it would
	 * push a copy this browser never shows. See `SyncQueueOptions.onMerged`.
	 */
	merge?: boolean;
}

/**
 * What a suspected conflict turned out to be.
 *
 * `resolved` — the two copies say the same thing, and the record has been repaired.
 * `merged` — they differ but in different passages; `story` is theirs plus mine, based
 *   on `rev`. NOTHING HAS BEEN WRITTEN: the caller owns pushing it and landing it, in
 *   that order, because only the caller knows whether the store took it.
 * `conflict` — they genuinely differ, or we could not find out. `reason` says which.
 */
export interface ConflictOutcome {
	verdict: 'resolved' | 'merged' | 'conflict';
	story?: Story;
	rev?: number;
	reason?: string;
}

/**
 * Fetch the server's copy and compare CONTENT.
 *
 * Resolving writes the rev and hash this browser should have had, so the story leaves
 * whatever parked state it was in and syncs normally again. Note that `pushedHash` is set
 * from the story that was COMPARED, not from whatever the store holds now: an edit that
 * landed while the fetch was in flight must still read as dirty and still go up.
 *
 * Every failure path parks. A verification that could not be carried out is not evidence
 * of agreement, and swallowing a real conflict because the wifi died would lose an
 * author's work — the one thing no sync path here is allowed to do.
 */
export async function examineConflict(
	options: VerifyConflictOptions
): Promise<ConflictOutcome> {
	const {client, local, records} = options;
	const storyId = local.id;
	const mine = options.hash ?? storyHash(local);

	let current: FetchedStory;
	let theirs: string;

	try {
		const fetched = await client.getStory(storyId);

		if (fetched === NOT_MODIFIED) {
			// Only ever answered to an `If-None-Match`, which this never sends. Park
			// rather than guess at what it would have meant.
			logSync('reconcile', 'conflict: unverified', storyId, () => ({
				reason: 'not-modified'
			}));

			return {reason: 'not-modified', verdict: 'conflict'};
		}

		current = fetched;
		// Hashing is inside the `try` on purpose: a body that is not a story throws in
		// `hashable`, and an answer we cannot read is no more evidence of agreement than
		// an answer that never came.
		theirs = storyHash(current.story);
	} catch (error) {
		logSync('reconcile', 'conflict: unverified', storyId, () => ({
			error: error instanceof Error ? error.message : String(error),
			rev: records.get(storyId).rev
		}));

		return {reason: 'unverified', verdict: 'conflict'};
	}

	if (theirs !== mine) {
		// The two copies really do differ. Before calling that a conflict, ask whether
		// they differ in the SAME passages: two people working on one story normally
		// each have their own rooms open, and `If-Match` is on the story rev, so today
		// that reads as a conflict every few minutes.
		const merge = options.merge
			? mergeStories({
					base: usableSnapshot(
						records.get(storyId).snapshot,
						records.get(storyId).pushedHash
					),
					mine: local,
					theirs: current.story
			  })
			: {merged: false as const, reason: 'merging not offered'};

		if (merge.merged) {
			logSync('reconcile', 'conflict: mergeable', storyId, () => ({
				rev: current.rev
			}));

			return {rev: current.rev, story: merge.story, verdict: 'merged'};
		}

		logSync('reconcile', 'conflict: confirmed', storyId, () => ({
			mine,
			reason: merge.reason,
			rev: records.get(storyId).rev,
			serverRev: current.rev,
			theirs
		}));

		return {reason: merge.reason, verdict: 'conflict'};
	}

	// Deliberately NOT keyed on the server's `lastClient` being us. `backendClientId` is
	// one pref shared by every tab of this browser, so "I wrote it last" does not mean
	// "this tab wrote it last" — content is the only thing that actually settles it.
	records.update(storyId, {
		conflictClient: undefined,
		conflictRev: undefined,
		lastError: undefined,
		pushedHash: mine,
		rev: current.rev,
		state: 'idle'
	});
	logSync('record', 'conflict: resolved, same content', storyId, () => ({
		hash: mine,
		rev: current.rev
	}));

	return {verdict: 'resolved'};
}

/**
 * The yes/no form, for callers with no way to land a merged story.
 *
 * Kept as the narrow answer rather than folded into `examineConflict`'s three, so a
 * caller that cannot merge cannot accidentally be handed one: `merge` is not passed
 * through, so a `merged` verdict is not reachable from here.
 */
export async function verifyConflict(
	options: VerifyConflictOptions
): Promise<ConflictVerdict> {
	const {verdict} = await examineConflict({...options, merge: false});

	return verdict === 'resolved' ? 'resolved' : 'conflict';
}

export interface ReconcileVerifiedInput {
	client: ServerClient;
	/** This browser's copy of the story. */
	local: Story;
	records: SyncRecordStore;
	/** The index row or socket message, or absent when the server has no such story. */
	server: {rev: number; deleted: boolean} | undefined;
}

/**
 * `reconcileMerging`'s answer.
 *
 * `action` widens `ReconcileAction` with `merge` rather than adding a member to it:
 * `ReconcileAction` is switched on in the hook, and a new member there would be a
 * compile error in a file this change deliberately does not touch.
 */
export interface ReconcileOutcome {
	action: ReconcileAction | 'merge';
	/** Only when `action` is `merge`: theirs plus mine, to land and then push. */
	story?: Story;
	/** Only when `action` is `merge`: the server rev it is based on. */
	rev?: number;
}

/**
 * The table, with a suspected conflict checked against the server's bytes.
 *
 * One function so that the hook and any test asking "what would sync do here" are reading
 * the same answer. A second copy of this is exactly how two paths come to disagree about
 * what a stale-and-dirty story means — the note on `reconcileStory` says the same thing
 * about the poll and the socket.
 *
 * A resolved conflict comes back as `none`: the record now matches the server, so there
 * is nothing left to do this round.
 */
export async function reconcileVerified(
	input: ReconcileVerifiedInput
): Promise<ReconcileAction> {
	const {client, local, records, server} = input;
	const record = records.get(local.id);
	const hash = storyHash(local);
	const decision = reconcileDecision({
		local: {
			dirty: hash !== record.pushedHash,
			rev: record.rev,
			sync: local.sync === true
		},
		server
	});

	if (decision !== 'conflict') {
		return decision;
	}

	const verdict = await verifyConflict({client, hash, local, records});

	return verdict === 'resolved' ? 'none' : 'conflict';
}

/**
 * The table, with a suspected conflict checked AND, where it can be, merged.
 *
 * The merging sibling of `reconcileVerified`, for the poll and socket path. It is
 * separate rather than a flag because the two have different obligations: a caller of
 * this one must be able to land `story` in the local store and push it, in that order,
 * and a caller that cannot must keep using `reconcileVerified`. See the wiring note in
 * `SyncQueueOptions.onMerged`.
 *
 * Nothing is written here. `merge` is a proposal.
 */
export async function reconcileMerging(
	input: ReconcileVerifiedInput
): Promise<ReconcileOutcome> {
	const {client, local, records, server} = input;
	const record = records.get(local.id);
	const hash = storyHash(local);
	const decision = reconcileDecision({
		local: {
			dirty: hash !== record.pushedHash,
			rev: record.rev,
			sync: local.sync === true
		},
		server
	});

	if (decision !== 'conflict') {
		return {action: decision};
	}

	const outcome = await examineConflict({
		client,
		hash,
		local,
		merge: true,
		records
	});

	switch (outcome.verdict) {
		case 'resolved':
			return {action: 'none'};
		case 'merged':
			return {action: 'merge', rev: outcome.rev, story: outcome.story};
		default:
			return {action: 'conflict'};
	}
}
