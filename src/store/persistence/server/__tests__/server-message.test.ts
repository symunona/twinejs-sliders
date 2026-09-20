/**
 * What one websocket message makes this browser do.
 *
 * Before the extraction this was unreachable: the handler was a `useCallback` closing over
 * six refs, so the only way to deliver a message was to render the hook, stub `fetch` and
 * a socket, and then guess at the decision from whatever request came out. The two tests
 * that managed it assert that a GET happened and that a record reached `gone` — nothing
 * about `revived`, `assets`, an unknown type, a story this browser does not hold, or the
 * echo-suppression rule the whole design rests on.
 *
 * Three layers here, deliberately:
 *
 *   1. `planServerMessage` — pure. The whole answer to a message in one `toEqual`.
 *   2. `handleServerMessage` — the plan carried out against a recording env.
 *   3. The same thing against `fakeServer`, so "reconciles" means a real decision taken
 *      over real revs rather than a spy that was called.
 */

import {reconcileVerified, type ReconcileAction} from '../reconcile';
import {fakeServer, type FakeServer} from '../fake-server';
import {
	handleServerMessage,
	planServerMessage,
	type ServerMessageEnv,
	type ServerStoryState
} from '../server-message';
import {
	clearSyncLog,
	setSyncLogEnabled,
	syncLog,
	syncLogNotes
} from '../sync-log';
import {
	memorySyncRecordStore,
	storyHash,
	type SyncRecordStore
} from '../sync-record';
import {SyncQueue} from '../sync-queue';
import {settle, storyWithText, testStory} from '../test-fixtures';
import type {ServerMessage, StoryIndexEntry} from '../server.types';
import type {Story} from '../../../stories';

beforeEach(() => {
	setSyncLogEnabled(true);
	clearSyncLog();
});

afterEach(() => {
	setSyncLogEnabled(false);
});

function indexEntry(
	id: string,
	overrides: Partial<StoryIndexEntry> = {}
): StoryIndexEntry {
	return {
		assetBytes: 0,
		assetCount: 0,
		bytes: 100,
		deleted: false,
		id,
		ifid: `IFID-${id}`,
		lastClient: 'mira',
		name: id,
		passageCount: 1,
		rev: 1,
		updatedAt: '2026-01-01T00:00:00.000Z',
		...overrides
	};
}

// ---------------------------------------------------------------------------
// 1. The plan
// ---------------------------------------------------------------------------

/** A view over a browser that holds `stories` and remembers `records`. */
function view(
	stories: Story[],
	records: SyncRecordStore = memorySyncRecordStore()
) {
	return {records, stories: () => stories};
}

