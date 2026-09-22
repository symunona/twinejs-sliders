/**
 * Waking the poll on a metadata-only change, and reaching the pull from outside.
 *
 * The index row's asset signature used to be `assetCount:assetBytes`, and neither number
 * moves when what changed is an edit's settings, an anchor or a cutout sidecar: the bytes
 * are the same bytes and there are the same number of them. So the 30 s poll, the 5 min
 * poll and Refresh From Server all read the row as unmoved and skipped the story, and the
 * far side drew the old picture until its page was reloaded. `assetRev` is the manifest's
 * own rev and moves on every manifest write, which is exactly the question being asked.
 *
 * Every test here drives the real hook and asserts on `pullStoryAssets` — the decision to
 * run a pull is the whole subject, and the download itself has its own suite
 * (`pull-assets.test.ts`). That module is mocked for the same reason: what it does with a
 * manifest is not what is being checked, and a real one would need a server.
 *
 * Polls are driven by calling `actions.refresh()` rather than by advancing a timer. The
 * hook's interval only calls that, so a fake clock would add a moving part without adding
 * a question, and `waitFor` and fake timers are a bad pair.
 */

import {act, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../../../test-util';
import type {Story} from '../../../stories';
import {pullStoryAssets, type AssetPullResult} from '../pull-assets';
import type {StoryIndexEntry} from '../server.types';
import {
	resetSyncRecordsForTests,
	storyHash,
	updateSyncRecord
} from '../sync-record';
import {settle, testStory} from '../test-fixtures';
import {useServerSync, type ServerSyncContextProps} from '../use-server-sync';

jest.mock('../pull-assets', () => ({pullStoryAssets: jest.fn()}));

const pullMock = pullStoryAssets as jest.MockedFunction<typeof pullStoryAssets>;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const BASE = 'https://example.test/api/v1';

let indexRows: StoryIndexEntry[];
let fetchMock: jest.Mock;
/** The context as of the last render. The tests call `pullAssets` through it. */
let sync: ServerSyncContextProps;

function json(status: number, body: unknown) {
	return {
		headers: {get: () => null},
		json: async () => body,
		ok: status >= 200 && status < 300,
		status,
		statusText: ''
	} as unknown as Response;
}

/**
 * An index row for a story the server holds.
 *
 * `assetRev` is `undefined`-able on purpose: the whole point of one of the tests below is
 * a server too old to send the field at all, and a helper that always filled it in would
 * make that case unwritable.
 */
function indexEntry(overrides: Partial<StoryIndexEntry> = {}): StoryIndexEntry {
	return {
		assetBytes: 4096,
		assetCount: 2,
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

/** A row with no `assetRev` at all, as a server that predates the field answers. */
function oldServerEntry(overrides: Partial<StoryIndexEntry> = {}) {
	const entry: Partial<StoryIndexEntry> = indexEntry(overrides);

	delete entry.assetRev;

	return entry as StoryIndexEntry;
}

function pullResult(overrides: Partial<AssetPullResult> = {}): AssetPullResult {
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

const Probe: React.FC = () => {
	sync = useServerSync();

	return <span data-testid="connected">{String(sync.connected)}</span>;
};

/**
 * The story is in step with the server — same rev, same hash — so the reconcile table
 * answers `none` for it and nothing in these tests can be a story pull in disguise.
 * `backendAutosave` is off for the other half of that: no push path either.
 */
async function renderSync(
	story: Story = testStory({id: 'story-1', sync: true})
) {
	updateSyncRecord(story.id, {pushedHash: storyHash(story), rev: 4});

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
			<Probe />
		</FakeStateProvider>
	);

	await waitFor(() =>
		expect(screen.getByTestId('connected')).toHaveTextContent('true')
	);
	await act(async () => {
		await settle();
	});
}

/** One more `GET /stories`, the way the interval and Refresh From Server do it. */
async function poll() {
	await act(async () => {
		await sync.actions.refresh();
		await settle();
	});
}

beforeEach(() => {
	window.localStorage.clear();
	resetSyncRecordsForTests();
	indexRows = [indexEntry()];
	pullMock.mockResolvedValue(pullResult());
	fetchMock = jest.fn(async (input: string) => {
		const path = String(input).replace(BASE, '');

		if (path === '/stories') {
			// A COPY per response, because a real one is parsed out of fresh bytes every
			// time. Handing back the same array twice makes `setIndex` a no-op — React bails
			// on an identical reference — and the `[index]` effect never runs a second time,
			// so a test asserting "polled again and did not pull" would pass without the
			// signature compare ever being reached. Found exactly that way: the assertion
			// held with the signature deliberately broken.
			return json(200, {stories: indexRows.map(row => ({...row}))});
		}

		return json(404, {error: {code: 'not_found', message: path}});
	});
	(globalThis as Record<string, unknown>).fetch = fetchMock;
});

// ---------------------------------------------------------------------------
// The signature
// ---------------------------------------------------------------------------

describe('the index row asset signature', () => {
	it('pulls when only assetRev has moved', async () => {
		await renderSync();

		// First sight of the story is a change, deliberately — that is what repairs a
		// browser holding art from before any of this existed.
		expect(pullMock).toHaveBeenCalledTimes(1);

		// The manifest was rewritten and nothing was added or removed: an edit's settings,
		// an anchor, a cutout sidecar. Both totals stand still.
		indexRows = [indexEntry({assetRev: 8})];
		await poll();

		expect(pullMock).toHaveBeenCalledTimes(2);
		expect(pullMock).toHaveBeenLastCalledWith(
			expect.objectContaining({storyId: 'story-1'})
		);
	});

	it('does not pull when nothing has moved', async () => {
		await renderSync();
		expect(pullMock).toHaveBeenCalledTimes(1);

		await poll();
		await poll();

		expect(pullMock).toHaveBeenCalledTimes(1);
	});

	it('pulls when the totals move and the rev stands still', async () => {
		// The pre-`assetRev` question, still asked: a server that has not been upgraded
		// answers this one and only this one, so it has to keep working.
		await renderSync();
		indexRows = [indexEntry({assetBytes: 9000, assetCount: 3})];
		await poll();

		expect(pullMock).toHaveBeenCalledTimes(2);
	});

	it('does not pull on every poll against a server that sends no assetRev', async () => {
		// THE COST OF GETTING THIS WRONG. A missing field read as "changed" would pull
		// every story on every poll, forever, for as long as the tab is open — a manifest
		// GET per story per 30 s, against a server that has nothing new to say. The
		// fallback is a constant for exactly this reason.
		indexRows = [oldServerEntry()];
		await renderSync();
		expect(pullMock).toHaveBeenCalledTimes(1);

		await poll();
		await poll();
		await poll();

		expect(pullMock).toHaveBeenCalledTimes(1);
	});

	it('still notices a totals change against a server that sends no assetRev', async () => {
		// The degradation is to the old behaviour, not to no behaviour.
		indexRows = [oldServerEntry()];
		await renderSync();

		indexRows = [oldServerEntry({assetBytes: 9000, assetCount: 3})];
		await poll();

		expect(pullMock).toHaveBeenCalledTimes(2);
	});

	it('leaves a story it does not sync alone', async () => {
		await renderSync(testStory({id: 'story-1', sync: false}));

		await poll();

		expect(pullMock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// The context member
// ---------------------------------------------------------------------------

describe('pullAssets on the context', () => {
	it('reaches pullStoryAssets and hands back its result', async () => {
		await renderSync();
		pullMock.mockClear();

		const landed = pullResult({
			changed: true,
			downloaded: ['a_8f21'],
			rev: 9,
			skipped: false
		});

		pullMock.mockResolvedValue(landed);

		let result: AssetPullResult | undefined;

		await act(async () => {
			result = await sync.pullAssets('story-1');
		});

		expect(pullMock).toHaveBeenCalledTimes(1);
		expect(pullMock).toHaveBeenCalledWith(
			expect.objectContaining({storyId: 'story-1'})
		);
		// `changed` is what the caller is actually asking about — see `pull-assets.ts`.
		expect(result).toEqual(landed);
	});

	it('answers undefined for a story this browser does not sync', async () => {
		await renderSync(testStory({id: 'story-1', sync: false}));

		let result: AssetPullResult | undefined = pullResult();

		await act(async () => {
			result = await sync.pullAssets('story-1');
		});

		expect(result).toBeUndefined();
		expect(pullMock).not.toHaveBeenCalled();
	});

	it('answers undefined when the pull throws', async () => {
		await renderSync();
		pullMock.mockClear();
		pullMock.mockRejectedValue(new Error('no manifest'));

		let result: AssetPullResult | undefined = pullResult();

		await act(async () => {
			result = await sync.pullAssets('story-1');
		});

		expect(result).toBeUndefined();
	});

	it('shares one run between two callers rather than dropping the second', async () => {
		await renderSync();
		pullMock.mockClear();

		// Held open so both asks are demonstrably in flight at once.
		let land: (result: AssetPullResult) => void = () => undefined;

		pullMock.mockReturnValue(
			new Promise<AssetPullResult>(resolve => {
				land = resolve;
			})
		);

		const landed = pullResult({rev: 11});
		let first: AssetPullResult | undefined;
		let second: AssetPullResult | undefined;

		await act(async () => {
			const a = sync.pullAssets('story-1');
			const b = sync.pullAssets('story-1');

			land(landed);
			[first, second] = await Promise.all([a, b]);
		});

		// One run, and BOTH callers hear how it went. The second is not dropped and not
		// deferred; it is handed the first one's promise.
		expect(pullMock).toHaveBeenCalledTimes(1);
		expect(first).toEqual(landed);
		expect(second).toEqual(landed);

		// And the sharing lasts exactly as long as the run does.
		pullMock.mockResolvedValue(pullResult({rev: 12}));

		await act(async () => {
			await sync.pullAssets('story-1');
		});

		expect(pullMock).toHaveBeenCalledTimes(2);
	});
});
