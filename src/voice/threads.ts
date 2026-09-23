/**
 * Voice chat threads: what the author said, what the model said, and what it called, kept
 * per story across reloads.
 *
 * Deliberately not a `Story` prop and deliberately not synced. A transcript is a record of
 * a conversation about the story, not part of it — putting it on the story would drag it
 * through undo, archive, export and the sync wire, four places where it means nothing and
 * one where it would collide with a peer's transcript.
 *
 * Shaped exactly like `store/persistence/server/sync-record.ts`: one JSON object under one
 * key, loaded once and cached, because `localStorage` is synchronous and this is read on
 * every append.
 *
 * It is also the first blob here that grows without bound — a session talks for an hour.
 * Hence both caps below. They are the quota defence, not tidiness.
 */

import {v4 as uuid} from '@lukeed/uuid';
import type {TranscriptRow, VoiceThread} from './voice.types';

export const VOICE_THREADS_KEY = 'sliders-voice-threads';

/** Threads kept per story. Oldest falls off the end. */
export const MAX_THREADS = 20;

/** Rows kept per thread. Matches the in-memory cap in `use-voice-session.ts`. */
export const MAX_THREAD_ROWS = 300;

/** Thread title length. Long enough to tell two sessions apart in a popover. */
const TITLE_LENGTH = 60;

export type VoiceThreads = Record<string, VoiceThread[]>;

let cache: VoiceThreads | undefined;

function storage(): Storage | undefined {
	try {
		return globalThis.localStorage;
	} catch {
		// Safari with cookies disabled throws on the property itself.
		return undefined;
	}
}

function load(): VoiceThreads {
	if (cache) {
		return cache;
	}

	const raw = storage()?.getItem(VOICE_THREADS_KEY);

	if (!raw) {
		cache = {};
		return cache;
	}

	try {
		const parsed = JSON.parse(raw) as VoiceThreads;

		cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
	} catch {
		// A corrupt table costs the author their old transcripts, which is bad, and
		// failing the panel to open costs them the feature, which is worse.
		cache = {};
	}

	return cache;
}

function persist(threads: VoiceThreads): void {
	cache = threads;

	try {
		storage()?.setItem(VOICE_THREADS_KEY, JSON.stringify(threads));
	} catch {
		// Out of quota, private mode, or no storage at all. The session in front of the
		// author keeps working; it just will not be there tomorrow.
	}
}

/** The first thing the author said, which is what they will look for in the list. */
export function titleFor(rows: TranscriptRow[]): string | undefined {
	const first = rows.find(row => row.kind === 'user' && row.text.trim() !== '');

	if (!first) {
		return undefined;
	}

	const text = first.text.trim().replace(/\s+/g, ' ');

	return text.length > TITLE_LENGTH
		? `${text.slice(0, TITLE_LENGTH - 1)}…`
		: text;
}

export function newVoiceThread(): VoiceThread {
	const at = Date.now();

	return {createdAt: at, id: uuid(), rows: [], updatedAt: at};
}

/** Every thread for one story, newest first. Treat as read-only. */
export function voiceThreads(storyId: string): VoiceThread[] {
	return load()[storyId] ?? [];
}

export function voiceThread(
	storyId: string,
	threadId: string
): VoiceThread | undefined {
	return voiceThreads(storyId).find(thread => thread.id === threadId);
}

/**
 * Write one thread back, newest first.
 *
 * An empty thread is never stored. The panel mints one the moment it opens, and an author
 * who opened it to look at an old conversation should not find a blank entry above it.
 */
export function saveVoiceThread(storyId: string, thread: VoiceThread): void {
	const threads = load();
	const rest = (threads[storyId] ?? []).filter(other => other.id !== thread.id);

	if (thread.rows.length === 0) {
		persist({...threads, [storyId]: rest});
		return;
	}

	const trimmed: VoiceThread = {
		...thread,
		rows: thread.rows.slice(-MAX_THREAD_ROWS),
		title: thread.title ?? titleFor(thread.rows)
	};

	persist({
		...threads,
		[storyId]: [trimmed, ...rest].slice(0, MAX_THREADS)
	});
}

export function deleteVoiceThread(storyId: string, threadId: string): void {
	const threads = load();
	const kept = (threads[storyId] ?? []).filter(thread => thread.id !== threadId);

	persist({...threads, [storyId]: kept});
}

/**
 * Test seam. Drops the in-memory cache, which outlives a `localStorage.clear()` — the same
 * trap `resetSyncRecordsForTests` exists for.
 */
export function resetVoiceThreadsForTests(): void {
	cache = undefined;
}