describe('planServerMessage', () => {
	const held = testStory({id: 's1', sync: true});

	it('reconciles a story message for a story we hold', () => {
		expect(
			planServerMessage(
				{by: 'jules', id: 's1', rev: 7, t: 'story'},
				view([held])
			)
		).toEqual([
			{
				id: 's1',
				patch: {deleted: false, lastClient: 'jules', rev: 7},
				type: 'index'
			},
			{
				server: {deleted: false, lastClient: 'jules', rev: 7},
				story: held,
				type: 'reconcile'
			}
		]);
	});

	/**
	 * The ghost list is built from the index, so a story this browser has never seen
	 * cannot be drawn from the message alone — the message carries a rev and a name, and
	 * a ghost card needs passage counts, bytes and an ifid.
	 */
	it('refreshes rather than reconciles for a story we do not hold', () => {
		const effects = planServerMessage(
			{by: 'jules', id: 'stranger', rev: 2, t: 'story'},
			view([held])
		);

		expect(effects).toEqual([
			{
				id: 'stranger',
				patch: {deleted: false, lastClient: 'jules', rev: 2},
				type: 'index'
			},
			{type: 'refresh'}
		]);
		expect(effects.some(effect => effect.type === 'reconcile')).toBe(false);
	});

	it('treats revived exactly as story, and clears the tombstone on the row', () => {
		const revived = planServerMessage(
			{by: 'jules', id: 's1', rev: 9, t: 'revived'},
			view([held])
		);
		const story = planServerMessage(
			{by: 'jules', id: 's1', rev: 9, t: 'story'},
			view([held])
		);

		expect(revived).toEqual(story);
		expect(revived[0]).toEqual({
			id: 's1',
			patch: {deleted: false, lastClient: 'jules', rev: 9},
			type: 'index'
		});
	});

	describe('deleted', () => {
		it('marks the row and reconciles a story we hold', () => {
			const records = memorySyncRecordStore();

			records.update('s1', {rev: 4});

			expect(
				planServerMessage(
					{by: 'jules', id: 's1', t: 'deleted'},
					view([held], records)
				)
			).toEqual([
				{id: 's1', patch: {deleted: true}, type: 'index'},
				{
					server: {deleted: true, lastClient: 'jules', rev: 4},
					story: held,
					type: 'reconcile'
				}
			]);
		});

		/**
		 * A tombstone carries no rev. The one handed to the table is OUR OWN, so that a
		 * message which turns out not to mean `gone` cannot also walk the record backwards
		 * on its way past.
		 */
		it('takes the rev from our record, not from the message', () => {
			const records = memorySyncRecordStore();

			records.update('s1', {rev: 11});

			const [, reconcile] = planServerMessage(
				{by: 'jules', id: 's1', t: 'deleted'},
				view([held], records)
			);

			expect(reconcile).toMatchObject({server: {rev: 11}});
		});

		it('refreshes for a story we do not hold', () => {
			expect(
				planServerMessage(
					{by: 'jules', id: 'stranger', t: 'deleted'},
					view([held])
				)
			).toEqual([
				{id: 'stranger', patch: {deleted: true}, type: 'index'},
				{type: 'refresh'}
			]);
		});
	});

	/**
	 * Asset bytes are not part of the story document, so there is nothing to reconcile.
	 * What moved is the row's counts — which is why this asks for the whole index rather
	 * than patching a row it cannot fill in.
	 */
	it('refreshes AND pulls art on an assets message', () => {
		expect(
			planServerMessage(
				{by: 'jules', rev: 3, story: 's1', t: 'assets'},
				view([held])
			)
		).toEqual([{type: 'refresh'}, {storyId: 's1', type: 'pullAssets'}]);
	});

	it('pulls art even for a story we do not hold, and lets the puller refuse', () => {
		// `pullAssets` in the hook is the one that knows about `sync: true` and about a
		// pull already in flight. Deciding it twice is how the two answers come to differ.
		expect(
			planServerMessage(
				{by: 'jules', rev: 3, story: 'stranger', t: 'assets'},
				view([held])
			)
		).toEqual([{type: 'refresh'}, {storyId: 'stranger', type: 'pullAssets'}]);
	});

	describe('messages that are not about our stories', () => {
		it.each([
			['welcome', {clients: [], t: 'welcome'}],
			['presence', {clients: [], t: 'presence'}],
			['stolen', {by: 'jules', passage: 'p1', story: 's1', t: 'stolen'}],
			['pong', {t: 'pong'}]
		])('plans nothing for %s', (_name, message) => {
			expect(planServerMessage(message as ServerMessage, view([held]))).toEqual(
				[]
			);
		});

		/** A newer server, or a typo on the wire. Neither may be treated as a story. */
		it('plans nothing for a type this build has never heard of', () => {
			const message = {id: 's1', t: 'sideways'} as unknown as ServerMessage;

			expect(planServerMessage(message, view([held]))).toEqual([]);
		});
	});

	it('reads the story list fresh on every message', () => {
		let stories: Story[] = [];
		const lazy = {records: memorySyncRecordStore(), stories: () => stories};
		const message: ServerMessage = {by: 'j', id: 's1', rev: 1, t: 'story'};

		expect(planServerMessage(message, lazy)[1]).toEqual({type: 'refresh'});

		// Checkout landed between two messages. The plan must follow.
		stories = [held];

		expect(planServerMessage(message, lazy)[1]).toMatchObject({
			type: 'reconcile'
		});
	});
});

// ---------------------------------------------------------------------------
// 2. Running the plan
// ---------------------------------------------------------------------------

interface EnvCalls {
	onReconciled: number;
	order: string[];
	pullAssets: string[];
	reconcile: {story: Story; server: ServerStoryState}[];
	refresh: number;
}

