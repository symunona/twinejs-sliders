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
import {
	allSyncRecords,
	storyHash,
	syncRecordOrNew,
	updateSyncRecord,
	type SyncRecords
} from './sync-record';
import type {SyncRecord} from './server.types';

/** Spec 11: debounce 5 s, max wait 30 s, backoff 5 → 15 → 60. */
export const DEFAULT_DEBOUNCE_MS = 5000;
export const DEFAULT_MAX_WAIT_MS = 30000;
export const DEFAULT_BACKOFF_MS = [5000, 15000, 60000];

/** E2E sets this to 50 so the suite does not sit through a five second debounce. */
export const DEBOUNCE_PREF_KEY = 'sliders.sync.debounceMs';

export interface SyncQueueOptions {
	client: ServerClient;
	debounceMs?: number;
	maxWaitMs?: number;
	backoffMs?: number[];
	/** Called after every state change, before listeners. Used by the hook to log. */
	onError?: (storyId: string, error: unknown) => void;
}

interface Pending {
	story: Story;
	debounceTimer?: ReturnType<typeof setTimeout>;
	maxWaitTimer?: ReturnType<typeof setTimeout>;
	retryTimer?: ReturnType<typeof setTimeout>;
	/** How many pushes have already failed with something retryable. */
	attempt: number;
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
	private readonly listeners = new Set<(records: SyncRecords) => void>();
	private disposed = false;

	constructor(options: SyncQueueOptions) {
		this.options = options;
	}

	/** Current side table. Same object the module-level readers see. */
	get records(): SyncRecords {
		return allSyncRecords();
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
	push(story: Story): void {
		if (this.disposed) {
			return;
		}

		const record = syncRecordOrNew(story.id);

		if (record.state === 'conflict' || record.state === 'gone') {
			return;
		}

		if (storyHash(story) === record.pushedHash) {
			return;
		}

		const debounceMs =
			debounceOverride() ?? this.options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
		const maxWaitMs = this.options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
		const existing = this.pending.get(story.id);

		if (existing) {
			existing.story = story;
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

		const entry: Pending = {attempt: 0, story};

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
		const record = syncRecordOrNew(storyId);
		const hash = storyHash(story);

		this.write(storyId, {state: 'pushing'});

		const run = async () => {
			try {
				const result = await this.options.client.putStory(
					story,
					record.rev || undefined,
					{keepalive: options.keepalive}
				);

				// An edit that arrived mid-flight left its own debounce timer on this
				// entry. Dropping the entry would drop that timer with it, and the
				// author's last sentence would sit unsaved until they typed again.
				const superseded = entry.story !== story;

				if (!superseded) {
					this.pending.delete(storyId);
				}

				this.write(storyId, {
					conflictClient: undefined,
					conflictRev: undefined,
					lastError: undefined,
					lastPushedAt: Date.now(),
					pushedHash: hash,
					rev: result.rev,
					state: superseded ? 'dirty' : 'idle'
				});
			} catch (error) {
				this.fail(storyId, entry, error, options);
			} finally {
				entry.inFlight = undefined;
			}
		};

		entry.inFlight = run();
		await entry.inFlight;
	}

	private fail(
		storyId: string,
		entry: Pending,
		error: unknown,
		options: {keepalive?: boolean}
	): void {
		this.options.onError?.(storyId, error);

		const message = error instanceof Error ? error.message : String(error);

		if (isServerError(error) && error.conflict) {
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
		this.listeners.clear();
	}

	private write(storyId: string, changes: Partial<SyncRecord>): SyncRecord {
		const record = updateSyncRecord(storyId, changes);

		this.emit();

		return record;
	}

	private emit(): void {
		const records = allSyncRecords();

		for (const listener of this.listeners) {
			listener(records);
		}
	}
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
