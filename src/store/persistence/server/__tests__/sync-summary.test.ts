/**
 * The summary on its way out: derived, overridden, or absent.
 *
 * Separate from `patch-summary.test.ts`, which owns the WORDS against the real locale
 * file. Here `t()` is the suite-wide mock from `setupTests.ts` and answers with its own
 * key, which is what these assertions want: `store.patchSummary.edited` against
 * `store.patchSummary.reason.findReplace` says which branch ran without any of this
 * depending on English.
 */

import {type ServerClient} from '../client';
import {DEFAULT_DEBOUNCE_MS, SyncQueue} from '../sync-queue';
import {clearSyncReasons, noteSyncReason, peekSyncReason} from '../sync-reason';
import {resetSyncRecordsForTests} from '../sync-record';
import {settle, storyWithText, testPassage, testStory} from '../test-fixtures';
import {importStories} from '../../../stories/action-creators/import-stories';
import {replaceInStory} from '../../../stories/action-creators/find-replace';
import type {Story} from '../../../stories';

let putStory: jest.Mock;
let patchStory: jest.Mock;
let client: ServerClient;
let queue: SyncQueue;
let rev = 0;
/** Write options, both verbs, in the order they went out. */
let writes: {keepalive?: boolean; summary?: string}[] = [];

async function tick(ms: number) {
	jest.advanceTimersByTime(ms);
	await settle();
}

function makeQueue(options: {patch?: boolean} = {}) {
	return new SyncQueue({client, ...options});
}

/**
 * The `summary` the queue put in the options of the last write of EITHER verb.
 *
 * Recorded in order by the mocks rather than read off `mock.calls`: a story's first push
 * is a PUT and everything after it a PATCH, so reading one list then the other answers
 * with the wrong write.
 */
function lastSummary(): string | undefined {
	return writes[writes.length - 1]?.summary;
}

beforeEach(() => {
	jest.useFakeTimers();
	window.localStorage.clear();
	resetSyncRecordsForTests();
	clearSyncReasons();
	rev = 0;
	writes = [];
	putStory = jest.fn(
		async (story: Story, ifMatch?: number, options = {}) => {
			writes.push(options);

			return {
				bytes: 100,
				id: story.id,
				rev: ++rev,
				updatedAt: '2026-09-22T10:12:00.000Z'
			};
		}
	);
	patchStory = jest.fn(
		async (id: string, patch: unknown, ifMatch: number, options = {}) => {
			writes.push(options);

			return {
				bytes: 20,
				id,
				rev: ++rev,
				updatedAt: '2026-09-22T10:12:00.000Z'
			};
		}
	);
	client = {patchStory, putStory} as unknown as ServerClient;
	queue = makeQueue();
});

afterEach(() => {
	queue.dispose();
	clearSyncReasons();
	jest.useRealTimers();
});

describe('summary on the wire', () => {
	it('says nothing on the first push, which has no base to compare against', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(putStory).toHaveBeenCalledTimes(1);
		expect(lastSummary()).toBeUndefined();
	});

	it('derives one for the PATCH after it', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);
		queue.push(storyWithText('s1', 'two'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(patchStory).toHaveBeenCalledTimes(1);
		expect(lastSummary()).toBe('store.patchSummary.edited');
	});

	it('derives one on the PUT path too, when patching is switched off', async () => {
		queue.dispose();
		queue = makeQueue({patch: false});
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);
		queue.push(storyWithText('s1', 'two'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(patchStory).not.toHaveBeenCalled();
		expect(putStory).toHaveBeenCalledTimes(2);
		expect(lastSummary()).toBe('store.patchSummary.edited');
	});

	it('leaves the rest of the write options alone', async () => {
		queue.push(storyWithText('s1', 'one'));
		await queue.flushAll({keepalive: true});

		expect(putStory.mock.calls[0][2]).toEqual({keepalive: true});
	});

	it('writes nothing at all when nothing changed', async () => {
		const story = storyWithText('s1', 'one');

		queue.push(story);
		await tick(DEFAULT_DEBOUNCE_MS);
		putStory.mockClear();
		patchStory.mockClear();

		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(putStory).not.toHaveBeenCalled();
		expect(patchStory).not.toHaveBeenCalled();
	});
});

