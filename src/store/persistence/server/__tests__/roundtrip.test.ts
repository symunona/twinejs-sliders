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

import {ServerError, type ServerClient} from '../client';
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
import {snapshotStory} from '../story-diff';
import {settle, storyWithText, testPassage, testStory} from '../test-fixtures';
import type {Passage, Story} from '../../../stories';

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

/**
 * One simulated browser: its own client identity and its own side table.
 *
 * `merges` wires `onMerged` to a stand-in for the local store, which is what the hook
 * does with `applyPulledStory`. Off by default, because it is off by default in the app:
 * a queue that cannot land a merge must not push one.
 */
function browser(name: string, options: {merges?: boolean} = {}) {
	const records: SyncRecordStore = memorySyncRecordStore();
	const client = server.client({id: name, name});
	/** What this browser's store holds after a merge landed in it. */
	const landed: Story[] = [];
	const queue = new SyncQueue({
		client,
		debounceMs: 0,
		records,
		...(options.merges
			? {
					onMerged: (story: Story) => {
						landed.push(story);

						return true;
					}
			  }
			: {})
	});

	return {client, landed, queue, records};
}

/** A story of several named rooms, so a patch has something to leave alone. */
function rooms(id: string, texts: Record<string, string>): Story {
	const passages: Passage[] = Object.entries(texts).map(([key, text]) =>
		testPassage(id, {id: key, name: key.toUpperCase(), text})
	);

	return testStory({id, passages});
}

