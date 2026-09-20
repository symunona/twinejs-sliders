/**
 * Sync as a whole, against a store that argues back.
 *
 * Every scenario here is a bug that was found in a browser, hours after it happened, and
 * could have been found in milliseconds. They are written as narratives — "B was offline,
 * A edited, B came back" — because that is the level the bugs live at: each individual
 * module was behaving exactly as its own unit tests said it should.
 *
 * `fakeServer()` keeps real revs and enforces real preconditions, so a client can conflict
 * with itself here the same way it does in the wild.
 */

import {fakeServer, type FakeServer} from '../fake-server';
import {reconcileDecision} from '../use-server-sync';
import {
	isStoryDirty,
	memorySyncRecordStore,
	storyHash,
	type SyncRecordStore
} from '../sync-record';
import {clearSyncLog, setSyncLogEnabled, syncLogNotes} from '../sync-log';
import {SyncQueue} from '../sync-queue';
import {settle, storyWithText, testStory} from '../test-fixtures';
import type {Story} from '../../../stories';

let server: FakeServer;

beforeEach(() => {
	jest.useFakeTimers();
	server = fakeServer();
	setSyncLogEnabled(true);
	clearSyncLog();
});

afterEach(() => {
	jest.useRealTimers();
	setSyncLogEnabled(false);
});

/** One simulated browser: its own client identity and its own side table. */
function browser(name: string) {
	const records: SyncRecordStore = memorySyncRecordStore();
	const client = server.client({id: name, name});
	const queue = new SyncQueue({client, debounceMs: 0, records});

	return {client, queue, records};
}

/**
 * What `reconcileStory` would decide, without the React hook around it.
 *
 * The hook's copy reads the same two inputs from the same two places; this spells them
 * out so a scenario can state the situation rather than arrange a render.
 */
async function decisionFor(
	who: {client: ReturnType<FakeServer['client']>; records: SyncRecordStore},
	story: Story
) {
	const index = await who.client.listStories();
	const entry = index.find(row => row.id === story.id);
	const record = who.records.get(story.id);

	return reconcileDecision({
		local: {
			dirty: storyHash(story) !== record.pushedHash,
			rev: record.rev,
			sync: story.sync === true
		},
		server: entry ? {deleted: entry.deleted, rev: entry.rev} : undefined
	});
}

async function push(
	who: ReturnType<typeof browser>,
	story: Story,
	options?: {keepalive?: boolean}
) {
	who.queue.push(story);
	await who.queue.flush(story.id, options);
	await settle();
}

describe('one browser, one story', () => {
	it('records the rev the server actually assigned', async () => {
		const a = browser('a');
		const story = storyWithText('s1', 'one');

		await push(a, story);

		expect(server.revOf('s1')).toBe(1);
		expect(a.records.get('s1').rev).toBe(1);
		expect(syncLogNotes({event: 'push'})).toEqual(['landed']);
	});

	it('stays in step across a run of edits', async () => {
		const a = browser('a');

		for (const text of ['one', 'two', 'three', 'four']) {
			await push(a, storyWithText('s1', text));
		}

		expect(server.revOf('s1')).toBe(4);
		expect(a.records.get('s1').rev).toBe(4);
		expect(await decisionFor(a, storyWithText('s1', 'four'))).toBe('none');
	});

	it('sends nothing when the body did not change', async () => {
		const a = browser('a');
		const story = storyWithText('s1', 'one');

		await push(a, story);
		await push(a, story);

		expect(server.revOf('s1')).toBe(1);
		expect(syncLogNotes({event: 'push'})).toEqual([
			'landed',
			'skipped: same hash'
		]);
	});
});