function recordingEnv(options: {
	index?: StoryIndexEntry[];
	records?: SyncRecordStore;
	reconcile?: (story: Story, server: ServerStoryState) => Promise<void>;
	stories?: Story[];
}) {
	const calls: EnvCalls = {
		onReconciled: 0,
		order: [],
		pullAssets: [],
		reconcile: [],
		refresh: 0
	};
	let index = options.index ?? [];

	const env: ServerMessageEnv = {
		onReconciled: () => {
			calls.onReconciled++;
			calls.order.push('onReconciled');
		},
		pullAssets: storyId => {
			calls.pullAssets.push(storyId);
			calls.order.push('pullAssets');
		},
		reconcile: (story, server) => {
			calls.reconcile.push({server, story});
			calls.order.push('reconcile');

			return options.reconcile?.(story, server) ?? Promise.resolve();
		},
		records: options.records ?? memorySyncRecordStore(),
		refresh: () => {
			calls.refresh++;
			calls.order.push('refresh');
		},
		setIndex: update => {
			index = update(index);
			calls.order.push('setIndex');
		},
		stories: () => options.stories ?? []
	};

	return {calls, env, index: () => index};
}

describe('handleServerMessage', () => {
	const held = testStory({id: 's1', sync: true});

	it('patches only the row the message names', () => {
		const harness = recordingEnv({
			index: [indexEntry('s1', {rev: 1}), indexEntry('s2', {rev: 5})],
			stories: [held]
		});

		handleServerMessage(
			{by: 'jules', id: 's1', rev: 8, t: 'story'},
			harness.env
		);

		expect(harness.index()).toEqual([
			indexEntry('s1', {lastClient: 'jules', rev: 8}),
			indexEntry('s2', {rev: 5})
		]);
	});

	/**
	 * A message is not enough to draw a card from — it has no ifid, no passage count, no
	 * byte total. The refresh that follows is what puts the row there.
	 */
	it('inserts no row for a story the index has never listed', () => {
		const harness = recordingEnv({index: [indexEntry('s2')]});

		handleServerMessage(
			{by: 'jules', id: 'brand-new', rev: 1, t: 'story'},
			harness.env
		);

		expect(harness.index()).toEqual([indexEntry('s2')]);
		expect(harness.calls.refresh).toBe(1);
	});

	it('patches the row before it asks for anything', () => {
		const harness = recordingEnv({index: [indexEntry('s1')], stories: [held]});

		handleServerMessage({by: 'j', id: 's1', rev: 2, t: 'story'}, harness.env);

		expect(harness.calls.order).toEqual(['setIndex', 'reconcile']);
	});

	it('re-reads records once the reconcile has settled', async () => {
		let release: (() => void) | undefined;
		const harness = recordingEnv({
			reconcile: () =>
				new Promise<void>(resolve => {
					release = resolve;
				}),
			stories: [held]
		});

		handleServerMessage({by: 'j', id: 's1', rev: 2, t: 'story'}, harness.env);
		expect(harness.calls.onReconciled).toBe(0);

		release?.();
		await settle();

		expect(harness.calls.onReconciled).toBe(1);
	});

	it('refreshes and pulls on an assets message, in that order', () => {
		const harness = recordingEnv({stories: [held]});

		handleServerMessage(
			{by: 'j', rev: 4, story: 's1', t: 'assets'},
			harness.env
		);

		expect(harness.calls.order).toEqual(['refresh', 'pullAssets']);
		expect(harness.calls.pullAssets).toEqual(['s1']);
		expect(harness.calls.reconcile).toEqual([]);
	});

	it('touches nothing for a presence message', () => {
		const harness = recordingEnv({index: [indexEntry('s1')], stories: [held]});

		handleServerMessage({clients: [], t: 'presence'}, harness.env);

		expect(harness.calls.order).toEqual([]);
		expect(harness.index()).toEqual([indexEntry('s1')]);
	});
});

// ---------------------------------------------------------------------------
// 3. The log
// ---------------------------------------------------------------------------

describe('what it writes down', () => {
	const held = testStory({id: 's1', sync: true});

	it('records one socket entry per message, naming the decision', () => {
		const harness = recordingEnv({stories: [held]});

		handleServerMessage({by: 'j', id: 's1', rev: 2, t: 'story'}, harness.env);
		handleServerMessage({by: 'j', id: 'nope', rev: 2, t: 'story'}, harness.env);
		handleServerMessage({by: 'j', id: 's1', t: 'deleted'}, harness.env);
		handleServerMessage(
			{by: 'j', rev: 1, story: 's1', t: 'assets'},
			harness.env
		);
		handleServerMessage({t: 'pong'}, harness.env);

		expect(syncLogNotes({event: 'socket'})).toEqual([
			'story: reconcile',
			'story: not held, refresh',
			'deleted: reconcile',
			'assets: refresh and pull assets',
			'pong: no story effect'
		]);
	});

	it('carries enough detail to argue with the decision', () => {
		const harness = recordingEnv({stories: [held]});

		handleServerMessage(
			{by: 'jules', id: 's1', rev: 12, t: 'story'},
			harness.env
		);

		expect(syncLog({event: 'socket'})[0]).toMatchObject({
			detail: {by: 'jules', did: ['index', 'reconcile'], rev: 12, t: 'story'},
			storyId: 's1'
		});
	});

	it('files an assets entry under the story it is about', () => {
		const harness = recordingEnv({stories: [held]});

		handleServerMessage(
			{by: 'j', rev: 1, story: 's1', t: 'assets'},
			harness.env
		);

		expect(syncLog({event: 'socket'})[0]).toMatchObject({
			detail: {did: ['refresh', 'pullAssets']},
			storyId: 's1'
		});
	});
});

