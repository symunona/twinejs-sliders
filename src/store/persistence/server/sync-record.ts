/**
 * The local side table: one small record per story saying what this browser last saw on
 * the server (spec 11).
 *
 * Deliberately not a `Story` prop. It is bookkeeping about a story, it changes on every
 * push, and putting it on the story would drag it through undo, archive and export — the
 * three places it means nothing.
 *
 * One JSON object under one key, loaded once and cached: `localStorage` is synchronous,
 * and re-parsing it on every keystroke of an autosave check is the kind of cost that only
 * shows up on someone else's laptop.
 */

import type {Story} from '../../stories';
import {newSyncRecord, type SyncRecord} from './server.types';
import {logSync} from './sync-log';

export const SYNC_RECORDS_KEY = 'twine-server-sync';

export type SyncRecords = Record<string, SyncRecord>;

let cache: SyncRecords | undefined;

function storage(): Storage | undefined {
	try {
		return globalThis.localStorage;
	} catch {
		// Safari with cookies disabled throws on the property itself.
		return undefined;
	}
}

function load(): SyncRecords {
	if (cache) {
		return cache;
	}

	const raw = storage()?.getItem(SYNC_RECORDS_KEY);

	if (!raw) {
		cache = {};
		return cache;
	}

	try {
		const parsed = JSON.parse(raw) as SyncRecords;

		cache = parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		// A corrupt table is not worth failing a boot over: the worst it costs is one
		// extra push per story, which the hash check then makes a no-op.
		cache = {};
	}

	return cache;
}

function persist(records: SyncRecords): void {
	cache = records;

	try {
		storage()?.setItem(SYNC_RECORDS_KEY, JSON.stringify(records));
	} catch {
		// Out of quota, private mode, or no storage at all. Sync still works this
		// session; it just forgets what it saw on the next one.
	}
}

/** Every record, keyed by story id. Treat as read-only. */
export function allSyncRecords(): SyncRecords {
	return load();
}

export function syncRecord(storyId: string): SyncRecord | undefined {
	return load()[storyId];
}

/** The record for a story, minted at defaults when this browser has never seen it. */
export function syncRecordOrNew(storyId: string): SyncRecord {
	return load()[storyId] ?? newSyncRecord(storyId);
}

export function setSyncRecord(record: SyncRecord): void {
	persist({...load(), [record.storyId]: record});
}

/**
 * A rev only ever goes UP.
 *
 * `rev` is the server's write counter, and several paths write it — a push receipt, a
 * pull, a socket message, publish, checkout, resolve. They do not take turns: `applyPull`
 * (`use-server-sync.ts`) writes the rev it fetched unconditionally, so a pull that was in
 * flight when a push landed puts the OLDER number back and the next push goes out with a
 * stale `If-Match`. That is the same one-behind signature as the keepalive bug in
 * `docs/sliders/bugs/rev-lag.md`, arrived at a different way.
 *
 * Applied in `merge()` below, so every writer gets it — the module functions, the
 * `localStorage` store and the memory store alike.
 *
 * THE ESCAPE IS `remove()` THEN WRITE, never a silent exception. Two callers legitimately
 * throw this browser's bookkeeping away, and both say so out loud: `publish()`, which
 * claims `rev: 0` before a PUT carrying no `If-Match`, and `checkoutStory()`, which takes
 * the server's copy wholesale and may be looking at a different backend's rev sequence.
 * Anything ELSE lowering a rev is the bug this guard exists to catch, which is why a
 * refused write is logged rather than passed over.
 */
function merge(
	previous: SyncRecord,
	changes: Partial<SyncRecord>
): SyncRecord {
	const merged: SyncRecord = {
		...previous,
		...changes,
		storyId: previous.storyId
	};

	if (changes.rev !== undefined && changes.rev < previous.rev) {
		logSync('record', 'rev not lowered', previous.storyId, () => ({
			kept: previous.rev,
			refused: changes.rev
		}));
		merged.rev = previous.rev;
	}

	return merged;
}

/** Merge into the existing record, minting one first if there is none. */
export function updateSyncRecord(
	storyId: string,
	changes: Partial<SyncRecord>
): SyncRecord {
	const updated = merge(syncRecordOrNew(storyId), changes);

	setSyncRecord(updated);

	return updated;
}

export function deleteSyncRecord(storyId: string): void {
	const records = {...load()};

	delete records[storyId];
	persist(records);
}

/** Tests only. The cache outlives a `localStorage.clear()` otherwise. */
export function resetSyncRecordsForTests(): void {
	cache = undefined;
}

// ---------------------------------------------------------------------------
// The record store as a seam
// ---------------------------------------------------------------------------

/**
 * Where sync bookkeeping lives, as an interface rather than a module singleton.
 *
 * The functions above ARE the app's store, and they read `localStorage` through a
 * process-wide cache. That is right for the app and wrong for a test: two simulated
 * clients in one jest process would share one set of records and quietly agree about a
 * rev they should be arguing over. Every unit that keeps bookkeeping takes one of these
 * instead, so a test can hand each client its own.
 *
 * Deliberately the narrow four operations the sync path actually performs. A wider
 * interface would be a second copy of the module surface, which is the thing this exists
 * to stop needing.
 */
