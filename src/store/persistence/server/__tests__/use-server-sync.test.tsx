import {render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../../../test-util';
import type {Story} from '../../../stories';
import {
	resetSyncRecordsForTests,
	syncRecord,
	updateSyncRecord
} from '../sync-record';
import {storyHash} from '../sync-record';
import {testStory} from '../test-fixtures';
import {useServerSync} from '../use-server-sync';

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
