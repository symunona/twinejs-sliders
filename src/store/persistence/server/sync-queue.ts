/**
 * Per-story push queue: debounce, retry, and the parking rules (spec 11).
 *
 * A class rather than a hook because none of this is React's business — it outlives
 * renders, it has to survive a route change, and the `visibilitychange` handler needs to
 * reach it from outside the tree.
 *
 * Everything here is per story. A conflict on one story parks that story alone; the others
 * keep saving, because the failure is about one document, not about the connection.
 */

import type {Story} from '../../stories';
import {isServerError, type ServerClient} from './client';
import {examineConflict} from './reconcile';
import {logSync} from './sync-log';
import {
	localSyncRecordStore,
	storyHash,
	type SyncRecordStore,
	type SyncRecords
} from './sync-record';
import {patchSummary, reasonSummary} from './patch-summary';
import type {PutStoryResponse, StoryPatch, SyncRecord} from './server.types';
import {
	diffFromSnapshot,
	diffPassages,
	snapshotStory,
	usableSnapshot
} from './story-diff';
import {type SyncReason, takeSyncReason} from './sync-reason';

/** Spec 11: debounce 5 s, max wait 30 s, backoff 5 → 15 → 60. */
export const DEFAULT_DEBOUNCE_MS = 5000;
export const DEFAULT_MAX_WAIT_MS = 30000;
export const DEFAULT_BACKOFF_MS = [5000, 15000, 60000];

/**
 * How many times a merge may be thrown away because the author typed during it.
 *
 * Each attempt is one GET and one refused push, and the text is never at risk — past the
 * cap the story parks in `conflict`, which is exactly what happened before merging
 * existed.
 */
export const MAX_MERGE_ATTEMPTS = 3;

/**
 * How many times a PATCH may fail ambiguously, with the PUT behind it getting through,
 * before the queue stops offering PATCH for the session.
 *
 * Only for failures that say nothing about the method — a dropped connection, a refused
 * CORS preflight, both of which reach here as `network`. A server that ANSWERS 405 needs
 * no repetition and is switched off on the first one.
 */
export const MAX_PATCH_FALLBACKS = 3;

/** E2E sets this to 50 so the suite does not sit through a five second debounce. */
export const DEBOUNCE_PREF_KEY = 'sliders.sync.debounceMs';

export interface SyncQueueOptions {
	client: ServerClient;
	debounceMs?: number;
	maxWaitMs?: number;
	backoffMs?: number[];
	/** Called after every state change, before listeners. Used by the hook to log. */
	onError?: (storyId: string, error: unknown) => void;
	/**
	 * Called after a push lands. The hook follows it with an asset sync: a text edit can
	 * be the first thing that names a picture, and art has no queue of its own.
	 */
	onPushed?: (story: Story) => void;
	/**
	 * Land a merged story in the local store, and say whether it actually landed.
	 *
	 * Two people editing DIFFERENT passages of one story conflict today, because
	 * `If-Match` is on the story rev. `story-merge.ts` can resolve that without asking
	 * anybody — but the result has to reach this browser's store, and only the hook can
	 * dispatch. So the merge is OFF unless a caller supplies this: a queue that could
	 * push a merge it cannot land would leave the author looking at a story missing the
	 * other person's passage under a green "synced" badge, which is the failure this
	 * whole directory keeps re-learning.
	 *
	 * MUST return `true` only when the store really took the update. `applyPulledStory`
	 * answers that question properly, by running the real reducer as a dry run; a `true`
	 * returned on faith is how a passage gets dropped.
	 */
	onMerged?: (story: Story, rev: number) => boolean;
	/**
	 * Send changed passages instead of the whole story. On by default; tests turn it off
	 * to exercise the PUT path. A server that ANSWERS a PATCH with 400/405/415/501 turns
	 * it off for the session by itself, and a failure that says nothing — a dead
	 * connection, a refused preflight — has to repeat `MAX_PATCH_FALLBACKS` times first.
	 * See `patchMayBeUnsupported` and `saysPatchUnsupported`.
	 */
	patch?: boolean;
	/**
	 * Where the side table lives. Defaults to the app's `localStorage` one.
	 *
	 * Injected so a test can give each simulated client its own bookkeeping: the module
	 * store is a process-wide cache, so two queues in one jest process would otherwise
	 * share a rev they are supposed to be arguing over.
	 */
	records?: SyncRecordStore;
}

