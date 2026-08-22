import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {
	ServerConflictDialog,
	ServerConflictDialogProps
} from '../server-conflict';

const mockUseServerSync = jest.fn();

// The dialog only ever sees what the hook returns, and the real one would try to reach a
// server.

// Spread the real module: the undo provider in the render tree subscribes to
// `onStoryPulled`, and a bare object mock would take that away.
jest.mock('../../../store/persistence/server', () => ({
	...jest.requireActual('../../../store/persistence/server'),
	useServerSyncContext: () => mockUseServerSync()
}));

describe('<ServerConflictDialog>', () => {
	const story = fakeStory(3);

	function renderComponent(
		overrides?: Record<string, unknown>,
		props?: Partial<ServerConflictDialogProps>
	) {
		const actions = {
			resolveKeepMine: jest.fn().mockResolvedValue(undefined),
			resolveTakeTheirs: jest.fn().mockResolvedValue(undefined)
		};
		const client = {
			getStory: jest.fn().mockResolvedValue({
				...story,
				lastUpdate: '2026-08-21T10:12:00.000Z',
				name: 'Lighthouse'
			})
		};

		mockUseServerSync.mockReturnValue({
			actions,
			client,
			records: {
				[story.id]: {
					conflictClient: 'mira',
					conflictRev: 43,
					pushedHash: 'aaa',
					rev: 42,
					state: 'conflict',
					storyId: story.id
				}
			},
			...overrides
		});

		const result = render(
			<FakeStateProvider stories={[story]}>
				<ServerConflictDialog
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

		return {actions, client, ...result};
	}

	it('shows both versions of the story', async () => {
		const {client} = renderComponent();

		expect(await screen.findByText('Lighthouse')).toBeInTheDocument();
		expect(client.getStory).toHaveBeenCalledWith(story.id);
		expect(screen.getByText(story.name)).toBeInTheDocument();
		expect(
			screen.getByText('dialogs.serverConflict.savedBy')
		).toBeInTheDocument();
	});

	it('keeps the local version when Keep mine is clicked', async () => {
		const onClose = jest.fn();
		const {actions} = renderComponent(undefined, {onClose});

		fireEvent.click(screen.getByTestId('conflict-keep-mine'));
		await waitFor(() =>
			expect(actions.resolveKeepMine).toHaveBeenCalledWith(
				expect.objectContaining({id: story.id})
			)
		);
		expect(actions.resolveTakeTheirs).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it('takes the server version when Take theirs is clicked', async () => {
		const onClose = jest.fn();
		const {actions} = renderComponent(undefined, {onClose});

		fireEvent.click(screen.getByTestId('conflict-take-theirs'));
		await waitFor(() =>
			expect(actions.resolveTakeTheirs).toHaveBeenCalledWith(
				expect.objectContaining({id: story.id})
			)
		);
		expect(actions.resolveKeepMine).not.toHaveBeenCalled();
		await waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it('only closes when Later is clicked', async () => {
		const onClose = jest.fn();
		const {actions} = renderComponent(undefined, {onClose});

		fireEvent.click(screen.getByTestId('conflict-later'));
		expect(onClose).toHaveBeenCalled();
		expect(actions.resolveKeepMine).not.toHaveBeenCalled();
		expect(actions.resolveTakeTheirs).not.toHaveBeenCalled();
		await waitFor(() => expect(screen.queryByText('x')).toBeNull());
	});

	it('reports a server version it could not load', async () => {
		renderComponent({
			client: {getStory: jest.fn().mockRejectedValue(new Error('offline'))}
		});
		expect(
			await screen.findByText('dialogs.serverConflict.serverError')
		).toBeInTheDocument();
	});
});
