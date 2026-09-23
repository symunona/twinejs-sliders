import {act, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../../../test-util';
import type {Story} from '../../../stories';
import * as assetSync from '../asset-sync';
import {ServerError} from '../client';
import * as pullAssetsModule from '../pull-assets';
import {clearSyncLog, setSyncLogEnabled, syncLog} from '../sync-log';
import {
	resetSyncRecordsForTests,
	syncRecord,
	updateSyncRecord
} from '../sync-record';
import {storyHash} from '../sync-record';
import {settle, testStory} from '../test-fixtures';
import {useServerSync, type ServerSyncContextProps} from '../use-server-sync';

interface Route {
	body?: unknown;
	status?: number;
}

function json(
	status: number,
	body: unknown,
	headers: Record<string, string> = {}
) {
	const lower = Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
	);

	return {
		headers: {get: (name: string) => lower[name.toLowerCase()] ?? null},
		json: async () => body,
		ok: status >= 200 && status < 300,
		status,
		statusText: ''
	} as unknown as Response;
}

let routes: Record<string, Route>;
let fetchMock: jest.Mock;

const Probe: React.FC = () => {
	const sync = useServerSync();

	return (
		<div>
			<span data-testid="connected">{String(sync.connected)}</span>
			<span data-testid="ghosts">
				{sync.ghosts.map(ghost => ghost.name).join(',')}
			</span>
		</div>
	);
};

function renderSync(stories: Story[]) {
	return render(
		<FakeStateProvider
			prefs={{
				backendAutosave: true,
				backendClientId: '',
				backendToken: 'sekrit',
				backendUrl: 'https://example.test',
				backendUsername: 'mira'
			}}
			stories={stories}
		>
			<Probe />
		</FakeStateProvider>
	);
}

beforeEach(() => {
	window.localStorage.clear();
	resetSyncRecordsForTests();
	routes = {};
	fetchMock = jest.fn(async (url: string) => {
		for (const [pattern, route] of Object.entries(routes)) {
			if (url.includes(pattern)) {
				return json(route.status ?? 200, route.body ?? {});
			}
		}

		return json(404, {error: {code: 'not_found', message: 'no route'}});
	});
	(globalThis as Record<string, unknown>).fetch = fetchMock;
});

describe('useServerSync', () => {
	it('mints a client id, connects, and lists ghosts', async () => {
		routes['/stories'] = {
			body: {
				stories: [
					{
						assetBytes: 0,
						assetCount: 0,
						bytes: 10,
						deleted: false,
						id: 'remote-1',
						ifid: 'IFID-R',
						lastClient: 'mira',
						name: 'Harbour',
						passageCount: 3,
						rev: 5,
						updatedAt: '2026-08-21T10:12:00.000Z'
					}
				]
			}
		};

		renderSync([testStory({id: 'local-1', sync: false})]);

		await waitFor(() =>
			expect(screen.getByTestId('connected')).toHaveTextContent('true')
		);
		expect(screen.getByTestId('ghosts')).toHaveTextContent('Harbour');

		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			{headers: Record<string, string>}
		];

		expect(url).toBe('https://example.test/api/v1/stories');
		expect(init.headers['X-Client-Name']).toBe('mira');
		expect(init.headers['X-Client-Id']).not.toBe('');
	});

	it('exposes the live state for the Playwright suite', async () => {
		routes['/stories'] = {body: {stories: []}};
		renderSync([testStory({id: 'local-1', sync: false})]);

		await waitFor(() =>
			expect((globalThis as Record<string, any>).__slidersSync?.connected).toBe(
				true
			)
		);
	});

	it('marks a synced story gone when the server no longer lists it', async () => {
		const story = testStory({id: 'story-1', sync: true});

		updateSyncRecord('story-1', {pushedHash: storyHash(story), rev: 3});
		routes['/stories'] = {body: {stories: []}};

		renderSync([story]);

		await waitFor(() => expect(syncRecord('story-1')?.state).toBe('gone'));
	});

	it('takes a conflict when the server is ahead and the local copy is dirty', async () => {
		const story = testStory({id: 'story-1', sync: true});

		updateSyncRecord('story-1', {pushedHash: 'stale-hash', rev: 3});
		routes['/stories'] = {
			body: {
				stories: [
					{
						assetBytes: 0,
						assetCount: 0,
						bytes: 10,
						deleted: false,
						id: 'story-1',
						ifid: 'IFID-1',
						lastClient: 'mira',
						name: 'Lighthouse',
						passageCount: 1,
						rev: 9,
						updatedAt: '2026-08-21T10:12:00.000Z'
					}
				]
			}
		};

		renderSync([story]);

		await waitFor(() =>
			expect(syncRecord('story-1')).toMatchObject({
				conflictClient: 'mira',
				conflictRev: 9,
				state: 'conflict'
			})
		);
	});

	it('reports a server that will not answer without breaking the render', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		renderSync([testStory({id: 'story-1', sync: true})]);

		await waitFor(() => expect(fetchMock).toHaveBeenCalled());
		expect(screen.getByTestId('connected')).toHaveTextContent('false');
	});
});

