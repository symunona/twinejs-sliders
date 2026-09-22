import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {fakeServer} from '../../../store/persistence/server/fake-server';
import {notifyRevisionMeta} from '../../../store/persistence/server/server-message';
import {
	clearSyncReasons,
	peekSyncReason
} from '../../../store/persistence/server/sync-reason';
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
			setRevisionMeta: jest
				.fn()
				.mockImplementation(
					async (
						id: string,
						rev: number,
						meta: {label?: string; pinned?: boolean}
					) => ({
						id,
						label: meta.label ?? '',
						pinned: meta.pinned ?? false,
						pinnedMax: 50,
						pins: meta.pinned ? 1 : 0,
						rev,
						summary: ''
					})
				),
			...overrides
		};
	}

	beforeEach(() => clearSyncReasons());

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

	// -------------------------------------------------------------------
	// Labels, summaries and pins
	// -------------------------------------------------------------------

	/**
	 * `revisions()` overrides the two rows the rest of the suite shares, so a case can
	 * state only the fields it is about.
	 */
	function labelled(rows: Record<string, unknown>[]) {
		const base = fakeRevisions();

		return {
			...base,
			revisions: base.revisions.map((revision, index) => ({
				...revision,
				...(rows[index] ?? {})
			}))
		};
	}

	function withRows(rows: Record<string, unknown>[]) {
		return fakeClient({
			listRevisions: jest.fn().mockResolvedValue(labelled(rows))
		});
	}

	it('shows the derived summary when nobody has labelled the version', async () => {
		renderComponent(withRows([{summary: 'Tavern Night +2 more'}]));

		const titles = await screen.findAllByTestId('story-history-title');

		expect(titles[0]).toHaveTextContent('Tavern Night +2 more');
	});

	it('shows a human label instead of the derived summary', async () => {
		renderComponent(
			withRows([{label: 'Before the tavern broke', summary: 'Tavern Night'}])
		);

		const titles = await screen.findAllByTestId('story-history-title');

		expect(titles[0]).toHaveTextContent('Before the tavern broke');
		expect(screen.queryByText('Tavern Night')).not.toBeInTheDocument();
	});

	it('shows neither when the version has neither', async () => {
		renderComponent(fakeClient());
		await screen.findAllByTestId('story-history-row');
		expect(screen.queryByTestId('story-history-title')).not.toBeInTheDocument();
	});

	it('labels a version from the pencil', async () => {
		const client = withRows([{summary: 'Tavern Night'}]);

		renderComponent(client);
		fireEvent.click((await screen.findAllByTestId('story-history-label'))[0]);
		fireEvent.change(screen.getByRole('textbox'), {
			target: {value: '  Before the tavern broke  '}
		});
		fireEvent.click(screen.getByTestId('story-history-label-save'));

		await waitFor(() =>
			expect(client.setRevisionMeta).toHaveBeenCalledWith(story.id, 43, {
				label: 'Before the tavern broke'
			})
		);

		const titles = await screen.findAllByTestId('story-history-title');

		expect(titles[0]).toHaveTextContent('Before the tavern broke');
	});

	it('clears a label back to the derived summary on an empty submit', async () => {
		const client = withRows([
			{label: 'Before the tavern broke', summary: 'Tavern Night'}
		]);

		// The row as the server answers a cleared label: `label` gone, `summary` still
		// there. The two are separate fields; clearing one cannot touch the other.
		client.setRevisionMeta = jest.fn().mockResolvedValue({
			id: story.id,
			label: '',
			pinned: false,
			pinnedMax: 50,
			pins: 0,
			rev: 43,
			summary: 'Tavern Night'
		});

		renderComponent(client);
		fireEvent.click((await screen.findAllByTestId('story-history-label'))[0]);
		fireEvent.change(screen.getByRole('textbox'), {target: {value: ''}});
		fireEvent.click(screen.getByTestId('story-history-label-save'));

		await waitFor(() =>
			expect(client.setRevisionMeta).toHaveBeenCalledWith(story.id, 43, {
				label: ''
			})
		);

		const titles = await screen.findAllByTestId('story-history-title');

		expect(titles[0]).toHaveTextContent('Tavern Night');
	});

	it('pins a version and marks it', async () => {
		const client = fakeClient();

		renderComponent(client);
		expect(screen.queryByTestId('story-history-pinned')).not.toBeInTheDocument();
		fireEvent.click((await screen.findAllByTestId('story-history-pin'))[1]);

		await waitFor(() =>
			expect(client.setRevisionMeta).toHaveBeenCalledWith(story.id, 42, {
				pinned: true
			})
		);
		expect(await screen.findByTestId('story-history-pinned')).toBeInTheDocument();
	});

	it('unpins a version that arrived pinned', async () => {
		const client = withRows([{}, {pinned: true}]);

		renderComponent(client);
		expect(
			await screen.findByTestId('story-history-pinned')
		).toBeInTheDocument();
		fireEvent.click(screen.getAllByTestId('story-history-pin')[1]);

		await waitFor(() =>
			expect(client.setRevisionMeta).toHaveBeenCalledWith(story.id, 42, {
				pinned: false
			})
		);
		await waitFor(() =>
			expect(
				screen.queryByTestId('story-history-pinned')
			).not.toBeInTheDocument()
		);
	});

	it('labels and pins the current version too', async () => {
		const client = fakeClient();

		renderComponent(client);

		// Two rows, two pencils and two pins -- the top one included. The server parks
		// the current version's label on meta.json, so there is nothing to refuse.
		expect((await screen.findAllByTestId('story-history-label')).length).toBe(2);
		expect(screen.getAllByTestId('story-history-pin').length).toBe(2);

		fireEvent.click(screen.getAllByTestId('story-history-label')[0]);
		fireEvent.change(screen.getByRole('textbox'), {
			target: {value: 'checkpoint'}
		});
		fireEvent.click(screen.getByTestId('story-history-label-save'));

		await waitFor(() =>
			expect(client.setRevisionMeta).toHaveBeenCalledWith(story.id, 43, {
				label: 'checkpoint'
			})
		);
	});

	it("shows the server's own message when a pin hits the cap", async () => {
		// Driven through `fakeServer` rather than a canned rejection: the cap, its count
		// and the sentence that names PINNED_MAX all belong to the server, and a mock
		// that invented the message would prove only that a string can be rendered.
		const server = fakeServer({pinnedMax: 1});

		server.seed(story, {
			rev: 43,
			revisions: [
				{
					at: '2026-08-21T09:00:00.000Z',
					bytes: 200000,
					client: 'ignotas',
					hash: 'bbb',
					passages: 80,
					rev: 42
				}
			]
		});

		renderComponent(server.client({id: 'c1', name: 'mira'}));

		fireEvent.click((await screen.findAllByTestId('story-history-pin'))[0]);
		expect(
			await screen.findByTestId('story-history-pinned')
		).toBeInTheDocument();

		fireEvent.click(screen.getAllByTestId('story-history-pin')[1]);

		const detail = await screen.findByTestId('story-history-error-detail');

		expect(detail).toHaveTextContent('PINNED_MAX');
		expect(detail).toHaveTextContent('1 pinned revisions');
	});

	it('re-lists when someone else labels a revision of this story', async () => {
		const client = fakeClient();

		renderComponent(client);
		await screen.findAllByTestId('story-history-row');
		expect(client.listRevisions).toHaveBeenCalledTimes(1);

		client.listRevisions.mockResolvedValue(labelled([{label: 'theirs'}]));
		act(() => notifyRevisionMeta(story.id, 43));

		expect(await screen.findByText('theirs')).toBeInTheDocument();
		expect(client.listRevisions).toHaveBeenCalledTimes(2);
	});

	it('ignores a revmeta about some other story', async () => {
		const client = fakeClient();

		renderComponent(client);
		await screen.findAllByTestId('story-history-row');
		act(() => notifyRevisionMeta('some-other-story', 7));
		expect(client.listRevisions).toHaveBeenCalledTimes(1);
	});

	it('notes `restore` as the reason for whatever it pushes next', async () => {
		const client = fakeClient();

		renderComponent(client);
		await screen.findAllByTestId('story-history-row');
		expect(peekSyncReason(story.id)).toBeUndefined();
		fireEvent.click(screen.getByTestId('story-history-restore'));
		fireEvent.click(screen.getByTestId('story-history-confirm'));

		await waitFor(() => expect(client.restoreRevision).toHaveBeenCalled());
		expect(peekSyncReason(story.id)).toBe('restore');
	});
});