// ---------------------------------------------------------------------------
// 4. Against a store that argues back
// ---------------------------------------------------------------------------

/**
 * One simulated browser, wired the way the hook wires it: its own identity, its own
 * records, and `reconcile` running the REAL `reconcileVerified` so that "reconciles"
 * means a decision over real revs rather than a spy that was called.
 */
function browser(server: FakeServer, name: string) {
	const records: SyncRecordStore = memorySyncRecordStore();
	const client = server.client({id: name, name});
	const queue = new SyncQueue({client, debounceMs: 0, records});
	const stories: Story[] = [];
	const decisions: ReconcileAction[] = [];
	const inbox: ServerMessage[] = [];
	let index: StoryIndexEntry[] = [];

	const env: ServerMessageEnv = {
		onReconciled: () => undefined,
		pullAssets: () => undefined,
		reconcile: async (story, state) => {
			decisions.push(
				await reconcileVerified({
					client,
					local: story,
					records,
					server: {deleted: state.deleted, rev: state.rev}
				})
			);
		},
		records,
		refresh: () => {
			void client.listStories().then(entries => {
				index = entries;
			});
		},
		setIndex: update => {
			index = update(index);
		},
		stories: () => stories
	};

	return {
		client,
		decisions,
		env,
		hold(story: Story) {
			stories.push(story);
		},
		inbox,
		index: () => index,
		name,
		async push(story: Story) {
			queue.push(story);
			await queue.flush(story.id);
			await settle();
		},
		records,
		/** Deliver a message the way the socket would. */
		async receive(message: ServerMessage) {
			handleServerMessage(message, env);
			await settle();
		}
	};
}