describe('rev lag — a client conflicting with itself', () => {
	/**
	 * `docs/sliders/bugs/rev-lag.md`, reproduced.
	 *
	 * `visibilitychange → hidden` pushes with `keepalive`, which lets the REQUEST outlive
	 * the document. The `.then` that records the result does not. So the server writes,
	 * the receipt is lost, and `rev` AND `pushedHash` both stay behind by exactly one.
	 *
	 * Sets up the situation and leaves it in `lagged`; the two tests after it say what is
	 * TRUE about it and what OUGHT to be true.
	 */
	async function lagged() {
		const a = browser('a');

		await push(a, storyWithText('s1', 'one'));
		expect(a.records.get('s1').rev).toBe(1);

		// The tab is hidden. The edit goes out and lands; the page is gone before the
		// promise resolves, so nothing writes the record.
		const edited = storyWithText('s1', 'two');

		await a.client.putStory(edited, a.records.get('s1').rev);

		return {a, edited};
	}

	it('leaves the record one rev behind, with nothing to conflict about', async () => {
		const {a, edited} = await lagged();

		expect(server.revOf('s1')).toBe(2);
		expect(a.records.get('s1').rev).toBe(1);

		// The point. This browser's copy and the server's copy are the SAME TEXT — it is
		// the text this browser sent. Whatever the bookkeeping says, there is no
		// disagreement here for anybody to resolve.
		expect(storyHash(edited)).toBe(storyHash(server.stored('s1') as Story));
	});

	/**
	 * FAILING ON PURPOSE — this is the fix, not the bug.
	 *
	 * `it.failing` passes only while the assertion below does NOT hold, so this documents
	 * the defect today and turns RED the moment someone fixes it. When that happens the
	 * answer is to flip it to `it`, never to soften the assertion.
	 *
	 * `reconcileDecision` cannot get this right on its own — it sees two hashes and a rev,
	 * and by those this story IS dirty and behind. The fix is a verification step around
	 * it: on a suspected conflict, fetch and compare CONTENT, and only park if the two
	 * copies genuinely diverged. See the fix section of the bug doc.
	 */
	it.failing(
		'does not call it a conflict when one browser agrees with itself',
		async () => {
			const {a, edited} = await lagged();

			expect(await decisionFor(a, edited)).not.toBe('conflict');
		}
	);

	it('is not a conflict once the record catches up', async () => {
		const a = browser('a');
		const story = storyWithText('s1', 'one');

		await push(a, story);

		const edited = storyWithText('s1', 'two');
		const result = await a.client.putStory(edited, 1);

		a.records.update('s1', {pushedHash: storyHash(edited), rev: result.rev});

		expect(await decisionFor(a, edited)).toBe('none');
	});
});

describe('two browsers', () => {
	it('B pulls when it was offline and changed nothing', async () => {
		const a = browser('a');
		const b = browser('b');
		const story = storyWithText('s1', 'one');

		// Both start in step.
		await push(a, story);
		b.records.update('s1', {pushedHash: storyHash(story), rev: 1});

		// B is offline. A edits twice.
		await push(a, storyWithText('s1', 'two'));
		await push(a, storyWithText('s1', 'three'));

		// B comes back holding its untouched copy.
		expect(await decisionFor(b, story)).toBe('pull');
	});

	it('B pulls when all it did was zoom the map', async () => {
		const a = browser('a');
		const b = browser('b');
		const story = storyWithText('s1', 'one');

		await push(a, story);
		b.records.update('s1', {pushedHash: storyHash(story), rev: 1});

		await push(a, storyWithText('s1', 'two'));

		// B scrolled and zoomed. It authored nothing.
		const viewed: Story = {...story, snapToGrid: true, zoom: 0.6};

		expect(isStoryDirty(viewed, b.records.get('s1'))).toBe(false);
		expect(await decisionFor(b, viewed)).toBe('pull');
	});

	it('is a conflict when B really did edit', async () => {
		const a = browser('a');
		const b = browser('b');
		const story = storyWithText('s1', 'one');

		await push(a, story);
		b.records.update('s1', {pushedHash: storyHash(story), rev: 1});

		await push(a, storyWithText('s1', 'theirs'));

		expect(await decisionFor(b, storyWithText('s1', 'mine'))).toBe('conflict');
	});

	it('refuses the second writer with 412 and its own rev', async () => {
		const a = browser('a');
		const b = browser('b');

		await push(a, storyWithText('s1', 'one'));
		b.records.update('s1', {rev: 1});

		await push(a, storyWithText('s1', 'two')); // server now at 2

		await expect(
			b.client.putStory(storyWithText('s1', 'mine'), 1)
		).rejects.toMatchObject({rev: 2, status: 412});
	});
});

describe('tombstones', () => {
	it('does not bump the rev, so an old client can still republish', async () => {
		const a = browser('a');

		await push(a, storyWithText('s1', 'one'));
		expect(server.revOf('s1')).toBe(1);

		await a.client.deleteStory('s1');

		expect(server.deleted('s1')).toBe(true);
		expect(server.revOf('s1')).toBe(1);

		await a.client.reviveStory(storyWithText('s1', 'one'));

		expect(server.deleted('s1')).toBe(false);
		expect(server.revOf('s1')).toBe(2);
	});

	it('reads as gone to a client that still has the text', async () => {
		const a = browser('a');
		const story = storyWithText('s1', 'one');

		await push(a, story);
		await a.client.deleteStory('s1');

		expect(await decisionFor(a, story)).toBe('gone');
	});
});

describe('the asset manifest', () => {
	it('keeps a rev of its own, untouched by story writes', async () => {
		const a = browser('a');

		await push(a, testStory({id: 's1'}));
		await a.client.putManifest('s1', {assets: [], characters: [], version: 1});

		expect(server.assetRevOf('s1')).toBe(1);

		await push(a, storyWithText('s1', 'edited'));

		expect(server.revOf('s1')).toBe(2);
		expect(server.assetRevOf('s1')).toBe(1);
	});
});