interface Pending {
	story: Story;
	debounceTimer?: ReturnType<typeof setTimeout>;
	maxWaitTimer?: ReturnType<typeof setTimeout>;
	retryTimer?: ReturnType<typeof setTimeout>;
	/** How many pushes have already failed with something retryable. */
	attempt: number;
	/** How many merges were thrown away because the author typed mid-round-trip. */
	mergeAttempts?: number;
	/**
	 * What the gesture that dirtied this story said it was doing, if it said anything.
	 *
	 * Sticks to the entry rather than being read at flush time: a find & replace dirties
	 * the story forty times in one debounce window, and only the first of those pushes
	 * finds the note (`takeSyncReason` consumes it). Never cleared by a later reason-less
	 * push, or plain typing during the same window would erase it.
	 */
	reason?: SyncReason;
	inFlight?: Promise<void>;
}

function debounceOverride(): number | undefined {
	try {
		const raw = globalThis.localStorage?.getItem(DEBOUNCE_PREF_KEY);

		if (raw === null || raw === undefined || raw === '') {
			return undefined;
		}

		const parsed = Number(raw);

		return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export class SyncQueue {
	private readonly options: SyncQueueOptions;
	private readonly pending = new Map<string, Pending>();
	/**
	 * The story as last pushed, per story id — the base a patch is computed against.
	 *
	 * `record.snapshot` is hashes, not text, on purpose: it lives in `localStorage` and a
	 * second copy of every story there was the thing `StorySnapshot` exists to avoid. But
	 * a SENTENCE about a patch needs the words behind it — the name of a removed id, what a
	 * renamed passage used to be called — so this keeps the object itself, in memory only,
	 * written exactly where `snapshot` is written and guarded by exactly the same
	 * comparison (`hash === record.pushedHash`). A pull, a checkout or a publish therefore
	 * invalidates it for free, same as the snapshot, and the cost of being wrong is one
	 * History row with no sentence on it.
	 *
	 * Not in `SyncRecord`: nothing outside this class should be able to mistake it for
	 * state worth persisting.
	 */
	private readonly bases = new Map<string, {hash: string; story: Story}>();
	private readonly listeners = new Set<(records: SyncRecords) => void>();
	private readonly store: SyncRecordStore;
	private disposed = false;
	/** Cleared for the session once a PUT working where a PATCH did not means something. */
	private patchEnabled: boolean;
	/**
	 * Consecutive ambiguous PATCH failures whose PUT got through. Reset by any PATCH that
	 * works, so a flaky connection never accumulates its way to switching PATCH off.
	 */
	private patchFallbacks = 0;

	constructor(options: SyncQueueOptions) {
		this.options = options;
		this.store = options.records ?? localSyncRecordStore();
		this.patchEnabled = options.patch !== false;
	}

	/** Current side table. Same object the module-level readers see. */
	get records(): SyncRecords {
		return this.store.all();
	}

	onChange(listener: (records: SyncRecords) => void): () => void {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Is this story waiting to be pushed, or being pushed right now? */
	busy(storyId: string): boolean {
		return this.pending.has(storyId);
	}

	/**
	 * Schedules a save.
	 *
	 * Parked stories are ignored: a conflict or a tombstone needs a person to decide
	 * something, and queueing pushes behind that decision only means a longer line of
	 * pushes that will all fail the same way.
	 */
	push(story: Story, options: {reason?: SyncReason} = {}): void {
		if (this.disposed) {
			return;
		}

		const record = this.store.get(story.id);

		if (record.state === 'conflict' || record.state === 'gone') {
			logSync('push', `not queued: ${record.state}`, story.id, () => ({
				rev: record.rev
			}));
			return;
		}

		if (storyHash(story) === record.pushedHash) {
			logSync('push', 'skipped: same hash', story.id, () => ({
				rev: record.rev
			}));
			return;
		}

		// Taken only once the push is really happening. A story parked in `conflict`, or
		// one whose hash did not move, returns above with the note still on the table, so
		// the gesture keeps its label until a save actually carries it.
		const reason = options.reason ?? takeSyncReason(story.id);
		const debounceMs =
			debounceOverride() ?? this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		const maxWaitMs = this.options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
		const existing = this.pending.get(story.id);

		if (existing) {
			existing.story = story;

			if (reason) {
				existing.reason = reason;
			}

			// A fresh edit clears a parked backoff: the author is still working, and
			// whatever went wrong is worth trying again on their schedule, not ours.
			if (existing.retryTimer) {
				clearTimeout(existing.retryTimer);
				existing.retryTimer = undefined;
				existing.attempt = 0;
			}

			if (existing.debounceTimer) {
				clearTimeout(existing.debounceTimer);
			}

			existing.debounceTimer = setTimeout(
				() => void this.flush(story.id),
				debounceMs
			);

			if (record.state !== 'dirty' && record.state !== 'pushing') {
				this.write(story.id, {state: 'dirty'});
			}

			return;
		}

		const entry: Pending = {attempt: 0, reason, story};

		entry.debounceTimer = setTimeout(
			() => void this.flush(story.id),
			debounceMs
		);

		// The max-wait timer is never reset. It is the whole point: someone typing without
		// a five second gap would otherwise never be saved at all.
		if (maxWaitMs > debounceMs) {
			entry.maxWaitTimer = setTimeout(
				() => void this.flush(story.id),
				maxWaitMs
			);
		}

		this.pending.set(story.id, entry);
		this.write(story.id, {state: 'dirty'});
	}

	/** Drops a story's pending work without pushing it — used when sync is turned off. */
	cancel(storyId: string): void {
		const entry = this.pending.get(storyId);

		if (!entry) {
			return;
		}

		clearTimers(entry);
		this.pending.delete(storyId);
	}

	/** Pushes everything waiting. `keepalive` is for the `visibilitychange` handler. */
	async flushAll(options: {keepalive?: boolean} = {}): Promise<void> {
		await Promise.all(
			[...this.pending.keys()].map(id => this.flush(id, options))
		);
	}

	/**
	 * Pushes one story now, whatever its timers said.
	 *
	 * Reentrant on purpose: the debounce timer and a `flushAll` can land in the same tick,
	 * and two overlapping PUTs of the same story is exactly the race `If-Match` is there
	 * to punish.
	 */
	async flush(
		storyId: string,
		options: {keepalive?: boolean} = {}
	): Promise<void> {
		const entry = this.pending.get(storyId);

		if (!entry) {
			return;
		}

		if (entry.inFlight) {
			await entry.inFlight;
			return;
		}

		clearTimers(entry);

		const story = entry.story;
		const record = this.store.get(storyId);
		const hash = storyHash(story);

		// `push()` checks this too, but a queued entry can go stale between scheduling and
		// firing: a publish or a pull writes the same body through another path first.
		// Sending it again costs a rev, burns a slot of the keep-N history and credits the
		// version to whoever merely received it.
		if (hash === record.pushedHash) {
			logSync('push', 'skipped: stale entry', storyId, () => ({
				rev: record.rev
			}));
			this.pending.delete(storyId);
			this.write(storyId, {state: 'idle'});
			return;
		}

		this.write(storyId, {state: 'pushing'});

		const patch = this.patchFor(record, story);
		const summary = this.summaryFor(record, story, patch, entry.reason);
		const run = async () => {
			try {
				const result = await this.send(story, record, patch, options, summary);

				// An edit that arrived mid-flight left its own debounce timer on this
				// entry. Dropping the entry would drop that timer with it, and the
				// author's last sentence would sit unsaved until they typed again.
				const superseded = entry.story !== story;

				if (!superseded) {
					this.pending.delete(storyId);
				}

				// The label belonged to THIS write. A superseded entry keeps its timers
				// and its text, but the keystrokes that arrived mid-flight are plain
				// typing and derive their own sentence. (A FAILED write keeps the reason:
				// the retry resends the same body, so it is still the same gesture.)
				entry.reason = undefined;

				logSync('push', patch ? 'landed: patch' : 'landed', storyId, () => ({
					keepalive: options.keepalive === true,
					sentIfMatch: record.rev || undefined,
					rev: result.rev,
					superseded,
					...(patch
						? {
								changed: patch.passages?.changed?.length ?? 0,
								removed: patch.passages?.removed?.length ?? 0
						  }
						: {})
				}));
				this.write(storyId, {
					conflictClient: undefined,
					conflictRev: undefined,
					lastError: undefined,
					lastPushedAt: Date.now(),
					pushedHash: hash,
					rev: result.rev,
					// The base the NEXT patch is computed from. Written here and nowhere
					// else: a path that writes `pushedHash` without one — a pull, a
					// checkout, a publish — leaves a snapshot whose `hash` no longer
					// matches, which `usableSnapshot` refuses, which costs one whole PUT
					// and mints a fresh one. That is the whole invalidation scheme.
					snapshot: snapshotStory(story),
					state: superseded ? 'dirty' : 'idle'
				});
				this.bases.set(storyId, {hash, story});
				this.options.onPushed?.(story);
			} catch (error) {
				await this.fail(storyId, entry, error, options, story, hash);
			} finally {
				entry.inFlight = undefined;
			}
		};

		entry.inFlight = run();
		await entry.inFlight;
	}

	/**
	 * The patch to send instead of the whole story, or `undefined` for a PUT.
	 *
	 * Three ways to end up with a PUT, all of them fine: PATCH is switched off, this
	 * browser has never pushed this story, or the snapshot describes a state the record
	 * no longer claims. The last one is how a pull, a checkout or a publish invalidates a
	 * base without knowing snapshots exist.
	 */
	private patchFor(record: SyncRecord, story: Story): StoryPatch | undefined {
		if (!this.patchEnabled || !record.rev) {
			return undefined;
		}

		const base = usableSnapshot(record.snapshot, record.pushedHash);

		return base ? diffFromSnapshot(base, story) : undefined;
	}

	/**
	 * A sentence for the History dialog, or `''` for none.
	 *
	 * A stated `reason` beats the derived text, always: the gesture knows what it did and
	 * the bytes only know what moved. Absent one, this derives from the patch — including
	 * on the PUT path, where a base exists but PATCH is switched off, because a server
	 * without PATCH is not a reason for an author to lose their history labels.
	 *
	 * Derivation is best-effort by design. No base means no sentence and the row reads the
	 * way it reads today; it must never cost a write.
	 */
	private summaryFor(
		record: SyncRecord,
		story: Story,
		patch: StoryPatch | undefined,
		reason: SyncReason | undefined
	): string {
		if (reason) {
			return reasonSummary(reason);
		}

		const base = this.bases.get(record.storyId);

		if (!base || base.hash !== record.pushedHash) {
			return '';
		}

		const derived = patch ?? diffPassages(base.story, story);

		return derived ? patchSummary(derived, base.story) : '';
	}

	/**
	 * One write, as a PATCH when there is a base and a PUT otherwise.
	 *
	 * A PATCH that fails with anything but a conflict is retried ONCE as a whole PUT. If
	 * that works where the patch did not, this server — or a proxy, or a CORS preflight
	 * that refuses the method — does not do PATCH, and the queue stops trying for the
	 * session. A network outage fails both, so the flag survives a flaky connection:
	 * only a PUT that SUCCEEDS is evidence about the method rather than about the wire.
	 *
	 * A 412 is never retried as a PUT. It is a real precondition failure and a PUT with
	 * the same stale rev gets the same answer, but louder — it would overwrite if the
	 * rev were somehow accepted.
	 */
	private async send(
		story: Story,
		record: SyncRecord,
		patch: StoryPatch | undefined,
		options: {keepalive?: boolean},
		summary: string
	): Promise<PutStoryResponse> {
		const {client} = this.options;
		// Omitted rather than sent empty: `{keepalive}` is what every existing caller and
		// test sees, and an empty summary is the absence of one, not a blank label.
		const write = {
			keepalive: options.keepalive,
			...(summary ? {summary} : {})
		};

		if (!patch) {
			return client.putStory(story, record.rev || undefined, write);
		}

		try {
			const result = await client.patchStory(
				story.id,
				patch,
				record.rev,
				write
			);

			// The method works. Whatever the earlier failures were, they were about the
			// wire, so they stop counting towards switching PATCH off.
			this.patchFallbacks = 0;

			return result;
		} catch (error) {
			if (!patchMayBeUnsupported(error)) {
				throw error;
			}

			const result = await client.putStory(story, record.rev || undefined, write);

			this.patchFallbacks += 1;

			// A STATUS is an answer about the request, so one is enough to settle it.
			// A dropped connection is not: on a flaky link, the patch failing and the
			// retry getting through is an ordinary coincidence, and switching PATCH off
			// for it throws the size win away exactly when the network is bad — which is
			// when it matters. The only thing that tells a refused method from a blip is
			// whether it keeps happening, so an ambiguous failure has to repeat.
			if (
				saysPatchUnsupported(error) ||
				this.patchFallbacks >= MAX_PATCH_FALLBACKS
			) {
				this.patchEnabled = false;
			}

			logSync('push', 'patch refused, put instead', story.id, () => ({
				error: error instanceof Error ? error.message : String(error),
				fallbacks: this.patchFallbacks,
				patchDisabled: !this.patchEnabled
			}));

			return result;
		}
	}

	/**
	 * Push a merged story and, only if that lands on the server, put it in the store.
	 *
	 * A whole PUT on purpose. This is the rare path — a real 412 that turned out to be
	 * two people in different passages — and a patch here would need a second base (the
	 * server's copy) threaded out of the conflict check for no saving worth the surface.
	 *
	 * ORDER IS THE SAFETY. The server is written FIRST, so after this line the store
	 * holds both sides' work whatever happens next. If the local landing then fails, this
	 * browser is merely behind: the record keeps its old rev and hash, the story parks,
	 * and the author's existing Take Theirs hands them the merged copy. Recording the new
	 * rev before knowing the store took it is the `applyPull` bug with extra steps — the
	 * next patch would diff against a base the store never reached and remove the other
	 * person's passage.
	 */
	private async landMerge(
		storyId: string,
		entry: Pending,
		merged: Story,
		theirRev: number
	): Promise<void> {
		let rev: number;

		try {
			const result = await this.options.client.putStory(merged, theirRev);

			rev = result.rev;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			logSync('push', 'merge: push failed', storyId, () => ({
				error: message,
				theirRev
			}));
			clearTimers(entry);
			this.pending.delete(storyId);
			this.write(storyId, {
				conflictRev: isServerError(error) ? error.rev : theirRev,
				lastError: message,
				state: 'conflict'
			});

			return;
		}

		if (!this.options.onMerged?.(merged, rev)) {
			logSync('push', 'merge: pushed but did not land', storyId, () => ({rev}));
			clearTimers(entry);
			this.pending.delete(storyId);
			// No rev, no hash, no snapshot: this browser is behind the server, which is
			// the truth. Take Theirs now yields the merged copy, holding both sides.
			this.write(storyId, {
				conflictRev: rev,
				lastError:
					'Merged both copies on the server, but this editor could not take the result.',
				state: 'conflict'
			});

			return;
		}

		logSync('push', 'merge: landed', storyId, () => ({rev}));
		clearTimers(entry);
		this.pending.delete(storyId);
		this.write(storyId, {
			conflictClient: undefined,
			conflictRev: undefined,
			lastError: undefined,
			lastPushedAt: Date.now(),
			pullBlockedRev: undefined,
			pushedHash: storyHash(merged),
			rev,
			snapshot: snapshotStory(merged),
			state: 'idle'
		});
		this.bases.set(storyId, {hash: storyHash(merged), story: merged});
		this.options.onPushed?.(merged);
	}

	/**
	 * `story` and `hash` are what was actually SENT, which is not always `entry.story` —
	 * an edit can arrive mid-flight. A 412 has to be checked against the body the server
	 * refused, not against whatever the author has typed since.
	 */
	private async fail(
		storyId: string,
		entry: Pending,
		error: unknown,
		options: {keepalive?: boolean},
		story: Story,
		hash: string
	): Promise<void> {
		this.options.onError?.(storyId, error);

		const message = error instanceof Error ? error.message : String(error);

		if (isServerError(error) && error.conflict) {
			// A 412 says our `If-Match` was stale. That is a fact about this browser's
			// bookkeeping, not yet evidence of a disagreement: a push whose receipt was
			// lost — the tab-hide `keepalive` flush, a dropped response — leaves us
			// behind our OWN write, and the body we just sent may be the body already
			// stored. Ask before parking an author in a dialog with nothing in it.
			const outcome = await examineConflict({
				client: this.options.client,
				hash,
				local: story,
				// Merging is off unless somebody can land the result. See `onMerged`.
				merge: this.options.onMerged !== undefined,
				records: this.store
			});

			if (outcome.verdict === 'merged' && outcome.story && outcome.rev) {
				// The merge was computed from `story`. If the author typed while the
				// check was in flight, it describes text that is already out of date, so
				// it is thrown away rather than landed — landing it would overwrite the
				// keystrokes it does not contain. Retrying with the newer text hits the
				// same 412 and merges again; the cap is there so a fast typist ends up
				// parked rather than in a loop.
				if (entry.story !== story) {
					const attempts = (entry.mergeAttempts ?? 0) + 1;

					if (attempts <= MAX_MERGE_ATTEMPTS) {
						const latest = entry.story;

						logSync('push', 'merge: superseded, retrying', storyId, () => ({
							attempt: attempts
						}));
						clearTimers(entry);
						this.pending.delete(storyId);
						this.write(storyId, {state: 'dirty'});
						this.push(latest);
						// The count has to outlive the entry that carried it. `push` mints
						// a fresh `Pending`, so leaving it on the old one resets it to zero
						// every round and the cap never arrives — a typist who lands a
						// keystroke inside each round trip retries forever. Re-attaching
						// here rather than keeping a second map on the queue: the entry is
						// still the only thing that knows this story is mid-retry.
						const next = this.pending.get(storyId);

						if (next) {
							next.mergeAttempts = attempts;
						}

						return;
					}

					// Out of retries: fall through and park, which is what this story did
					// before merging existed.
				} else {
					await this.landMerge(storyId, entry, outcome.story, outcome.rev);

					return;
				}
			}

			if (outcome.verdict === 'resolved') {
				const latest = entry.story;

				clearTimers(entry);
				this.pending.delete(storyId);
				this.emit();

				// Whatever was typed while that push was in flight lost its debounce
				// timer along with the entry. The record is `idle` again, so this queues
				// normally — and is a no-op when nothing moved.
				if (latest !== story) {
					this.push(latest);
				}

				return;
			}

			// Park this story and only this story. The author's text is still in
			// localStorage and the server's version is still on the server; nothing has
			// been lost, and nothing more can be decided without a person.
			clearTimers(entry);
			this.pending.delete(storyId);
			this.write(storyId, {
				conflictClient: error.lastClient,
				conflictRev: error.rev,
				lastError: message,
				state: 'conflict'
			});
			return;
		}

		if (isServerError(error) && error.gone) {
			clearTimers(entry);
			this.pending.delete(storyId);
			this.write(storyId, {lastError: message, state: 'gone'});
			return;
		}

		const backoff = this.options.backoffMs ?? DEFAULT_BACKOFF_MS;
		const retryable = !isServerError(error) || error.retryable;

		if (!retryable || entry.attempt >= backoff.length) {
			// Out of tries. Stay parked until the next edit, which resets `attempt` —
			// hammering a server that has said no three times helps nobody.
			clearTimers(entry);
			this.pending.delete(storyId);
			this.write(storyId, {lastError: message, state: 'error'});
			return;
		}

		const delay = backoff[entry.attempt];

		entry.attempt += 1;
		entry.retryTimer = setTimeout(
			() => void this.flush(storyId, options),
			delay
		);
		this.write(storyId, {lastError: message, state: 'dirty'});
	}

	/** Forgets everything. Called when the client is reconfigured or the app unmounts. */
	dispose(): void {
		this.disposed = true;

		for (const entry of this.pending.values()) {
			clearTimers(entry);
		}

		this.pending.clear();
		this.bases.clear();
		this.listeners.clear();
	}

	private write(storyId: string, changes: Partial<SyncRecord>): SyncRecord {
		const record = this.store.update(storyId, changes);

		this.emit();

		return record;
	}

	private emit(): void {
		const records = this.store.all();

		for (const listener of this.listeners) {
			listener(records);
		}
	}
}

/**
 * Could this failure be the route not being there, rather than the patch being wrong?
 *
 * A conflict, a tombstone and a rejected token are all answers ABOUT THE STORY: the
 * server understood the request. Everything else — a 405 from an older build, a 400 from
 * a proxy that mangled the body, a browser refusing a CORS preflight for the method, a
 * dead connection — is indistinguishable from here, so the caller tries a plain PUT and
 * lets the RESULT decide.
 *
 * A 400 is also what a bug in the diff would produce. That also ends with PATCH switched
 * off and a log line, which is the right outcome for it too.
 */
function patchMayBeUnsupported(error: unknown): boolean {
	if (!isServerError(error)) {
		return false;
	}

	if (error.conflict || error.gone || error.unauthorized) {
		return false;
	}

	return error.network || error.status === 0 || saysPatchUnsupported(error);
}

/**
 * Did the SERVER answer, and say the method or the body was wrong?
 *
 * The narrower half of the question above, and the only half that settles anything on
 * its own. A status means the request arrived and was understood well enough to be
 * refused, so one is proof; a dead connection means nothing arrived, and looks the same
 * whether the route is missing or the wifi blinked.
 */
function saysPatchUnsupported(error: unknown): boolean {
	return (
		isServerError(error) &&
		(error.status === 400 ||
			error.status === 405 ||
			error.status === 415 ||
			error.status === 501)
	);
}

function clearTimers(entry: Pending): void {
	if (entry.debounceTimer) {
		clearTimeout(entry.debounceTimer);
		entry.debounceTimer = undefined;
	}

	if (entry.maxWaitTimer) {
		clearTimeout(entry.maxWaitTimer);
		entry.maxWaitTimer = undefined;
	}

	if (entry.retryTimer) {
		clearTimeout(entry.retryTimer);
		entry.retryTimer = undefined;
	}
}