/** Passages of a story as `id: text` — what "did anybody get dropped" means. */
function textOf(story: Story): Record<string, string> {
	return Object.fromEntries(story.passages.map(p => [p.id, p.text]));
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

describe('uploading only what changed', () => {
	/**
	 * `keepalive` caps a request body at 64 KB, and a PUT of an 89 KB story measured
	 * 90,550 B — so the save fired on tab-hide silently did not happen at all. The same
	 * edit as a patch was 1,219 B. That is what this section is about; the size
	 * assertion below is the actual claim.
	 */
	it('sends the whole story the first time, having no base to diff against', async () => {
		const a = browser('a');

		await push(a, rooms('s1', {p1: 'one', p2: 'two'}));

		expect(server.calls.map(c => c.method)).toEqual(['putStory']);
		expect(a.records.get('s1').snapshot?.hash).toBe(
			storyHash(rooms('s1', {p1: 'one', p2: 'two'}))
		);
	});

	it('sends one passage the second time', async () => {
		const a = browser('a');

		await push(a, rooms('s1', {p1: 'one', p2: 'two'}));
		await push(a, rooms('s1', {p1: 'one', p2: 'REWRITTEN'}));

		expect(server.calls.map(c => c.method)).toEqual([
			'putStory',
			'patchStory'
		]);
		expect(server.patches).toHaveLength(1);
		expect(server.patches[0].patch.passages?.changed?.map(p => p.id)).toEqual([
			'p2'
		]);
		expect(server.patches[0].patch.passages?.removed).toBeUndefined();
		expect(textOf(server.stored('s1') as Story)).toEqual({
			p1: 'one',
			p2: 'REWRITTEN'
		});
	});

	it('is a fraction of the PUT it replaces', async () => {
		const a = browser('a');
		const big = (text: string) =>
			rooms('s1', {
				p1: 'x'.repeat(30000),
				p2: 'y'.repeat(30000),
				p3: 'z'.repeat(30000),
				p4: text
			});

		await push(a, big('four'));
		await push(a, big('four, edited'));

		const whole = JSON.stringify(server.stored('s1')).length;

		expect(whole).toBeGreaterThan(64 * 1024);
		expect(server.patches[0].bytes).toBeLessThan(64 * 1024);
		expect(server.patches[0].bytes).toBeLessThan(whole / 20);
	});

	it('carries a deletion, and the server keeps the rest', async () => {
		const a = browser('a');

		await push(a, rooms('s1', {p1: 'one', p2: 'two', p3: 'three'}));
		await push(a, rooms('s1', {p1: 'one', p3: 'three'}));

		expect(server.patches[0].patch.passages?.removed).toEqual(['p2']);
		expect(textOf(server.stored('s1') as Story)).toEqual({
			p1: 'one',
			p3: 'three'
		});
	});

	it('keeps the rev in step, so the next patch has a base', async () => {
		const a = browser('a');

		for (const text of ['one', 'two', 'three', 'four']) {
			await push(a, rooms('s1', {p1: text, p2: 'steady'}));
		}

		expect(server.revOf('s1')).toBe(4);
		expect(a.records.get('s1').rev).toBe(4);
		expect(await decisionFor(a, rooms('s1', {p1: 'four', p2: 'steady'}))).toBe(
			'none'
		);
	});

	/**
	 * A snapshot is usable only while it describes what the record says was pushed. A
	 * pull, a checkout and a publish all write `pushedHash` and know nothing about
	 * snapshots — so they invalidate the base for free, and the cost is one whole PUT
	 * that mints a fresh one.
	 */
	it('falls back to a whole PUT when something else wrote the record', async () => {
		const a = browser('a');

		await push(a, rooms('s1', {p1: 'one', p2: 'two'}));

		// What a pull leaves behind: a new hash, no snapshot.
		const pulled = rooms('s1', {p1: 'pulled', p2: 'two'});

		a.records.update('s1', {pushedHash: storyHash(pulled)});

		await push(a, rooms('s1', {p1: 'pulled', p2: 'EDITED'}));

		expect(server.calls.map(c => c.method)).toEqual(['putStory', 'putStory']);
		expect(a.records.get('s1').snapshot?.hash).toBe(
			storyHash(rooms('s1', {p1: 'pulled', p2: 'EDITED'}))
		);
	});

	it('does not patch when the queue was told not to', async () => {
		const records: SyncRecordStore = memorySyncRecordStore();
		const client = server.client({id: 'a', name: 'a'});
		const queue = new SyncQueue({client, debounceMs: 0, patch: false, records});

		for (const text of ['one', 'two']) {
			const story = rooms('s1', {p1: text, p2: 'steady'});

			queue.push(story);
			await queue.flush('s1');
			await settle();
		}

		expect(server.calls.map(c => c.method)).toEqual(['putStory', 'putStory']);
	});
});

describe('a server that does not do PATCH', () => {
	/** An older build answers 405; a proxy or a refused CORS preflight looks the same. */
	function noPatch(client: ServerClient): ServerClient {
		return {
			...client,
			patchStory: () =>
				Promise.reject(
					new ServerError('method not allowed', {
						code: 'bad_request',
						status: 405
					})
				)
		};
	}

	it('falls back to a PUT and the edit still lands', async () => {
		const a = browser('a');
		const queue = new SyncQueue({
			client: noPatch(a.client),
			debounceMs: 0,
			records: a.records
		});

		await push(a, rooms('s1', {p1: 'one', p2: 'two'}));

		queue.push(rooms('s1', {p1: 'one', p2: 'REWRITTEN'}));
		await queue.flush('s1');
		await settle();

		expect(textOf(server.stored('s1') as Story)).toEqual({
			p1: 'one',
			p2: 'REWRITTEN'
		});
		expect(a.records.get('s1')).toMatchObject({rev: 2, state: 'idle'});
		expect(syncLogNotes({event: 'push'})).toContain(
			'patch refused, put instead'
		);
	});

	it('stops trying for the rest of the session', async () => {
		const a = browser('a');
		const client = noPatch(a.client);
		const queue = new SyncQueue({client, debounceMs: 0, records: a.records});

		await push(a, rooms('s1', {p1: 'one', p2: 'two'}));

		for (const text of ['two', 'three', 'four']) {
			queue.push(rooms('s1', {p1: 'one', p2: text}));
			await queue.flush('s1');
			await settle();
		}

		// One refused patch, then it never asks again.
		expect(server.calls.filter(c => c.method === 'patchStory')).toHaveLength(0);
		expect(
			syncLogNotes({event: 'push'}).filter(
				note => note === 'patch refused, put instead'
			)
		).toHaveLength(1);
	});

	/**
	 * A 412 is an answer ABOUT THE STORY — the server understood the request perfectly.
	 * Retrying it as a PUT spends a second request to be told the same thing, and does
	 * it with a body that would OVERWRITE if the rev were somehow accepted.
	 */
	it('does not retry a refused precondition as a whole PUT', async () => {
		const b = browser('b');
		const a = browser('a');
		const base = rooms('s1', {p1: 'one', p2: 'two'});

		await push(b, base);
		a.records.update('s1', {pushedHash: storyHash(base), rev: 1});
		await push(a, rooms('s1', {p1: 'A WAS HERE', p2: 'two'}));

		const before = server.calls.length;

		await push(b, rooms('s1', {p1: 'B WAS HERE TOO', p2: 'two'}));

		// The refused PATCH, and the GET that checks whether the 412 was real. No PUT.
		expect(server.calls.slice(before).map(c => c.method)).toEqual([
			'patchStory',
			'getStory'
		]);
		expect(b.records.get('s1').state).toBe('conflict');
	});

	/**
	 * A dead connection fails the patch AND the PUT, so it says nothing about the
	 * method. Switching PATCH off on a blip would throw away the size win exactly when
	 * the network is bad, which is when it matters.
	 */
	it('keeps patching after a network failure that also killed the PUT', async () => {
		const a = browser('a');

		await push(a, rooms('s1', {p1: 'one', p2: 'two'}));

		server.failNext(2);
		a.queue.push(rooms('s1', {p1: 'one', p2: 'REWRITTEN'}));
		await a.queue.flush('s1');
		await settle();

		expect(a.records.get('s1').rev).toBe(1);

		await push(a, rooms('s1', {p1: 'one', p2: 'REWRITTEN'}));

		expect(server.calls.filter(c => c.method === 'patchStory')).toHaveLength(2);
		expect(server.revOf('s1')).toBe(2);
	});
});

describe('two people, different passages', () => {
	/**
	 * THE NORMAL CASE FOR TWO PEOPLE ON ONE STORY, and until now it parked one of them.
	 *
	 * `If-Match` is on the STORY rev even though uploads are per-passage, so B's push
	 * gets a 412 the moment A saves anything at all. B then sat in `conflict` — a dialog
	 * every few minutes for a disagreement that does not exist.
	 */
	async function twoEditors() {
		const b = browser('b', {merges: true});
		const a = browser('a');
		const base = rooms('s1', {p1: 'one', p2: 'two'});

		// B made the story, so B has a base to diff against.
		await push(b, base);

		// A holds the same rev and edits the FIRST room.
		a.records.update('s1', {pushedHash: storyHash(base), rev: 1});
		await push(a, rooms('s1', {p1: 'A WAS HERE', p2: 'two'}));

		return {a, b, base};
	}

	it('lands both edits and parks nobody', async () => {
		const {b} = await twoEditors();

		// B edits the SECOND room, still thinking the story is at rev 1.
		await push(b, rooms('s1', {p1: 'one', p2: 'B WAS HERE'}));

		expect(b.records.get('s1').state).toBe('idle');
		expect(textOf(server.stored('s1') as Story)).toEqual({
			p1: 'A WAS HERE',
			p2: 'B WAS HERE'
		});
	});

	it('puts the merged story into B\u2019s own store, not just on the server', async () => {
		const {b} = await twoEditors();

		await push(b, rooms('s1', {p1: 'one', p2: 'B WAS HERE'}));

		expect(b.landed).toHaveLength(1);
		expect(textOf(b.landed[0])).toEqual({
			p1: 'A WAS HERE',
			p2: 'B WAS HERE'
		});
	});

	it('leaves B in step, so the next edit is an ordinary patch', async () => {
		const {b} = await twoEditors();

		await push(b, rooms('s1', {p1: 'one', p2: 'B WAS HERE'}));

		const merged = b.landed[0];

		expect(b.records.get('s1')).toMatchObject({
			pushedHash: storyHash(merged),
			rev: server.revOf('s1'),
			state: 'idle'
		});

		await push(b, {
			...merged,
			passages: merged.passages.map(p =>
				p.id === 'p2' ? {...p, text: 'B AGAIN'} : p
			)
		});

		expect(server.patches.at(-1)?.patch.passages?.changed?.map(p => p.id)).toEqual(
			['p2']
		);
		expect(textOf(server.stored('s1') as Story)).toEqual({
			p1: 'A WAS HERE',
			p2: 'B AGAIN'
		});
	});

	it('keeps a passage each of them added', async () => {
		const b = browser('b', {merges: true});
		const a = browser('a');
		const base = rooms('s1', {p1: 'one'});

		await push(b, base);
		a.records.update('s1', {pushedHash: storyHash(base), rev: 1});
		await push(a, rooms('s1', {p1: 'one', p3: 'A added this'}));
		await push(b, rooms('s1', {p1: 'one', p2: 'B added this'}));

		expect(textOf(server.stored('s1') as Story)).toEqual({
			p1: 'one',
			p2: 'B added this',
			p3: 'A added this'
		});
		expect(b.records.get('s1').state).toBe('idle');
	});

	/**
	 * THE REGRESSION THAT MATTERS, in the direction that loses work. Merging must never
	 * talk a real conflict away: both of them typed in p1, and only they can settle it.
	 */
	it('still parks when they really did edit the same passage', async () => {
		const {b} = await twoEditors();

		await push(b, rooms('s1', {p1: 'B WAS HERE TOO', p2: 'two'}));

		expect(b.records.get('s1')).toMatchObject({
			conflictRev: 2,
			state: 'conflict'
		});
		expect(b.landed).toHaveLength(0);
		expect(textOf(server.stored('s1') as Story)).toEqual({
			p1: 'A WAS HERE',
			p2: 'two'
		});
	});

	/**
	 * A queue with nowhere to put the result must not push one. Pushing a merge this
	 * browser cannot show would leave the author looking at a story missing the other
	 * person's room under a green badge — the failure this directory keeps re-learning.
	 */
	it('does not merge at all when nothing can land the result', async () => {
		const b = browser('b');
		const a = browser('a');
		const base = rooms('s1', {p1: 'one', p2: 'two'});

		await push(b, base);
		a.records.update('s1', {pushedHash: storyHash(base), rev: 1});
		await push(a, rooms('s1', {p1: 'A WAS HERE', p2: 'two'}));

		await push(b, rooms('s1', {p1: 'one', p2: 'B WAS HERE'}));

		expect(b.records.get('s1').state).toBe('conflict');
		expect(textOf(server.stored('s1') as Story)).toEqual({
			p1: 'A WAS HERE',
			p2: 'two'
		});
	});

	/**
	 * Without a base there is no way to tell "I added this room" from "they deleted it",
	 * and the two want opposite answers. So: park, exactly as before merging existed.
	 */
	it('does not merge without a base to merge against', async () => {
		const b = browser('b', {merges: true});
		const a = browser('a');
		const base = rooms('s1', {p1: 'one', p2: 'two'});

		await push(a, base);
		// B knows the rev but has no snapshot — a checkout, or a fresh browser.
		b.records.update('s1', {pushedHash: storyHash(base), rev: 1});
		await push(a, rooms('s1', {p1: 'A WAS HERE', p2: 'two'}));

		await push(b, rooms('s1', {p1: 'one', p2: 'B WAS HERE'}));

		expect(b.records.get('s1').state).toBe('conflict');
		expect(b.landed).toHaveLength(0);
	});

	/**
	 * The server is written FIRST, so it holds both sides' work whatever happens next.
	 * When the store then refuses the result this browser is merely BEHIND — old rev,
	 * old hash, parked — and Take Theirs hands the author the merged copy. Recording the
	 * new rev on faith is the `applyPull` bug with extra steps: the next patch would diff
	 * against a base the store never reached and remove the other person's passage.
	 */
	it('parks, holding nothing back from the server, when the store refuses the merge', async () => {
		const b = browser('b');
		const a = browser('a');
		const base = rooms('s1', {p1: 'one', p2: 'two'});
		const queue = new SyncQueue({
			client: b.client,
			debounceMs: 0,
			onMerged: () => false,
			records: b.records
		});

		await push(b, base);
		a.records.update('s1', {pushedHash: storyHash(base), rev: 1});
		await push(a, rooms('s1', {p1: 'A WAS HERE', p2: 'two'}));

		queue.push(rooms('s1', {p1: 'one', p2: 'B WAS HERE'}));
		await queue.flush('s1');
		await settle();

		expect(textOf(server.stored('s1') as Story)).toEqual({
			p1: 'A WAS HERE',
			p2: 'B WAS HERE'
		});
		expect(b.records.get('s1')).toMatchObject({rev: 1, state: 'conflict'});
		expect(syncLogNotes({event: 'push'})).toContain(
			'merge: pushed but did not land'
		);
	});
});

describe('the base a patch is computed from', () => {
	it('describes the story that was pushed, not the one being edited', async () => {
		const a = browser('a');
		const first = rooms('s1', {p1: 'one', p2: 'two'});

		await push(a, first);

		expect(snapshotStory(first)).toEqual(a.records.get('s1').snapshot);
	});

	it('moves on with every push', async () => {
		const a = browser('a');

		await push(a, rooms('s1', {p1: 'one', p2: 'two'}));

		const second = rooms('s1', {p1: 'one', p2: 'REWRITTEN'});

		await push(a, second);

		expect(a.records.get('s1').snapshot).toEqual(snapshotStory(second));
	});
});