describe('against fakeServer', () => {
	let server: FakeServer;
	let inboxes: Map<string, ServerMessage[]>;

	beforeEach(() => {
		inboxes = new Map();
		server = fakeServer({
			// The hub, as `hub.go` writes it: `broadcast(msg, exceptID)` skips the
			// connection whose identity matches the writer's. Echo suppression is the
			// caller's job here exactly as it is there, so a test can get it wrong on
			// purpose and see what that costs.
			notify: (message, by) => {
				for (const [id, inbox] of inboxes) {
					if (id === by.id) {
						continue;
					}

					inbox.push(message);
				}
			}
		});
	});

	function join(name: string) {
		const who = browser(server, name);

		inboxes.set(name, who.inbox);

		return who;
	}

	it('pulls when a peer moves the story past us', async () => {
		const a = join('a');
		const b = join('b');
		const first = storyWithText('s1', 'one');

		await a.push(first);

		// B holds the same bytes A pushed, and knows the rev it saw.
		b.hold(first);
		b.records.update('s1', {pushedHash: storyHash(first), rev: 1});

		await a.push(storyWithText('s1', 'two'));
		// Two messages: the write B is already in step with, and the one that moved past it.
		expect(b.inbox.map(message => 'rev' in message && message.rev)).toEqual([
			1, 2
		]);

		await b.receive(b.inbox[1]);

		expect(b.decisions).toEqual(['pull']);
	});

	it('does nothing for a message that only confirms what we already have', async () => {
		const a = join('a');
		const b = join('b');
		const story = storyWithText('s1', 'one');

		await a.push(story);
		b.hold(story);
		b.records.update('s1', {pushedHash: storyHash(story), rev: 1});

		await b.receive({by: 'a', id: 's1', rev: 1, t: 'story'});

		expect(b.decisions).toEqual(['none']);
	});

	it('goes on a tombstone, whatever rev the record is at', async () => {
		const a = join('a');
		const b = join('b');
		const story = storyWithText('s1', 'one');

		await a.push(story);
		b.hold(story);
		b.records.update('s1', {pushedHash: storyHash(story), rev: 1});

		await a.client.deleteStory('s1');
		expect(b.inbox.map(message => message.t)).toEqual(['story', 'deleted']);

		await b.receive(b.inbox[1]);

		expect(b.decisions).toEqual(['gone']);
	});

	/**
	 * A `deleted` message is the one that cannot be taken at face value, because a
	 * tombstone and a story we hold locally-only look the same from here. An unsynced
	 * story is nobody's business but this browser's.
	 */
	it('leaves an unsynced local story alone on a tombstone', async () => {
		const b = join('b');
		const local = testStory({id: 's1', sync: false});

		b.hold(local);
		await b.receive({by: 'a', id: 's1', t: 'deleted'});

		expect(b.decisions).toEqual(['none']);
	});

	it('refreshes the index for a story nobody here holds', async () => {
		const a = join('a');
		const b = join('b');

		await a.push(storyWithText('s1', 'one'));
		await b.receive(b.inbox[0]);

		expect(b.decisions).toEqual([]);
		expect(b.index().map(entry => entry.id)).toEqual(['s1']);
	});

	// -----------------------------------------------------------------
	// Echo suppression
	// -----------------------------------------------------------------

	describe('a client is never told about its own write', () => {
		/**
		 * The assumption the whole socket path rests on, and until now asserted nowhere on
		 * this side of the wire.
		 *
		 * `Hub.StoryChanged` broadcasts with `by.ID` as `exceptID`, and the connection it
		 * skips is the one whose `hello.client` matches. That is only the writer if the
		 * id on the HTTP write and the id in `hello` are the SAME value — in the hook both
		 * are `backendClientId`, one pref, read twice. Give the socket its own uuid and
		 * nothing breaks loudly: every client simply starts hearing about its own writes.
		 */
		it('suppresses the echo and tells everyone else', async () => {
			const a = join('a');
			const b = join('b');

			await a.push(storyWithText('s1', 'one'));

			expect(a.inbox).toEqual([]);
			expect(b.inbox).toEqual([{by: 'a', id: 's1', rev: 1, t: 'story'}]);
		});

		it('suppresses it on a tombstone and on an asset write too', async () => {
			const a = join('a');
			const b = join('b');

			await a.push(storyWithText('s1', 'one'));
			await a.client.putManifest('s1', {
				assets: [],
				characters: [],
				version: 1
			});
			await a.client.deleteStory('s1');

			expect(a.inbox).toEqual([]);
			expect(b.inbox.map(message => message.t)).toEqual([
				'story',
				'assets',
				'deleted'
			]);
		});

		it('keys the suppression on the id the HTTP write carried', async () => {
			const a = join('a');

			await a.push(storyWithText('s1', 'one'));

			// `by.id` on the notify is the same `clientId` the client puts in
			// `X-Client-Id`; if these two ever came apart, `exceptID` would match nobody.
			expect(a.client.clientId).toBe('a');
			expect(server.calls.map(call => call.by)).toContain('a');
		});

		/**
		 * What a broken `exceptID` would COST, stated as a test rather than as a comment.
		 *
		 * Deliver A its own echo while its receipt is lagging — `docs/sliders/bugs/
		 * rev-lag.md`, the tab-hide push whose `.then` died with the page. The record is
		 * one rev behind its own write, so the echo reads as somebody else being ahead,
		 * and the handler spends a `getStory` finding out that the bytes are its own.
		 *
		 * It repairs itself, which is why this was never noticed; it costs a round trip
		 * per echo per tab, which is why the suppression is worth pinning above.
		 */
		it('costs a needless fetch when the echo is not suppressed', async () => {
			const a = join('a');
			const story = storyWithText('s1', 'one');

			// A's own write landed and its receipt died with the page, so A holds the
			// bytes the server holds and has written down nothing at all about them.
			server.seed(story, {lastClient: 'a', rev: 1});
			a.hold(story);
			expect(a.records.get('s1')).toMatchObject({pushedHash: '', rev: 0});

			const before = server.calls.filter(
				call => call.method === 'getStory'
			).length;

			await a.receive({by: 'a', id: 's1', rev: 1, t: 'story'});

			expect(
				server.calls.filter(call => call.method === 'getStory').length
			).toBe(before + 1);
			// Verified against the server's bytes, found identical, record repaired.
			expect(a.decisions).toEqual(['none']);
			expect(a.records.get('s1').rev).toBe(1);
		});
	});
});
