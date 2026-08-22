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

/** Merge into the existing record, minting one first if there is none. */
export function updateSyncRecord(
	storyId: string,
	changes: Partial<SyncRecord>
): SyncRecord {
	const updated: SyncRecord = {
		...syncRecordOrNew(storyId),
		...changes,
		storyId
	};

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
// Dirtiness
// ---------------------------------------------------------------------------

/**
 * Props that move without the author changing anything worth pushing.
 *
 * `lastUpdate` is in here for the reason spec 11 gives: it advances on trivial actions and
 * cannot survive two machines whose clocks disagree, so hashing it would mark a story
 * dirty forever. `selected` and `highlighted` are chrome.
 */
const ignoredStoryProps: string[] = [
	'highlighted',
	'lastUpdate',
	'selected',
	'sync'
];

const ignoredPassageProps: string[] = ['highlighted', 'selected'];

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

function hashable(story: Story): Record<string, unknown> {
	const copy: Record<string, unknown> = {...story};

	for (const prop of ignoredStoryProps) {
		delete copy[prop];
	}

	copy.passages = [...story.passages]
		.map(passage => {
			const item: Record<string, unknown> = {...passage};

			for (const prop of ignoredPassageProps) {
				delete item[prop];
			}

			return item;
		})
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
