/**
 * A pull has to LAND.
 *
 * The suite next door (`use-server-sync.test.tsx`, "pulls on a story message the same way
 * a poll would") asserts that a GET went out and nothing else. That passes with the story
 * text never reaching the store at all, which is exactly the bug this file was written
 * for: `applyPull` dispatched `updateStory` and then wrote `rev`, `pushedHash`,
 * `lastPulledAt` and fired `notifyStoryPulled` whatever the store did with it. The
 * reducer refuses an update whose `name` is already another local story's
 * (`reducer/update-story.ts`) — a collision `checkoutStory` deliberately creates when it
 * renames an incoming story — and refuses it by returning the state unchanged and
 * `console.warn`ing. So the text never arrived, the record said it had, and
 * `server.rev > local.rev` was false from then on: no later poll ever tried again, and
 * the badge read a green "Synced" that the failed pull had just refreshed.
 *
 * Hence the shape of the tests here: every one of them asserts on the STORE, through the
 * real `storiesReducer` that `FakeStateProvider` runs. Asserting on the request, or on
 * the sync record, is how the defect survived having tests over it.
 *
 * The route table is matched on the EXACT path. The older suite matches with
 * `url.includes(pattern)` over an insertion-ordered map, so a `/stories` entry answers
 * `/stories/story-1` as well and a pull is handed the story INDEX as its story body — a
 * trap that cost real time before. Exact match means an unrouted request shows up as an
 * unrouted request.
 */