export interface SyncRecordStore {
	/** Every record, keyed by story id. Treat as read-only. */
	all(): SyncRecords;
	/** The record for a story, minted at defaults when there is none. */
	get(storyId: string): SyncRecord;
	/** Merge into the existing record, minting one first if there is none. */
	update(storyId: string, changes: Partial<SyncRecord>): SyncRecord;
	remove(storyId: string): void;
}

/** The app's store: one JSON blob in `localStorage`, cached. */
export function localSyncRecordStore(): SyncRecordStore {
	return {
		all: allSyncRecords,
		get: syncRecordOrNew,
		remove: deleteSyncRecord,
		update: updateSyncRecord
	};
}

/**
 * An isolated store with no `localStorage` behind it.
 *
 * For tests, and for any future second client in one process. `seed` is taken by value,
 * so a caller cannot mutate the store's contents from the outside afterwards.
 */
export function memorySyncRecordStore(
	seed: SyncRecords = {}
): SyncRecordStore {
	let records: SyncRecords = {...seed};

	return {
		all: () => ({...records}),
		get: storyId => records[storyId] ?? newSyncRecord(storyId),
		remove(storyId) {
			const next = {...records};

			delete next[storyId];
			records = next;
		},
		update(storyId, changes) {
			const updated = merge(
				records[storyId] ?? newSyncRecord(storyId),
				changes
			);

			records = {...records, [storyId]: updated};

			return updated;
		}
	};
}

// ---------------------------------------------------------------------------
// Dirtiness
// ---------------------------------------------------------------------------

/**
 * JSON with the keys in a fixed order, so two structurally equal stories hash the same
 * however their objects were built up.
 */
function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') {
		return JSON.stringify(value) ?? 'null';
	}

	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(',')}]`;
	}

	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

	return `{${entries
		.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
		.join(',')}}`;
}

/**
 * What "changed" means, as an ALLOWLIST.
 *
 * This was a denylist — everything hashed unless named — and that is the wrong default
 * for a type the editor keeps adding fields to. Two view-only props had already slipped
 * in: `zoom` and `snapToGrid` are how THIS browser looks at the map, and hashing them
 * meant that scrolling a story marked it dirty. An author who only ever zoomed then
 * counted as having edited, so an incoming change from somebody else came out of
 * `reconcileDecision` as `conflict` rather than `pull` — a conflict dialog over a story
 * they had not typed a word into.
 *
 * Inverted, a new `Story` field is view state until someone lists it here, and the
 * failure mode of forgetting is "my edit did not sync" — loud, reported in minutes —
 * rather than "everything conflicts", which is silent and blames the other person.
 *
 * Passage geometry IS content: the map layout is authored and shared. `selected` and
 * `highlighted` are not.
 *
 * Changing this set changes every stored `pushedHash`, so every synced story reads dirty
 * exactly once after this ships and pushes once. Self-healing, and cheaper than leaving
 * false conflicts in.
 */
const hashedStoryProps = [
	'ifid',
	'name',
	'script',
	'startPassage',
	'storyFormat',
	'storyFormatVersion',
	'stylesheet',
	'tagColors',
	'tags'
] as const;

const hashedPassageProps = [
	'height',
	'id',
	'left',
	'name',
	'tags',
	'text',
	'top',
	'width'
] as const;

function pick(
	source: Record<string, unknown>,
	keys: readonly string[]
): Record<string, unknown> {
	const out: Record<string, unknown> = {};

	for (const key of keys) {
		if (source[key] !== undefined) {
			out[key] = source[key];
		}
	}

	return out;
}

function hashable(story: Story): Record<string, unknown> {
	const copy = pick(
		story as unknown as Record<string, unknown>,
		hashedStoryProps
	);

	copy.passages = [...story.passages]
		.map(passage =>
			pick(passage as unknown as Record<string, unknown>, hashedPassageProps)
		)
		// Passage order in the array is not meaningful — a rename can reshuffle it — so
		// sorting keeps a no-op reorder from reading as an edit.
		.sort((a, b) => String(a.id).localeCompare(String(b.id)));

	return copy;
}

/**
 * FNV-1a, run twice with different offset bases and concatenated: 64 bits of hash for two
 * cheap passes over a string. Not a checksum anyone else has to reproduce — the server
 * never sees it — so speed beats cryptographic anything.
 */
export function fnv1a(text: string): string {
	let a = 0x811c9dc5;
	let b = 0x01000193;

	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);

		a ^= code;
		a = Math.imul(a, 0x01000193) >>> 0;
		b ^= code;
		b = Math.imul(b, 0x85ebca6b) >>> 0;
	}

	return (
		(a >>> 0).toString(16).padStart(8, '0') +
		(b >>> 0).toString(16).padStart(8, '0')
	);
}

/**
 * A cheap stable hash of everything about a story worth pushing.
 *
 * This, not `lastUpdate`, is what "dirty" means here.
 */
export function storyHash(story: Story): string {
	return fnv1a(stableStringify(hashable(story)));
}

/** Has this story changed since the last thing this browser pushed or pulled? */
export function isStoryDirty(
	story: Story,
	record: SyncRecord | undefined = syncRecord(story.id)
): boolean {
	return storyHash(story) !== record?.pushedHash;
}
