import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {StoryHistoryDialog, StoryHistoryDialogProps} from '../story-history';

const mockUseServerSync = jest.fn();

// The dialog only ever sees what the hook returns, and the real one would try to reach a
// server.

// Spread the real module: the undo provider in the render tree subscribes to
// `onStoryPulled`, and a bare object mock would take that away.
jest.mock('../../../store/persistence/server', () => ({
	...jest.requireActual('../../../store/persistence/server'),
	useServerSyncContext: () => mockUseServerSync()
}));

describe('<StoryHistoryDialog>', () => {
	const story = fakeStory();

	function fakeRevisions() {
		return {
			current: 43,
			revisions: [
				{
					at: '2026-08-21T10:12:00.000Z',
					bytes: 214880,
					client: 'mira',
					hash: 'aaa',
					passages: 83,
					rev: 43
				},
				{
					at: '2026-08-21T09:00:00.000Z',
					bytes: 200000,
					client: 'ignotas',
					hash: 'bbb',
					passages: 80,
					rev: 42
				}
			]
		};
	}

	function fakeClient(overrides?: Record<string, unknown>) {
		return {
			listRevisions: jest.fn().mockResolvedValue(fakeRevisions()),
			restoreRevision: jest.fn().mockResolvedValue({
				id: story.id,
				missingAssets: [],
				rev: 44,
				restoredFrom: 42
			}),
			...overrides
		};
	}

	function renderComponent(
		client: unknown,
		props?: Partial<StoryHistoryDialogProps>
	) {
		mockUseServerSync.mockReturnValue({
			actions: {resolveKeepMine: jest.fn(), resolveTakeTheirs: jest.fn()},
			client,
			records: {}
		});

		return render(
			<FakeStateProvider stories={[story]}>
				<StoryHistoryDialog
					collapsed={false}
					onChangeCollapsed={jest.fn()}
					onChangeHighlighted={jest.fn()}
					onChangeMaximized={jest.fn()}
					onChangeProps={jest.fn()}
					onClose={jest.fn()}
					storyId={story.id}
					{...props}
				/>
			</FakeStateProvider>
		);
	}

	it('lists revisions newest first', async () => {
		const client = fakeClient();

		renderComponent(client);

		const rows = await screen.findAllByTestId('story-history-row');

		expect(client.listRevisions).toHaveBeenCalledWith(story.id);
		expect(rows.map(row => row.dataset.rev)).toEqual(['43', '42']);
		expect(screen.getByText('dialogs.storyHistory.now')).toBeInTheDocument();
		expect(screen.getByText('210 KB')).toBeInTheDocument();
	});

	it('offers no restore button on the current version', async () => {
		renderComponent(fakeClient());
		await screen.findAllByTestId('story-history-row');
		expect(screen.getAllByTestId('story-history-restore').length).toBe(1);
	});

	it('restores a revision after confirmation', async () => {
		const client = fakeClient();
		const onClose = jest.fn();

		renderComponent(client, {onClose});
		await screen.findAllByTestId('story-history-row');
		fireEvent.click(screen.getByTestId('story-history-restore'));
		expect(client.restoreRevision).not.toHaveBeenCalled();
		expect(
			screen.getByText('dialogs.storyHistory.restoreConfirm')
		).toBeInTheDocument();
		fireEvent.click(screen.getByTestId('story-history-confirm'));
		await waitFor(() =>
			expect(client.restoreRevision).toHaveBeenCalledWith(story.id, 42)
		);
		await waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(client.listRevisions).toHaveBeenCalledTimes(2);
	});

	it('reports assets a restored version lost, and stays open', async () => {
		const client = fakeClient({
			restoreRevision: jest.fn().mockResolvedValue({
				id: story.id,
				missingAssets: ['a1', 'a2'],
				rev: 44,
				restoredFrom: 42
			})
		});
		const onClose = jest.fn();

		renderComponent(client, {onClose});
		await screen.findAllByTestId('story-history-row');
		fireEvent.click(screen.getByTestId('story-history-restore'));
		fireEvent.click(screen.getByTestId('story-history-confirm'));
		expect(
			await screen.findByTestId('story-history-missing-assets')
		).toBeInTheDocument();
		expect(onClose).not.toHaveBeenCalled();
	});

	it('shows an empty state when the story has no revisions', async () => {
		renderComponent(
			fakeClient({
				listRevisions: jest.fn().mockResolvedValue({current: 1, revisions: []})
			})
		);
		expect(
			await screen.findByTestId('story-history-empty')
		).toBeInTheDocument();
	});

	it('shows an error when the list fails to load', async () => {
		renderComponent(
			fakeClient({
				listRevisions: jest.fn().mockRejectedValue(new Error('offline'))
			})
		);
		expect(
			await screen.findByText('dialogs.storyHistory.error')
		).toBeInTheDocument();
		expect(screen.queryByTestId('story-history-row')).not.toBeInTheDocument();
	});

	it('says so when no server is configured', async () => {
		renderComponent(undefined);
		expect(
			await screen.findByText('dialogs.storyHistory.noServer')
		).toBeInTheDocument();
	});
});