describe('reason override', () => {
	it('beats the derived text', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);

		noteSyncReason('s1', 'find-replace');
		queue.push(storyWithText('s1', 'two'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(lastSummary()).toBe('store.patchSummary.reason.findReplace');
	});

	it('is taken as an argument as well as off the table', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);

		queue.push(storyWithText('s1', 'two'), {reason: 'voice:patch_scene'});
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(lastSummary()).toBe('store.patchSummary.reason.voice');
	});

	it('labels the whole debounce window, not just the push that found the note', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);

		// One gesture, many dispatches: the note is consumed by the first push and the
		// rest of the burst must not wipe it.
		noteSyncReason('s1', 'find-replace');
		queue.push(storyWithText('s1', 'two'));
		await tick(1000);
		queue.push(storyWithText('s1', 'three'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(patchStory).toHaveBeenCalledTimes(1);
		expect(lastSummary()).toBe('store.patchSummary.reason.findReplace');
	});

	it('labels one save, and the next one derives again', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);

		noteSyncReason('s1', 'import');
		queue.push(storyWithText('s1', 'two'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(lastSummary()).toBe('store.patchSummary.reason.import');

		queue.push(storyWithText('s1', 'three'));
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(lastSummary()).toBe('store.patchSummary.edited');
	});

	it('keeps a note the push did not use', async () => {
		// Nothing moved since the last save, so `push` returns before taking anything and
		// the gesture keeps its label until a save actually carries it.
		const story = storyWithText('s1', 'one');

		queue.push(story);
		await tick(DEFAULT_DEBOUNCE_MS);

		noteSyncReason('s1', 'find-replace');
		queue.push(story);

		expect(peekSyncReason('s1')).toBe('find-replace');
	});
});

describe('what a patch summary is derived from', () => {
	it('names the passage the patch carries, not the whole story', async () => {
		const first = testStory({
			id: 's1',
			passages: [
				testPassage('s1', {id: 'p1', name: 'Tavern Night'}),
				testPassage('s1', {id: 'p2', name: 'Cellar'})
			]
		});

		queue.push(first);
		await tick(DEFAULT_DEBOUNCE_MS);

		queue.push({
			...first,
			passages: [
				first.passages[0],
				{...first.passages[1], name: 'Cellar Stairs'}
			]
		});
		await tick(DEFAULT_DEBOUNCE_MS);

		expect(lastSummary()).toBe('store.patchSummary.renamed');
	});

	it('does not disturb the patch itself', async () => {
		queue.push(storyWithText('s1', 'one'));
		await tick(DEFAULT_DEBOUNCE_MS);
		queue.push(storyWithText('s1', 'two'));
		await tick(DEFAULT_DEBOUNCE_MS);

		const patch = patchStory.mock.calls[0][1];

		expect(Object.keys(patch).sort()).toEqual(['passages']);
		expect(patch.passages.changed).toHaveLength(1);
		expect(patch.passages.changed[0].text).toBe('two');
	});
});

describe('call sites that state a reason', () => {
	it('find & replace does', () => {
		const story = testStory({
			id: 's1',
			passages: [testPassage('s1', {id: 'p1', text: 'a lamp'})]
		});

		replaceInStory(story, 'lamp', 'lantern', {})(jest.fn(), () => [story]);

		expect(peekSyncReason('s1')).toBe('find-replace');
	});

	it('find & replace does not, when it replaced nothing', () => {
		const story = testStory({
			id: 's1',
			passages: [testPassage('s1', {id: 'p1', text: 'a lamp'})]
		});

		replaceInStory(story, 'zzz', 'lantern', {})(jest.fn(), () => [story]);

		expect(peekSyncReason('s1')).toBeUndefined();
	});

	it('importing over an existing story does', () => {
		const existing = testStory({id: 's1', name: 'Lighthouse'});
		const incoming = testStory({id: 'other', name: 'Lighthouse'});

		importStories([incoming], [existing])(jest.fn(), () => []);

		expect(peekSyncReason('s1')).toBe('import');
	});

	it('importing a new story with a chosen id does', () => {
		const incoming = testStory({id: 'bundle-id', name: 'Brand New'});

		importStories([incoming], [], {keepIds: true})(jest.fn(), () => []);

		expect(peekSyncReason('bundle-id')).toBe('import');
	});
});