// ---------------------------------------------------------------------------
// The websocket wiring
// ---------------------------------------------------------------------------

/**
 * A `WebSocket` for jsdom, which has none.
 *
 * Installed globally rather than injected: the hook builds its socket from prefs and has
 * no seam for a factory, and giving it one purely for a test would put a production
 * argument in place to serve a test. `events.test.ts` covers the socket itself; what is
 * being checked here is only that the hook listens to it.
 */
class FakeWebSocket {
	static last: FakeWebSocket | undefined;

	readyState = 1;
	sent: string[] = [];
	onopen: ((event: unknown) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;
	onmessage: ((event: {data: unknown}) => void) | null = null;

	constructor(
		readonly url: string,
		readonly protocols: string[]
	) {
		FakeWebSocket.last = this;
	}

	close() {
		this.readyState = 3;
	}

	send(data: string) {
		this.sent.push(data);
	}

	deliver(message: unknown) {
		act(() => {
			this.onmessage?.({data: JSON.stringify(message)});
		});
	}

	get messages(): {t: string}[] {
		return this.sent.map(item => JSON.parse(item));
	}
}

describe('useServerSync over the websocket', () => {
	beforeEach(() => {
		FakeWebSocket.last = undefined;
		(globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;
	});

	afterEach(() => {
		delete (globalThis as Record<string, unknown>).WebSocket;
	});

	/** An index row, so the first poll does not tombstone the story under the test. */
	function indexEntry(id: string, rev: number) {
		return {
			assetBytes: 0,
			assetCount: 0,
			bytes: 10,
			deleted: false,
			id,
			ifid: 'IFID-1',
			lastClient: 'mira',
			name: 'Lighthouse',
			passageCount: 1,
			rev,
			updatedAt: '2026-08-21T10:12:00.000Z'
		};
	}

	async function connect(stories: Story[], index: unknown[] = []) {
		routes['/stories'] = {body: {stories: index}};
		renderSync(stories);

		await waitFor(() => expect(FakeWebSocket.last).toBeDefined());

		const socket = FakeWebSocket.last!;

		act(() => {
			socket.onopen?.({});
		});

		return socket;
	}

	it('says hello with the checked-out story ids', async () => {
		const socket = await connect(
			[
				testStory({id: 'story-1', sync: true}),
				testStory({id: 'story-2', sync: false})
			],
			[indexEntry('story-1', 3)]
		);

		expect(socket.protocols).toEqual(['bearer', 'sekrit']);
		expect(socket.messages[0]).toMatchObject({
			name: 'mira',
			stories: ['story-1'],
			t: 'hello'
		});
	});

	it('publishes presence for the Playwright suite', async () => {
		const socket = await connect([testStory({id: 'story-1', sync: true})]);
		const client = {
			id: 'them',
			name: 'jules',
			passage: 'p1',
			since: '2026-08-21T10:00:00.000Z',
			story: 'story-1'
		};

		socket.deliver({clients: [client], t: 'welcome'});

		await waitFor(() =>
			expect(
				(globalThis as Record<string, any>).__slidersSync?.socketConnected
			).toBe(true)
		);
		expect((globalThis as Record<string, any>).__slidersSync?.presence).toEqual(
			[client]
		);
	});

	it('pulls on a story message the same way a poll would', async () => {
		const story = testStory({id: 'story-1', sync: true});

		updateSyncRecord('story-1', {pushedHash: storyHash(story), rev: 3});

		const socket = await connect([story], [indexEntry('story-1', 3)]);

		socket.deliver({clients: [], t: 'welcome'});
		routes['/stories/story-1'] = {
			body: {...story, lastUpdate: story.lastUpdate.toISOString()}
		};
		socket.deliver({by: 'jules', id: 'story-1', rev: 4, t: 'story'});

		await waitFor(() =>
			expect(
				fetchMock.mock.calls.some(([url]) =>
					String(url).endsWith('/stories/story-1')
				)
			).toBe(true)
		);
	});

	it('marks a story gone on a tombstone message', async () => {
		const story = testStory({id: 'story-1', sync: true});

		updateSyncRecord('story-1', {pushedHash: storyHash(story), rev: 3});

		const socket = await connect([story], [indexEntry('story-1', 3)]);

		socket.deliver({clients: [], t: 'welcome'});
		// The poll saw a healthy story, so the tombstone can only have come from here.
		expect(syncRecord('story-1')?.state).not.toBe('gone');
		socket.deliver({by: 'jules', id: 'story-1', t: 'deleted'});

		await waitFor(() => expect(syncRecord('story-1')?.state).toBe('gone'));
	});
});

// ---------------------------------------------------------------------------
// Art: If-Match on push, one bounded retry, pull warnings
// ---------------------------------------------------------------------------

/**
 * `syncStoryAssets` and `pullStoryAssets` are spied, not run: what is under test is the
 * hook's DECISIONS — which rev it sends, how often it pulls and retries, what it shows.
 * The two functions have their own suites, including a two-device one in
 * `asset-sync.test.ts`.
 */
describe('useServerSync asset push', () => {
	const BASE = 'https://example.test/api/v1';
	let sync: ServerSyncContextProps;
	let indexRows: Record<string, unknown>[];
	let syncSpy: jest.SpyInstance;
	let pullSpy: jest.SpyInstance;
	let logWas: boolean;

	const AssetProbe: React.FC = () => {
		sync = useServerSync();

		return <span data-testid="last-error">{sync.lastError ?? ''}</span>;
	};

	function pullResult(
		overrides: Partial<pullAssetsModule.AssetPullResult> = {}
	): pullAssetsModule.AssetPullResult {
		return {
			changed: false,
			downloaded: [],
			missing: [],
			missingSidecars: [],
			rev: 7,
			skipped: true,
			warnings: [],
			...overrides
		};
	}

	function pushResult(
		overrides: Partial<assetSync.AssetSyncResult> = {}
	): assetSync.AssetSyncResult {
		return {
			assetCount: 1,
			characterCount: 0,
			fingerprint: 'fp-1',
			missingLocally: [],
			missingSidecars: [],
			rev: 8,
			skipped: [],
			syncedHashes: new Map([['a_8f21', 'hash-1']]),
			unchanged: false,
			unresolved: [],
			uploaded: [],
			uploadedSidecars: [],
			...overrides
		};
	}

	function conflict(rev = 9) {
		return new ServerError('rev mismatch', {
			code: 'conflict',
			rev,
			status: 412
		});
	}

	function row(overrides: Record<string, unknown> = {}) {
		return {
			assetBytes: 4096,
			assetCount: 1,
			assetRev: 7,
			bytes: 10,
			deleted: false,
			id: 'story-1',
			ifid: 'IFID-1',
			lastClient: 'jules',
			name: 'Lighthouse',
			passageCount: 1,
			rev: 4,
			updatedAt: '2026-01-01T00:00:00.000Z',
			...overrides
		};
	}

	/** `ifMatch` of every `syncStoryAssets` call, in order. */
	function sentRevs() {
		return syncSpy.mock.calls.map(
			([options]) => (options as {ifMatch?: number}).ifMatch
		);
	}

	function assetNotes() {
		return syncLog({event: 'asset', storyId: 'story-1'}).map(
			entry => entry.note
		);
	}

	async function mount(story: Story) {
		render(
			<FakeStateProvider
				prefs={{
					backendAutosave: false,
					backendClientId: 'client-a',
					backendToken: 'sekrit',
					backendUrl: 'https://example.test',
					backendUsername: 'mira'
				}}
				stories={[story]}
			>
				<AssetProbe />
			</FakeStateProvider>
		);

		await waitFor(() => expect(sync.connected).toBe(true));
		await act(async () => {
			await settle();
		});
	}

	async function publish(story: Story) {
		await act(async () => {
			await sync.actions.publish(story);
			await settle();
		});
	}

	async function poll() {
		await act(async () => {
			await sync.actions.refresh();
			await settle();
		});
	}

	beforeEach(() => {
		logWas = setSyncLogEnabled(true);
		clearSyncLog();
		indexRows = [];
		syncSpy = jest
			.spyOn(assetSync, 'syncStoryAssets')
			.mockResolvedValue(pushResult());
		pullSpy = jest
			.spyOn(pullAssetsModule, 'pullStoryAssets')
			.mockResolvedValue(pullResult());
		fetchMock.mockImplementation(
			async (url: string, init: {method?: string} = {}) => {
				const path = String(url).replace(BASE, '');

				if (path === '/stories') {
					// A copy per response, or React bails on the identical array and the
					// index effect never re-runs (see `asset-wakeup.test.tsx`).
					return json(200, {stories: indexRows.map(item => ({...item}))});
				}

				if (path === '/stories/story-1' && init.method === 'PUT') {
					return json(200, {
						bytes: 10,
						id: 'story-1',
						rev: 5,
						updatedAt: '2026-01-01T00:00:00.000Z'
					});
				}

				return json(404, {error: {code: 'not_found', message: path}});
			}
		);
	});

	afterEach(() => {
		syncSpy.mockRestore();
		pullSpy.mockRestore();
		setSyncLogEnabled(logWas);
	});

	it('pulls first when it has no rev, then pushes with If-Match at that rev', async () => {
		await mount(testStory({id: 'story-1', sync: false}));
		await publish(testStory({id: 'story-1', sync: false}));

		expect(pullSpy).toHaveBeenCalledTimes(1);
		expect(pullSpy.mock.invocationCallOrder[0]).toBeLessThan(
			syncSpy.mock.invocationCallOrder[0]
		);
		expect(sentRevs()).toEqual([7]);
	});

	it('on a 412 pulls once and pushes once more at the new rev', async () => {
		pullSpy
			.mockResolvedValueOnce(pullResult({rev: 7}))
			.mockResolvedValueOnce(pullResult({rev: 9, skipped: false}));
		syncSpy
			.mockRejectedValueOnce(conflict(9))
			.mockResolvedValueOnce(pushResult({rev: 10}));

		await mount(testStory({id: 'story-1', sync: false}));
		await publish(testStory({id: 'story-1', sync: false}));

		expect(sentRevs()).toEqual([7, 9]);
		expect(pullSpy).toHaveBeenCalledTimes(2);
		expect(screen.getByTestId('last-error')).toHaveTextContent('');
	});

	it('stops after a second 412, quietly', async () => {
		syncSpy.mockRejectedValue(conflict());

		await mount(testStory({id: 'story-1', sync: false}));
		await publish(testStory({id: 'story-1', sync: false}));
		await act(async () => {
			await settle(20);
		});

		// One attempt, one pull, one retry. No loop, no banner.
		expect(syncSpy).toHaveBeenCalledTimes(2);
		expect(pullSpy).toHaveBeenCalledTimes(2);
		expect(screen.getByTestId('last-error')).toHaveTextContent('');
		expect(assetNotes()).toEqual([
			'push 412: pulling once',
			'push 412 again: waiting'
		]);
	});

	it('does not pull or push again on polls where nothing moved', async () => {
		await mount(testStory({id: 'story-1', sync: false}));
		await publish(testStory({id: 'story-1', sync: false}));

		// The server row now carries our own manifest write.
		indexRows = [row({assetRev: 8, rev: 5})];
		await poll();

		const pulls = pullSpy.mock.calls.length;

		await poll();
		await poll();
		await poll();

		expect(pullSpy).toHaveBeenCalledTimes(pulls);
		expect(syncSpy).toHaveBeenCalledTimes(1);
	});

	it('shows pull warnings once, not on every poll', async () => {
		const story = testStory({id: 'story-1', sync: true});
		const clash = 'Your library already has a different image named "night".';

		updateSyncRecord('story-1', {pushedHash: storyHash(story), rev: 4});
		pullSpy.mockResolvedValue(pullResult({skipped: false, warnings: [clash]}));
		indexRows = [row()];
		await mount(story);

		expect(screen.getByTestId('last-error')).toHaveTextContent(clash);

		// The same unlandable row comes back on every manifest rev.
		for (const assetRev of [8, 9, 10]) {
			indexRows = [row({assetRev})];
			await poll();
		}

		expect(pullSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
		expect(assetNotes().filter(note => note === 'pull warnings')).toHaveLength(
			1
		);

		// A different set is news again.
		pullSpy.mockResolvedValue(
			pullResult({skipped: false, warnings: [clash, 'another']})
		);
		indexRows = [row({assetRev: 11})];
		await poll();

		expect(assetNotes().filter(note => note === 'pull warnings')).toHaveLength(
			2
		);
	});
});
