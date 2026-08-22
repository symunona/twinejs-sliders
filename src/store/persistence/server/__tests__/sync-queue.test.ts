import {ServerError, type ServerClient} from '../client';
import {
	DEFAULT_BACKOFF_MS,
	DEFAULT_DEBOUNCE_MS,
	DEFAULT_MAX_WAIT_MS,
	SyncQueue
} from '../sync-queue';
import {
	resetSyncRecordsForTests,
	storyHash,
	syncRecord,
	updateSyncRecord
} from '../sync-record';
import {settle, storyWithText} from '../test-fixtures';
import type {Story} from '../../../stories';

let putStory: jest.Mock;
let client: ServerClient;
let queue: SyncQueue;
let rev = 0;

async function tick(ms: number) {
	jest.advanceTimersByTime(ms);
	await settle();
}

beforeEach(() => {
	jest.useFakeTimers();
	window.localStorage.clear();
	resetSyncRecordsForTests();
	rev = 0;
	putStory = jest.fn(async (story: Story) => ({
		bytes: 100,
		id: story.id,
		rev: ++rev,
		updatedAt: '2026-08-21T10:12:00.000Z'
	}));
	client = {putStory} as unknown as ServerClient;
	queue = new SyncQueue({client});
});

afterEach(() => {
	queue.dispose();
	jest.useRealTimers();
});

describe('debouncing', () => {
	it('coalesces a burst of edits into one PUT of the last version', async () => {
		for (let i = 0; i < 5; i++) {
			queue.push(storyWithText('s1', `text ${i}`));
			await tick(1000);
		}

		expect(putStory).not.toHaveBeenCalled();

		await tick(DEFAULT_DEBOUNCE_MS);

		expect(putStory).toHaveBeenCalledTimes(1);
		expect(putStory.mock.calls[0][0].passages[0].text).toBe('text 4');
	});

	it('sends no If-Match on the first push, and the known rev after', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(putStory.mock.calls[0][1]).toBeUndefined();

		queue.push(storyWithText('s1', 'two'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(putStory.mock.calls[1][1]).toBe(1);
	});

	it('fires on the max wait during continuous typing', async () => {
		for (let i = 0; i < 40; i++) {
			queue.push(storyWithText('s1', `word ${i}`));
			await tick(1000);
		}

		// 40 s of typing with no gap longer than one second: the debounce alone would
		// never have fired.
		expect(putStory).toHaveBeenCalledTimes(1);
		expect(putStory.mock.calls[0][0].passages[0].text).toBe('word 29');
	});

	it('does nothing when the story hashes the same as what was pushed', async () => {
		const story = storyWithText('s1', 'one');

		updateSyncRecord('s1', {pushedHash: storyHash(story), rev: 7});
		queue.push(story);
		await tick(DEFAULT_MAX_WAIT_MS);

		expect(putStory).not.toHaveBeenCalled();
	});

	it('reads its debounce from localStorage, which is what E2E sets', async () => {
		window.localStorage.setItem('sliders.sync.debounceMs', '50');
		queue.push(storyWithText('s1', 'one'));
		await tick(60);

		expect(putStory).toHaveBeenCalledTimes(1);
	});
});

describe('retrying', () => {
	beforeEach(() => {
		putStory.mockRejectedValue(
			new ServerError('offline', {code: 'internal', network: true, status: 0})
		);
	});

	it('backs off 5 s, 15 s, 60 s and then parks in error', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(putStory).toHaveBeenCalledTimes(1);
		expect(syncRecord('s1')?.state).toBe('dirty');

		for (const [index, delay] of DEFAULT_BACKOFF_MS.entries()) {
			await tick(delay - 1);
			expect(putStory).toHaveBeenCalledTimes(index + 1);

			await tick(1);
			expect(putStory).toHaveBeenCalledTimes(index + 2);
		}

		expect(syncRecord('s1')?.state).toBe('error');
		expect(syncRecord('s1')?.lastError).toBe('offline');

		// Parked. No fifth attempt, however long we wait.
		await tick(DEFAULT_BACKOFF_MS[2] * 10);
		expect(putStory).toHaveBeenCalledTimes(DEFAULT_BACKOFF_MS.length + 1);
	});

	it('starts over on the next edit', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);

		for (const delay of DEFAULT_BACKOFF_MS) {
			await tick(delay);
		}

		expect(syncRecord('s1')?.state).toBe('error');

		putStory.mockImplementation(async (story: Story) => ({
			bytes: 1,
			id: story.id,
			rev: 9,
			updatedAt: ''
		}));
		queue.push(storyWithText('s1', 'two'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(syncRecord('s1')?.state).toBe('idle');
		expect(syncRecord('s1')?.rev).toBe(9);
	});

	it('does not retry a failure the server chose', async () => {
		putStory.mockRejectedValue(
			new ServerError('too big', {code: 'too_large', status: 413})
		);
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);
		await tick(DEFAULT_BACKOFF_MS[0] * 2);

		expect(putStory).toHaveBeenCalledTimes(1);
		expect(syncRecord('s1')?.state).toBe('error');
	});
});

describe('parking', () => {
	it('parks only the conflicted story and lets the others keep saving', async () => {
		putStory.mockImplementation(async (story: Story) => {
			if (story.id === 's1') {
				throw new ServerError('conflict', {
					code: 'conflict',
					lastClient: 'mira',
					rev: 43,
					status: 412
				});
			}

			return {bytes: 1, id: story.id, rev: 7, updatedAt: ''};
		});

		queue.push(storyWithText('s1', 'mine'));
		queue.push(storyWithText('s2', 'other'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(syncRecord('s1')).toMatchObject({
			conflictClient: 'mira',
			conflictRev: 43,
			state: 'conflict'
		});
		expect(syncRecord('s2')).toMatchObject({rev: 7, state: 'idle'});

		// s1 stops trying until someone resolves it...
		queue.push(storyWithText('s1', 'mine again'));
		await tick(DEFAULT_MAX_WAIT_MS);
		expect(putStory).toHaveBeenCalledTimes(2);

		// ...while s2 goes on as if nothing happened.
		queue.push(storyWithText('s2', 'other again'));
		await tick(DEFAULT_DEBOUNCE_MS);
		expect(putStory).toHaveBeenCalledTimes(3);
		expect(syncRecord('s2')?.state).toBe('idle');
	});

	it('marks a tombstoned story gone rather than retrying it', async () => {
		putStory.mockRejectedValue(
			new ServerError('deleted', {code: 'deleted', status: 409})
		);
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);
		await tick(DEFAULT_BACKOFF_MS[0] * 2);

		expect(putStory).toHaveBeenCalledTimes(1);
		expect(syncRecord('s1')?.state).toBe('gone');
	});
});

describe('flushAll', () => {
	it('pushes everything waiting, with keepalive', async () => {
		queue.push(storyWithText('s1', 'one'));
		queue.push(storyWithText('s2', 'two'));

		await queue.flushAll({keepalive: true});

		expect(putStory).toHaveBeenCalledTimes(2);
		expect(putStory.mock.calls[0][2]).toEqual({keepalive: true});
	});
});

describe('onChange', () => {
	it('tells listeners about every state change', async () => {
		const listener = jest.fn();

		queue.onChange(listener);
		queue.push(storyWithText('s1', 'one'));

		expect(listener).toHaveBeenCalled();
		expect(listener.mock.calls[0][0].s1.state).toBe('dirty');

		listener.mockClear();
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(
			listener.mock.calls[listener.mock.calls.length - 1][0].s1.state
		).toBe('idle');
	});
});
