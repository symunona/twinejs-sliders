/**
 * The panel's side of `threads.ts`: which thread is open, and keeping it written down.
 *
 * Autosave is debounced because a talking model appends a row per sentence and a row per
 * tool call, and `JSON.stringify` of a 300-row transcript on every one of those is the
 * kind of cost that only shows up on someone else's laptop.
 */

import * as React from 'react';
import {
	deleteVoiceThread,
	newVoiceThread,
	saveVoiceThread,
	titleFor,
	voiceThreads
} from './threads';
import type {TranscriptRow, VoiceThread} from './voice.types';

/** Long enough that a burst of tool calls is one write, short enough to survive a crash. */
const SAVE_DEBOUNCE = 500;

export interface VoiceThreadsApi {
	/** The thread being written into. Never undefined — the panel always has one open. */
	current: VoiceThread;
	/** Forget a thread. The open one may be deleted; a fresh one takes its place. */
	remove(threadId: string): void;
	/** Start a fresh thread, banking whatever is in the open one. */
	start(): VoiceThread;
	/** Load a saved thread. Returns its rows, for `VoiceSession.restore`. */
	select(threadId: string): TranscriptRow[];
	/** Every saved thread for this story, newest first, plus the open one. */
	threads: VoiceThread[];
}

export function useVoiceThreads(
	storyId: string,
	rows: TranscriptRow[],
	tokens?: number
): VoiceThreadsApi {
	const [current, setCurrent] = React.useState<VoiceThread>(newVoiceThread);
	// Bumped on every write, so the list re-reads. The store is not reactive by itself and
	// making it so would mean a second copy of state that can disagree with localStorage.
	const [version, setVersion] = React.useState(0);
	const currentRef = React.useRef(current);
	const rowsRef = React.useRef(rows);
	const tokensRef = React.useRef(tokens);

	currentRef.current = current;
	rowsRef.current = rows;
	tokensRef.current = tokens;

	/** Write the open thread NOW. Used before anything that replaces it. */
	const flush = React.useCallback(() => {
		const open = currentRef.current;
		const saved: VoiceThread = {
			...open,
			rows: rowsRef.current,
			title: titleFor(rowsRef.current) ?? open.title,
			tokens: tokensRef.current ?? open.tokens,
			updatedAt: Date.now()
		};

		saveVoiceThread(storyId, saved);
		currentRef.current = saved;
		setVersion(value => value + 1);

		return saved;
	}, [storyId]);

	React.useEffect(() => {
		if (rows.length === 0) {
			return;
		}

		const timer = window.setTimeout(flush, SAVE_DEBOUNCE);

		return () => window.clearTimeout(timer);
	}, [flush, rows, tokens]);

	// The panel closing is the common way a session ends, and a debounced save loses the
	// last thing said. `flush` is stable, so this runs on unmount only.
	React.useEffect(() => () => void flush(), [flush]);

	const start = React.useCallback(() => {
		flush();

		const next = newVoiceThread();

		setCurrent(next);
		currentRef.current = next;

		return next;
	}, [flush]);

	const select = React.useCallback(
		(threadId: string) => {
			flush();

			const found = voiceThreads(storyId).find(
				thread => thread.id === threadId
			);

			if (!found) {
				return [];
			}

			setCurrent(found);
			currentRef.current = found;

			return found.rows;
		},
		[flush, storyId]
	);

	const remove = React.useCallback(
		(threadId: string) => {
			deleteVoiceThread(storyId, threadId);

			if (currentRef.current.id === threadId) {
				// Deleting the thread you are in empties the panel rather than leaving
				// rows on screen that no longer have anywhere to be saved.
				const next = newVoiceThread();

				setCurrent(next);
				currentRef.current = next;
			}

			setVersion(value => value + 1);
		},
		[storyId]
	);

	const threads = React.useMemo(() => {
		const saved = voiceThreads(storyId);

		// The open thread is not in the store until it has a row in it, and an author who
		// just hit New Thread should still see it selected in the list.
		return saved.some(thread => thread.id === current.id)
			? saved
			: [{...current, rows}, ...saved];
		// `version` is not read here. It is in the list because the store is not reactive:
		// bumping it is how a write tells this memo to go and look again.
	}, [current, rows, storyId, version]);

	return {current, remove, select, start, threads};
}
