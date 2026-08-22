import {act, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {
	ServerSyncContext,
	ServerSyncContextProps
} from '../../../../../store/persistence/server';
import type {SyncState} from '../../../../../store/persistence/server/server.types';
import {Story} from '../../../../../store/stories';
import {
	FakeStateProvider,
	fakeStory,
	StoryInspector
} from '../../../../../test-util';
import {StoryActions} from '../story-actions';

function fakeSyncContext(
	props?: Partial<ServerSyncContextProps>
): ServerSyncContextProps {
	return {
		actions: {
			checkout: jest.fn().mockResolvedValue(undefined),
			publish: jest.fn().mockResolvedValue(undefined),
			refresh: jest.fn().mockResolvedValue(undefined),
			removeFromServer: jest.fn().mockResolvedValue(undefined),
			republish: jest.fn().mockResolvedValue(undefined),
			resolveKeepMine: jest.fn().mockResolvedValue(undefined),
			resolveTakeTheirs: jest.fn().mockResolvedValue(undefined),
			setSync: jest.fn()
		},
		connected: true,
		ghosts: [],
		index: [],
		progress: {},
		records: {},
		...props
	};
}

describe('<StoryActions>', () => {
	async function renderComponent(
		story?: Story,
		sync?: Partial<ServerSyncContextProps>
	) {
		const result = render(
			<ServerSyncContext.Provider value={fakeSyncContext(sync)}>
				<FakeStateProvider>
					<StoryActions selectedStory={story} />
					<StoryInspector />
				</FakeStateProvider>
			</ServerSyncContext.Provider>
		);

		await act(() => Promise.resolve());
		return result;
	}

	function withState(story: Story, state: SyncState) {
		return {
			records: {
				[story.id]: {
					pushedHash: 'mock-hash',
					rev: 3,
					state,
					storyId: story.id
				}
			}
		};
	}

	it('displays a button to create stories', async () => {
		await renderComponent();
		expect(screen.getByText('common.new')).toBeInTheDocument();
	});

	it('displays a button to edit stories', async () => {
		await renderComponent();
		expect(screen.getByText('common.edit')).toBeInTheDocument();
	});

	it('displays a button to rename stories', async () => {
		await renderComponent();
		expect(screen.getByText('common.rename')).toBeInTheDocument();
	});

	it.todo('renames a story when the rename story button is used');

	it('displays a button to tag stories', async () => {
		await renderComponent();
		expect(screen.getByText('common.tags')).toBeInTheDocument();
	});

	it('displays a button to duplicate stories', async () => {
		await renderComponent();
		expect(screen.getByText('common.duplicate')).toBeInTheDocument();
	});

	it('displays a button to delete stories', async () => {
		await renderComponent();
		expect(screen.getByText('common.delete')).toBeInTheDocument();
	});

	it('displays a publish button for a story that does not sync', async () => {
		await renderComponent(fakeStory());
		expect(screen.getByTestId('story-publish')).toBeInTheDocument();
	});

	it('hides the publish button for a story that already syncs', async () => {
		await renderComponent({...fakeStory(), sync: true});
		expect(screen.queryByTestId('story-publish')).not.toBeInTheDocument();
	});

	it('always displays a sync toggle', async () => {
		await renderComponent(fakeStory());
		expect(screen.getByTestId('story-sync-toggle')).toBeInTheDocument();
	});

	it('displays a republish button only when the story is gone from the server', async () => {
		const story = fakeStory();

		await renderComponent(story);
		expect(screen.queryByTestId('story-republish')).not.toBeInTheDocument();

		const result = await renderComponent(story, withState(story, 'gone'));

		expect(
			result.getAllByTestId('story-republish').length
		).toBeGreaterThanOrEqual(1);
	});

	it('displays a resolve button only when the story is in conflict', async () => {
		const story = fakeStory();

		await renderComponent(story);
		expect(screen.queryByTestId('story-resolve')).not.toBeInTheDocument();

		const result = await renderComponent(story, withState(story, 'conflict'));

		expect(
			result.getAllByTestId('story-resolve').length
		).toBeGreaterThanOrEqual(1);
	});

	it('disables removing from the server when the story has no sync record', async () => {
		await renderComponent(fakeStory());
		expect(screen.getByTestId('story-remove-from-server')).toBeDisabled();
	});

	it('enables removing from the server when the story has a sync record', async () => {
		const story = fakeStory();

		await renderComponent(story, withState(story, 'idle'));
		expect(screen.getByTestId('story-remove-from-server')).not.toBeDisabled();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