import {render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../../../test-util';
import {useStoriesContext, type Story} from '../../../stories';
import {applyPulledStory, pullAllowed} from '../apply-pull';
import {
	clearSyncLog,
	setSyncLogEnabled,
	syncLog,
	syncLogNotes
} from '../sync-log';
import {
	memorySyncRecordStore,
	resetSyncRecordsForTests,
	storyHash,
	syncRecord,
	updateSyncRecord,
	type SyncRecordStore
} from '../sync-record';
import {newSyncRecord} from '../server.types';
import {reducer as storiesReducer} from '../../../stories/reducer';
import {testPassage, testStory} from '../test-fixtures';
import {useServerSync} from '../use-server-sync';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const BASE = 'https://example.test/api/v1';

interface Canned {
	body?: unknown;
	status?: number;
}

let routes: Record<string, Canned>;
let unrouted: string[];
let fetchMock: jest.Mock;

function json(status: number, body: unknown) {
	return {
		headers: {get: () => null},
		json: async () => body,
		ok: status >= 200 && status < 300,
		status,
		statusText: ''
	} as unknown as Response;
}

/** An index row for a story the server is holding at `rev`. */
function indexEntry(id: string, name: string, rev: number) {
	return {
		assetBytes: 0,
		assetCount: 0,
		bytes: 10,
		deleted: false,
		id,
		ifid: `IFID-${id}`,
		lastClient: 'jules',
		name,
		passageCount: 1,
		rev,
		updatedAt: '2026-01-01T00:00:00.000Z'
	};
}

/**
 * A story as `GET /stories/:id` answers it: the wrapped form, `lastUpdate` an ISO string.
 *
 * The rev has to be in the body or the ETag — `getStory` takes it from one of those, and
 * a response carrying neither pulls the text in at rev 0, which `sync-record`'s monotonic
 * guard then refuses. That is a harness mistake that looks exactly like a sync bug.
 */
function onTheWire(story: Story, rev: number) {
	return {rev, story: {...story, lastUpdate: story.lastUpdate.toISOString()}};
}

/** The local library, as the store actually holds it. */
const StoreProbe: React.FC = () => {
	const {stories} = useStoriesContext();

	useServerSync();

	return (
		<div>
			{stories.map(story => (
				<div
					data-name={story.name}
					data-testid={`store-${story.id}`}
					key={story.id}
				>
					{story.passages.map(passage => passage.text).join('|')}
				</div>
			))}
		</div>
	);
};

function renderSync(stories: Story[]) {
	return render(
		<FakeStateProvider
			prefs={{
				// Off, so that nothing this suite observes can be the autosave push
				// rather than the pull. The pull path does not consult it.
				backendAutosave: false,
				backendClientId: 'client-a',
				backendToken: 'sekrit',
				backendUrl: 'https://example.test',
				backendUsername: 'mira'
			}}
			stories={stories}
		>
			<StoreProbe />
		</FakeStateProvider>
	);
}

function storedText(id: string): string {
	return screen.getByTestId(`store-${id}`).textContent ?? '';
}

function storedName(id: string): string | null {
	return screen.getByTestId(`store-${id}`).getAttribute('data-name');
}

beforeEach(() => {
	window.localStorage.clear();
	resetSyncRecordsForTests();
	setSyncLogEnabled(true);
	clearSyncLog();
	routes = {};
	unrouted = [];
	fetchMock = jest.fn(async (input: string) => {
		const url = String(input);
		const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
		const route = routes[path];

		if (!route) {
			unrouted.push(path);
			return json(404, {error: {code: 'not_found', message: path}});
		}

		return json(route.status ?? 200, route.body ?? {});
	});
	(globalThis as Record<string, unknown>).fetch = fetchMock;
});

afterEach(() => {
	setSyncLogEnabled(false);
});

// ---------------------------------------------------------------------------
// Through the hook, against the real reducer
// ---------------------------------------------------------------------------

describe('a pull, end to end', () => {
	/**
	 * Both stories are checked out and in step; the server then moves `story-1` on.
	 * `served` is what the server hands back for it.
	 */
	function arrange(served: Story, others: Story[] = []) {
		const mine = testStory({
			id: 'story-1',
			name: 'Lighthouse',
			passages: [testPassage('story-1', {text: 'mine'})],
			sync: true
		});

		updateSyncRecord('story-1', {pushedHash: storyHash(mine), rev: 3});

		for (const other of others) {
			updateSyncRecord(other.id, {pushedHash: storyHash(other), rev: 1});
		}

		routes['/stories'] = {
			body: {
				stories: [
					indexEntry('story-1', served.name, 4),
					...others.map(other => indexEntry(other.id, other.name, 1))
				]
			}
		};
		routes['/stories/story-1'] = {body: onTheWire(served, 4)};

		for (const other of others) {
			routes[`/stories/${other.id}`] = {body: onTheWire(other, 1)};
		}

		renderSync([mine, ...others]);
	}

	it('puts the server text into the store', async () => {
		arrange(
			testStory({
				id: 'story-1',
				name: 'Lighthouse',
				passages: [testPassage('story-1', {text: 'from jules'})],
				sync: true
			})
		);

		await waitFor(() => expect(storedText('story-1')).toBe('from jules'), {
			timeout: 1500
		});
		expect(syncRecord('story-1')?.rev).toBe(4);
		expect(unrouted).not.toContain('/stories/story-1');
	});

	/**
	 * THE BUG. Somebody renamed `story-1` on the server to a name this browser is already
	 * using for a different story, so `updateStory` refuses the whole update — text and
	 * all — and says so only to `console.warn`.
	 *
	 * Written first as `it.failing` — which passes only while its assertion fails — and it
	 * did pass, over a store still holding `mine`. Flipped to `it` by the fix, assertion
	 * untouched.
	 */
	it('lands even when the incoming name is taken by another local story', async () => {
		arrange(
			testStory({
				id: 'story-1',
				name: 'Harbour',
				passages: [testPassage('story-1', {text: 'from jules'})],
				sync: true
			}),
			[
				testStory({
					id: 'story-2',
					name: 'Harbour',
					passages: [testPassage('story-2', {text: 'other'})],
					sync: true
				})
			]
		);

		await waitFor(() => expect(storedText('story-1')).toBe('from jules'), {
			timeout: 1500
		});

		// The collision is resolved the way `checkoutStory` resolves it: the incoming
		// copy takes a free name, and the story already wearing it is left alone.
		expect(storedName('story-1')).toBe('Harbour 1');
		expect(storedName('story-2')).toBe('Harbour');
	});

	/**
	 * The record must describe what actually happened. With the defect live it read
	 * `rev: 4` over a store still holding `mine`, which is what made the story
	 * unrecoverable: no later poll saw the server as ahead.
	 */
	it('never claims a rev the store did not take', async () => {
		arrange(
			testStory({
				id: 'story-1',
				name: 'Harbour',
				passages: [testPassage('story-1', {text: 'from jules'})],
				sync: true
			}),
			[
				testStory({
					id: 'story-2',
					name: 'Harbour',
					passages: [testPassage('story-2', {text: 'other'})],
					sync: true
				})
			]
		);

		await waitFor(() => expect(syncRecord('story-1')?.rev).toBe(4), {
			timeout: 1500
		});
		expect(storedText('story-1')).toBe('from jules');
	});

	/**
	 * The other half of "never record success": having refused, STOP ASKING.
	 *
	 * Arranged straight on the record, because after the rename lands there is no way to
	 * make the reducer refuse from the outside any more — which is the point. What is
	 * pinned here is the wiring in `reconcileStory`, not the predicate; `pullAllowed` has
	 * its own tests below.
	 */
	function blockedAt(blockedRev: number, serverRev: number) {
		const mine = testStory({
			id: 'story-1',
			name: 'Lighthouse',
			passages: [testPassage('story-1', {text: 'mine'})],
			sync: true
		});

		updateSyncRecord('story-1', {
			pullBlockedRev: blockedRev,
			pushedHash: storyHash(mine),
			rev: 3,
			state: 'error'
		});
		routes['/stories'] = {
			body: {stories: [indexEntry('story-1', 'Lighthouse', serverRev)]}
		};
		routes['/stories/story-1'] = {
			body: onTheWire(
				testStory({
					id: 'story-1',
					name: 'Lighthouse',
					passages: [testPassage('story-1', {text: 'from jules'})],
					sync: true
				}),
				serverRev
			)
		};
		renderSync([mine]);
	}

	function askedForTheStory() {
		return fetchMock.mock.calls.some(([url]) =>
			String(url).endsWith('/stories/story-1')
		);
	}

	it('does not ask again for a rev the store already refused', async () => {
		blockedAt(4, 4);

		await waitFor(() =>
			expect(syncLogNotes({event: 'pull'})).toContain(
				'skipped: refused at this rev'
			)
		);
		expect(askedForTheStory()).toBe(false);
		expect(storedText('story-1')).toBe('mine');
	});

	it('asks again once the server has moved on', async () => {
		blockedAt(4, 5);

		await waitFor(() => expect(storedText('story-1')).toBe('from jules'), {
			timeout: 1500
		});
		expect(syncRecord('story-1')).toMatchObject({rev: 5, state: 'idle'});
		expect(syncRecord('story-1')?.pullBlockedRev).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// The landing itself
// ---------------------------------------------------------------------------

/**
 * `applyPulledStory` without React around it.
 *
 * `dispatch` here runs the REAL stories reducer over a local array, so "did it land" is
 * the same question the app asks, answered by the same code.
 */
function store(initial: Story[]) {
	let stories = initial;
	const records: SyncRecordStore = memorySyncRecordStore();
	const pulled: string[] = [];

	return {
		get stories() {
			return stories;
		},
		dispatch: (action: any) => {
			stories = storiesReducer(stories, action);
		},
		named: (id: string) => stories.find(story => story.id === id),
		onPulled: (id: string) => pulled.push(id),
		pulled,
		records
	};
}

function serverCopy(overrides: Partial<Story> = {}): Story {
	return testStory({
		id: 'story-1',
		name: 'Lighthouse',
		passages: [testPassage('story-1', {text: 'from jules'})],
		sync: true,
		...overrides
	});
}

describe('applyPulledStory', () => {
	it('writes the text and records the rev', () => {
		const local = store([
			testStory({
				id: 'story-1',
				passages: [testPassage('story-1', {text: 'mine'})]
			})
		]);
		const incoming = serverCopy();
		const outcome = applyPulledStory({
			dispatch: local.dispatch,
			onPulled: local.onPulled,
			records: local.records,
			rev: 4,
			stories: () => local.stories,
			story: incoming
		});

		expect(outcome.landed).toBe(true);
		expect(local.named('story-1')?.passages[0].text).toBe('from jules');
		expect(local.records.get('story-1')).toMatchObject({
			pushedHash: storyHash({...incoming, sync: true}),
			rev: 4,
			state: 'idle'
		});
		expect(local.pulled).toEqual(['story-1']);
		expect(syncLogNotes({event: 'pull'})).toEqual(['landed']);
	});

	it('takes a free name when the incoming one is another story\'s', () => {
		const local = store([
			testStory({
				id: 'story-1',
				name: 'Lighthouse',
				passages: [testPassage('story-1', {text: 'mine'})]
			}),
			testStory({
				id: 'story-2',
				name: 'Harbour',
				passages: [testPassage('story-2', {text: 'other'})]
			})
		]);
		const outcome = applyPulledStory({
			dispatch: local.dispatch,
			onPulled: local.onPulled,
			records: local.records,
			rev: 4,
			stories: () => local.stories,
			story: serverCopy({name: 'Harbour'})
		});

		expect(outcome).toMatchObject({landed: true, renamedFrom: 'Harbour'});
		expect(local.named('story-1')?.name).toBe('Harbour 1');
		expect(local.named('story-1')?.passages[0].text).toBe('from jules');
		expect(local.named('story-2')?.name).toBe('Harbour');
		expect(local.records.get('story-1').rev).toBe(4);
		expect(syncLogNotes({event: 'pull'})).toEqual(['landed: renamed']);
	});

	/**
	 * The guarantee: a refused update must leave the bookkeeping exactly as it was. Not
	 * the rev, not the hash, not `lastPulledAt` — which is what the story card reads as
	 * "Synced 14:32" — and the undo stack must not be thrown away for a pull that never
	 * happened.
	 */
	it('records nothing at all when the store refuses the update', () => {
		const local = store([testStory({id: 'story-2', name: 'Harbour'})]);

		local.records.update('story-1', {pushedHash: 'old', rev: 3});

		const outcome = applyPulledStory({
			dispatch: local.dispatch,
			onPulled: local.onPulled,
			records: local.records,
			rev: 4,
			stories: () => local.stories,
			// No local copy of this story at all, so `updateStory` has nothing to update.
			story: serverCopy()
		});

		expect(outcome.landed).toBe(false);
		expect(local.records.get('story-1')).toMatchObject({
			pushedHash: 'old',
			rev: 3
		});
		expect(local.records.get('story-1').lastPulledAt).toBeUndefined();
		expect(local.pulled).toEqual([]);
		expect(syncLogNotes({event: 'pull'})).toEqual(['refused']);
	});

	it('says why it refused, and at which rev', () => {
		const local = store([]);

		applyPulledStory({
			dispatch: local.dispatch,
			onPulled: local.onPulled,
			records: local.records,
			rev: 4,
			stories: () => local.stories,
			story: serverCopy()
		});

		const entry = syncLog({event: 'pull'})[0];

		expect(entry.storyId).toBe('story-1');
		expect(entry.detail).toMatchObject({rev: 4});
		expect(String(entry.detail?.reason)).toMatch(/no local copy/i);
	});

	/**
	 * A refused pull leaves a mark the automatic path can see, so that it stops asking.
	 * The state itself is what the author sees: an error badge rather than a tick.
	 */
	it('parks the story in error, blocked at the rev it could not take', () => {
		const local = store([]);

		applyPulledStory({
			dispatch: local.dispatch,
			onPulled: local.onPulled,
			records: local.records,
			rev: 4,
			stories: () => local.stories,
			story: serverCopy()
		});

		expect(local.records.get('story-1')).toMatchObject({
			pullBlockedRev: 4,
			state: 'error'
		});
		expect(local.records.get('story-1').lastError).toBeTruthy();
	});

	it('clears the block once a pull lands', () => {
		const local = store([testStory({id: 'story-1'})]);

		local.records.update('story-1', {pullBlockedRev: 3});
		applyPulledStory({
			dispatch: local.dispatch,
			onPulled: local.onPulled,
			records: local.records,
			rev: 4,
			stories: () => local.stories,
			story: serverCopy()
		});

		expect(local.records.get('story-1').pullBlockedRev).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// The retry rule
// ---------------------------------------------------------------------------

/**
 * Why this is not "just retry": every pull that lands clears the story's undo stack
 * (`onStoryPulled`). A pull that cannot land, retried on the 30 second poll, would either
 * wipe the author's undo history twice a minute or spend a request per sweep forever. So
 * a refusal blocks the AUTOMATIC path at that rev, and only at that rev — the moment
 * somebody writes to the story again there is new text to try, and it tries.
 */
describe('pullAllowed', () => {
	it('allows a story that has never been refused', () => {
		expect(pullAllowed(newSyncRecord('story-1'), 4)).toBe(true);
	});

	it('refuses to ask again for the rev that was already refused', () => {
		expect(
			pullAllowed({...newSyncRecord('story-1'), pullBlockedRev: 4}, 4)
		).toBe(false);
	});

	it('asks again as soon as the server moves on', () => {
		expect(
			pullAllowed({...newSyncRecord('story-1'), pullBlockedRev: 4}, 5)
		).toBe(true);
	});

	/**
	 * A server that went BACKWARDS is not a fresh chance — it is the same state under a
	 * rev this browser has already failed at, or a store that was rebuilt. Either way,
	 * asking again would be the loop.
	 */
	it('stays blocked when the server rev is below the blocked one', () => {
		expect(
			pullAllowed({...newSyncRecord('story-1'), pullBlockedRev: 4}, 2)
		).toBe(false);
	});
});
