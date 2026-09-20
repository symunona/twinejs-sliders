import {
	SYNC_LOG_LIMIT,
	clearSyncLog,
	installSyncLogDebugHook,
	logSync,
	onSyncLog,
	resetSyncLogForTests,
	setSyncLogEnabled,
	syncLog,
	syncLogEnabled,
	syncLogNotes
} from '../sync-log';

beforeEach(() => {
	resetSyncLogForTests();
});

describe('the sync log', () => {
	it('records nothing until it is turned on', () => {
		logSync('push', 'landed', 's1');

		expect(syncLog()).toEqual([]);

		setSyncLogEnabled(true);
		logSync('push', 'landed', 's1');

		expect(syncLogNotes()).toEqual(['landed']);
	});

	it('never builds a detail object while it is off', () => {
		const detail = jest.fn(() => ({rev: 1}));

		logSync('push', 'landed', 's1', detail);
		expect(detail).not.toHaveBeenCalled();

		setSyncLogEnabled(true);
		logSync('push', 'landed', 's1', detail);
		expect(detail).toHaveBeenCalledTimes(1);
	});

	it('reports the previous setting so a test can put it back', () => {
		expect(setSyncLogEnabled(true)).toBe(false);
		expect(setSyncLogEnabled(false)).toBe(true);
		expect(syncLogEnabled()).toBe(false);
	});

	it('filters by story and by event', () => {
		setSyncLogEnabled(true);
		logSync('push', 'landed', 's1');
		logSync('pull', 'landed', 's2');
		logSync('push', '412', 's2');

		expect(syncLogNotes({storyId: 's2'})).toEqual(['landed', '412']);
		expect(syncLogNotes({event: 'push'})).toEqual(['landed', '412']);
		expect(syncLogNotes({event: 'push', storyId: 's2'})).toEqual(['412']);
	});

	it('keeps the newest entries and drops the oldest', () => {
		setSyncLogEnabled(true);

		for (let i = 0; i < SYNC_LOG_LIMIT + 10; i++) {
			logSync('push', `n${i}`, 's1');
		}

		const notes = syncLogNotes();

		expect(notes).toHaveLength(SYNC_LOG_LIMIT);
		expect(notes[0]).toBe('n10');
		expect(notes[notes.length - 1]).toBe(`n${SYNC_LOG_LIMIT + 9}`);
	});

	it('hands out a copy, so a caller cannot edit the buffer', () => {
		setSyncLogEnabled(true);
		logSync('push', 'landed', 's1');

		syncLog().push({at: 0, event: 'error', note: 'injected'});

		expect(syncLogNotes()).toEqual(['landed']);
	});

	it('notifies listeners and stops on unsubscribe', () => {
		setSyncLogEnabled(true);

		const seen: string[] = [];
		const off = onSyncLog(entry => seen.push(entry.note));

		logSync('push', 'one', 's1');
		off();
		logSync('push', 'two', 's1');

		expect(seen).toEqual(['one']);
	});

	it('clears entries without forgetting it is enabled', () => {
		setSyncLogEnabled(true);
		logSync('push', 'landed', 's1');
		clearSyncLog();

		expect(syncLog()).toEqual([]);
		expect(syncLogEnabled()).toBe(true);
	});

	it('omits storyId and detail rather than writing undefined', () => {
		setSyncLogEnabled(true);
		logSync('socket', 'connected');

		const [entry] = syncLog();

		expect(Object.keys(entry).sort()).toEqual(['at', 'event', 'note']);
	});

	describe('the debug hook', () => {
		it('starts disarmed and can be armed from the console', () => {
			const target: Record<string, unknown> = {};

			installSyncLogDebugHook(target);

			const hook = target.__slidersSyncLog as {
				(): unknown[];
				enable(): void;
				enabled(): boolean;
				notes(): string[];
				clear(): void;
			};

			expect(hook.enabled()).toBe(false);

			hook.enable();
			logSync('push', 'landed', 's1');

			expect(hook.notes()).toEqual(['landed']);
			expect(hook()).toHaveLength(1);

			hook.clear();
			expect(hook()).toEqual([]);
		});
	});
});
