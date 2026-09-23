import {
	MAX_THREADS,
	MAX_THREAD_ROWS,
	VOICE_THREADS_KEY,
	deleteVoiceThread,
	newVoiceThread,
	resetVoiceThreadsForTests,
	saveVoiceThread,
	titleFor,
	voiceThread,
	voiceThreads
} from '../threads';
import type {TranscriptRow, VoiceThread} from '../voice.types';

function row(
	overrides: Partial<TranscriptRow> & Pick<TranscriptRow, 'kind' | 'text'>
): TranscriptRow {
	return {at: 1_700_000_000_000, id: `row-${Math.random()}`, ...overrides};
}

function thread(overrides: Partial<VoiceThread> = {}): VoiceThread {
	return {...newVoiceThread(), rows: [row({kind: 'user', text: 'hello'})], ...overrides};
}

beforeEach(() => {
	window.localStorage.clear();
	// The module cache outlives a `clear()` — without this every test after the first
	// reads the one before it.
	resetVoiceThreadsForTests();
});

describe('titleFor', () => {
	it('takes the first thing the author said', () => {
		expect(
			titleFor([
				row({kind: 'system', text: 'connected'}),
				row({kind: 'user', text: 'move Mira left'}),
				row({kind: 'user', text: 'and give her the lamp'})
			])
		).toBe('move Mira left');
	});

	it('collapses whitespace and truncates', () => {
		expect(titleFor([row({kind: 'user', text: `a${'b'.repeat(80)}`})])).toHaveLength(
			60
		);
		expect(titleFor([row({kind: 'user', text: ' two   words '})])).toBe('two words');
	});

	it('has nothing to say about a thread the author has not spoken in', () => {
		expect(titleFor([])).toBeUndefined();
		expect(titleFor([row({kind: 'model', text: 'hello?'})])).toBeUndefined();
		expect(titleFor([row({kind: 'user', text: '   '})])).toBeUndefined();
	});
});

describe('saveVoiceThread', () => {
	it('round-trips a thread', () => {
		const saved = thread();

		saveVoiceThread('story-1', saved);
		resetVoiceThreadsForTests();

		expect(voiceThread('story-1', saved.id)?.rows).toEqual(saved.rows);
	});

	it('titles the thread from its rows', () => {
		const saved = thread({rows: [row({kind: 'user', text: 'move Mira left'})]});

		saveVoiceThread('story-1', saved);

		expect(voiceThread('story-1', saved.id)?.title).toBe('move Mira left');
	});

	it('keeps stories apart', () => {
		const one = thread();
		const two = thread();

		saveVoiceThread('story-1', one);
		saveVoiceThread('story-2', two);

		expect(voiceThreads('story-1').map(entry => entry.id)).toEqual([one.id]);
		expect(voiceThreads('story-2').map(entry => entry.id)).toEqual([two.id]);
	});

	it('moves an updated thread to the top rather than duplicating it', () => {
		const first = thread();
		const second = thread();

		saveVoiceThread('story-1', first);
		saveVoiceThread('story-1', second);
		saveVoiceThread('story-1', {...first, rows: [row({kind: 'user', text: 'more'})]});

		expect(voiceThreads('story-1').map(entry => entry.id)).toEqual([
			first.id,
			second.id
		]);
	});

	it('never stores an empty thread — the panel mints one just by opening', () => {
		saveVoiceThread('story-1', thread({rows: []}));

		expect(voiceThreads('story-1')).toEqual([]);
	});

	it('drops an empty thread that used to have rows', () => {
		const saved = thread();

		saveVoiceThread('story-1', saved);
		saveVoiceThread('story-1', {...saved, rows: []});

		expect(voiceThreads('story-1')).toEqual([]);
	});

	it('caps rows per thread, keeping the newest', () => {
		const rows = Array.from({length: MAX_THREAD_ROWS + 10}, (_unused, index) =>
			row({kind: 'user', text: `line ${index}`})
		);

		saveVoiceThread('story-1', thread({rows}));

		const stored = voiceThreads('story-1')[0];

		expect(stored.rows).toHaveLength(MAX_THREAD_ROWS);
		expect(stored.rows[stored.rows.length - 1].text).toBe(
			`line ${MAX_THREAD_ROWS + 9}`
		);
	});

	it('caps threads per story, dropping the oldest', () => {
		const ids: string[] = [];

		for (let index = 0; index < MAX_THREADS + 3; index++) {
			const saved = thread();

			ids.push(saved.id);
			saveVoiceThread('story-1', saved);
		}

		const stored = voiceThreads('story-1');

		expect(stored).toHaveLength(MAX_THREADS);
		expect(stored[0].id).toBe(ids[ids.length - 1]);
		expect(stored.map(entry => entry.id)).not.toContain(ids[0]);
	});
});

describe('deleteVoiceThread', () => {
	it('removes one and leaves the rest', () => {
		const one = thread();
		const two = thread();

		saveVoiceThread('story-1', one);
		saveVoiceThread('story-1', two);
		deleteVoiceThread('story-1', one.id);
		resetVoiceThreadsForTests();

		expect(voiceThreads('story-1').map(entry => entry.id)).toEqual([two.id]);
	});

	it('shrugs at an id that is not there', () => {
		const saved = thread();

		saveVoiceThread('story-1', saved);
		deleteVoiceThread('story-1', 'nope');

		expect(voiceThreads('story-1')).toHaveLength(1);
	});
});

describe('bad storage', () => {
	it('treats a corrupt table as empty rather than failing the panel open', () => {
		window.localStorage.setItem(VOICE_THREADS_KEY, 'not json');
		resetVoiceThreadsForTests();

		expect(voiceThreads('story-1')).toEqual([]);
	});

	it('treats an array as empty — it is a table, not a list', () => {
		window.localStorage.setItem(VOICE_THREADS_KEY, '[]');
		resetVoiceThreadsForTests();

		expect(voiceThreads('story-1')).toEqual([]);
	});

	it('keeps the session working when the write throws', () => {
		const setItem = jest
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(() => {
				throw new Error('QuotaExceededError');
			});

		try {
			const saved = thread();

			expect(() => saveVoiceThread('story-1', saved)).not.toThrow();
			// The cache still holds it, so the conversation in front of the author is
			// intact. It just will not be there tomorrow.
			expect(voiceThread('story-1', saved.id)).toBeDefined();
		} finally {
			setItem.mockRestore();
		}
	});
});
