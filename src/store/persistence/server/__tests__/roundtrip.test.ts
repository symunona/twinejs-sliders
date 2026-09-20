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

import type {ServerClient} from '../client';
import {fakeServer, type FakeServer} from '../fake-server';
import {reconcileVerified, verifyConflict} from '../reconcile';
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
 * It calls the same `reconcileVerified` the hook does — the whole answer, table plus the
 * verification of a suspected conflict — so a scenario can state the situation rather
 * than arrange a render, and cannot drift into being a second opinion. All this adds is
 * reading the index row the hook reads from its poll.
 */
async function decisionFor(
	who: {client: ReturnType<FakeServer['client']>; records: SyncRecordStore},
	story: Story
) {
	const index = await who.client.listStories();
	const entry = index.find(row => row.id === story.id);

	return reconcileVerified({
		client: who.client,
		local: story,
		records: who.records,
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
	 * FIXED. Was `it.failing` while the bug was live; flipped when the verification step
	 * landed, which is what that marker is for.
	 *
	 * `reconcileDecision` cannot get this right on its own — it sees two hashes and a rev,
	 * and by those this story IS dirty and behind. `reconcileVerified` wraps it: on a
	 * suspected conflict, fetch and compare CONTENT, and only park if the two copies
	 * genuinely diverged. See the fix section of the bug doc.
	 */
	it('does not call it a conflict when one browser agrees with itself', async () => {
		const {a, edited} = await lagged();

		expect(await decisionFor(a, edited)).not.toBe('conflict');
	});

	it('repairs the record instead, so the next edit pushes normally', async () => {
		const {a, edited} = await lagged();

		expect(await decisionFor(a, edited)).toBe('none');

		// The receipt it never got, written down late.
		expect(a.records.get('s1')).toMatchObject({
			pushedHash: storyHash(edited),
			rev: 2,
			state: 'idle'
		});
		expect(syncLogNotes({event: 'record'})).toContain(
			'conflict: resolved, same content'
		);

		// And it is a plain push from here, not a parked story.
		await push(a, storyWithText('s1', 'three'));

		expect(server.revOf('s1')).toBe(3);
		expect(a.records.get('s1').rev).toBe(3);
	});

	it('still parks when the fetch that would clear it fails', async () => {
		const {a, edited} = await lagged();

		// Straight to `reconcileVerified` with the index row spelled out, so the only
		// request left to fail is the GET that does the verifying.
		server.failNext(1);

		expect(
			await reconcileVerified({
				client: a.client,
				local: edited,
				records: a.records,
				server: {deleted: false, rev: server.revOf('s1')}
			})
		).toBe('conflict');
		expect(syncLogNotes({event: 'reconcile'})).toContain(
			'conflict: unverified'
		);

		// Nothing was written on a guess.
		expect(a.records.get('s1').rev).toBe(1);

		// And it clears itself the moment the network comes back.
		expect(await decisionFor(a, edited)).toBe('none');
	});

	it('resolves the same lag on the 412 path, when the next edit hits it first', async () => {
		const a = browser('a');

		await push(a, storyWithText('s1', 'one'));

		// The keepalive push lands and loses its receipt, as above.
		const edited = storyWithText('s1', 'two');

		await a.client.putStory(edited, 1);

		// This tab never reloaded, so nothing reconciled. The queue re-sends the same
		// body — the store's copy is still `edited` — with the stale `If-Match: 1`.
		await push(a, edited);

		expect(a.records.get('s1').state).toBe('idle');
		expect(a.records.get('s1').rev).toBe(2);
		expect(a.records.get('s1').pushedHash).toBe(storyHash(edited));
		// Verified, not overwritten: the server was never written to a third time.
		expect(server.revOf('s1')).toBe(2);
	});

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

	/**
	 * THE REGRESSION THAT MATTERS. Verifying a conflict must never talk one away.
	 *
	 * Same 412 as the rev-lag case above and the opposite answer, because the evidence is
	 * the opposite: the server is holding text this browser did not write.
	 */
	it('parks B in conflict when the 412 really was somebody else', async () => {
		const a = browser('a');
		const b = browser('b');
		const story = storyWithText('s1', 'one');

		await push(a, story);
		b.records.update('s1', {pushedHash: storyHash(story), rev: 1});

		await push(a, storyWithText('s1', 'theirs'));
		await push(b, storyWithText('s1', 'mine'));

		expect(b.records.get('s1')).toMatchObject({
			conflictRev: 2,
			state: 'conflict'
		});
		expect(syncLogNotes({event: 'reconcile', storyId: 's1'})).toContain(
			'conflict: confirmed'
		);

		// B's text stayed B's, and A's stayed on the server. Nothing was overwritten.
		expect(storyHash(server.stored('s1') as Story)).toBe(
			storyHash(storyWithText('s1', 'theirs'))
		);
	});

	it('parks on a 412 it could not check, rather than guessing', async () => {
		const a = browser('a');
		const b = browser('b');
		const story = storyWithText('s1', 'one');

		await push(a, story);
		b.records.update('s1', {pushedHash: storyHash(story), rev: 1});
		await push(a, storyWithText('s1', 'theirs'));

		// B's PUT must still get its real 412, so `failNext` is no good here — it would
		// take the PUT first. Only the verifying GET is broken.
		const halfOffline: ServerClient = {
			...b.client,
			getStory: () => Promise.reject(new Error('Failed to fetch'))
		};
		const queue = new SyncQueue({
			client: halfOffline,
			debounceMs: 0,
			records: b.records
		});

		queue.push(storyWithText('s1', 'mine'));
		await queue.flush('s1');
		await settle();

		expect(b.records.get('s1').state).toBe('conflict');
		expect(syncLogNotes({event: 'reconcile', storyId: 's1'})).toContain(
			'conflict: unverified'
		);
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

describe('verifying a suspected conflict', () => {
	it('is resolved when the server is holding our own bytes', async () => {
		const a = browser('a');
		const story = storyWithText('s1', 'one');

		await a.client.putStory(story);
		a.records.update('s1', {pushedHash: 'stale', rev: 0, state: 'conflict'});

		expect(
			await verifyConflict({
				client: a.client,
				local: story,
				records: a.records
			})
		).toBe('resolved');
		expect(a.records.get('s1')).toMatchObject({
			conflictClient: undefined,
			conflictRev: undefined,
			pushedHash: storyHash(story),
			rev: 1,
			state: 'idle'
		});
	});

	it('is a conflict when the bytes differ, and writes nothing', async () => {
		const a = browser('a');

		await a.client.putStory(storyWithText('s1', 'theirs'));
		a.records.update('s1', {pushedHash: 'stale', rev: 0});

		expect(
			await verifyConflict({
				client: a.client,
				local: storyWithText('s1', 'mine'),
				records: a.records
			})
		).toBe('conflict');
		expect(a.records.get('s1')).toMatchObject({pushedHash: 'stale', rev: 0});
	});

	it('is a conflict when the story is not there at all', async () => {
		const a = browser('a');

		expect(
			await verifyConflict({
				client: a.client,
				local: storyWithText('s1', 'mine'),
				records: a.records
			})
		).toBe('conflict');
	});

	it('takes the caller\'s hash rather than computing it twice', async () => {
		const a = browser('a');
		const story = storyWithText('s1', 'one');

		await a.client.putStory(story);

		// A hash that is not this story's must not resolve, however the record reads.
		expect(
			await verifyConflict({
				client: a.client,
				hash: 'not-this-story',
				local: story,
				records: a.records
			})
		).toBe('conflict');
	});
});

describe('the rev only goes up', () => {
	it('refuses a pull that would put an older rev back', async () => {
		const a = browser('a');

		await push(a, storyWithText('s1', 'one'));
		await push(a, storyWithText('s1', 'two'));
		expect(a.records.get('s1').rev).toBe(2);

		// A pull that was already in flight when that second push landed.
		a.records.update('s1', {rev: 1});

		expect(a.records.get('s1').rev).toBe(2);
		expect(syncLogNotes({event: 'record', storyId: 's1'})).toContain(
			'rev not lowered'
		);
	});

	it('leaves a write that does not mention the rev alone', async () => {
		const a = browser('a');

		await push(a, storyWithText('s1', 'one'));
		a.records.update('s1', {state: 'pulling'});

		expect(a.records.get('s1')).toMatchObject({rev: 1, state: 'pulling'});
	});

	it('takes a higher rev, and takes it on a record it has never seen', async () => {
		const a = browser('a');

		a.records.update('s1', {rev: 7});
		a.records.update('s1', {rev: 9});

		expect(a.records.get('s1').rev).toBe(9);
	});

	it('lets a record be dropped and re-minted at zero — the publish escape', async () => {
		const a = browser('a');

		await push(a, storyWithText('s1', 'one'));
		a.records.remove('s1');
		a.records.update('s1', {rev: 0, state: 'pushing'});

		expect(a.records.get('s1').rev).toBe(0);
	});
});
