import {render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {
	ServerSyncContext,
	ServerSyncContextProps
} from '../../../store/persistence/server';
import type {StoryIndexEntry} from '../../../store/persistence/server/server.types';
import {useDonationCheck} from '../../../store/prefs/use-donation-check';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory
} from '../../../test-util';
import {InnerStoryListRoute} from '../story-list-route';

jest.mock('../toolbar/story-list-toolbar');
jest.mock('../story-cards');
jest.mock('../../../store/prefs/use-donation-check');
jest.mock('../../../components/error/safari-warning-card');

function fakeGhost(props?: Partial<StoryIndexEntry>): StoryIndexEntry {
	return {
		assetBytes: 0,
		assetCount: 0,
		bytes: 1000,
		deleted: false,
		id: 'mock-ghost-id',
		ifid: 'mock-ghost-ifid',
		lastClient: 'mira',
		name: 'mock-ghost-name',
		passageCount: 3,
		rev: 1,
		updatedAt: '2026-08-21T10:12:00.000Z',
		...props
	};
}

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

describe('<StoryListRoute>', () => {
	const useDonationCheckMock = useDonationCheck as jest.Mock;

	beforeEach(() => {
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => false
		});
	});

	function renderComponent(
		contexts?: FakeStateProviderProps,
		sync?: Partial<ServerSyncContextProps>
	) {
		// Using the inner component so we can mock contexts around it.

		return render(
			<ServerSyncContext.Provider value={fakeSyncContext(sync)}>
				<FakeStateProvider {...contexts}>
					<InnerStoryListRoute />
				</FakeStateProvider>
			</ServerSyncContext.Provider>
		);
	}

	it('displays the toolbar', () => {
		renderComponent();
		expect(screen.getByTestId('mock-story-list-toolbar')).toBeInTheDocument();
	});

	it('displays a warning for Safari users', () => {
		renderComponent();
		expect(screen.getByTestId('mock-safari-warning-card')).toBeInTheDocument();
	});

	it('displays story cards if there are stories in state', () => {
		renderComponent({stories: [fakeStory()]});
		expect(screen.getByTestId('mock-story-cards')).toBeInTheDocument();
	});

	it('displays a message if there are no stories in state', () => {
		renderComponent({stories: []});
		expect(screen.queryByTestId('mock-story-cards')).not.toBeInTheDocument();
		expect(screen.getByText('routes.storyList.noStories')).toBeInTheDocument();
	});

	it('sorts stories by name if the user pref is set to that', () => {
		const story1 = fakeStory();
		const story2 = fakeStory();

		story1.name = 'a';
		story1.lastUpdate = new Date('1/1/2000');
		story2.name = 'b';
		story2.lastUpdate = new Date('1/1/1999');
		renderComponent({
			prefs: {storyListSort: 'name'},
			stories: [story2, story1]
		});

		const storyCards = screen.getAllByTestId('mock-story-card');

		expect(storyCards.length).toBe(2);
		expect(storyCards[0].dataset.id).toBe(story1.id);
		expect(storyCards[1].dataset.id).toBe(story2.id);
	});

	it('sorts stories by reverse chronological edit order if the user pref is set to that', () => {
		const story1 = fakeStory();
		const story2 = fakeStory();

		story1.name = 'b';
		story1.lastUpdate = new Date('1/1/2000');
		story2.name = 'a';
		story2.lastUpdate = new Date('1/1/1999');
		renderComponent({
			prefs: {storyListSort: 'date'},
			stories: [story2, story1]
		});

		const storyCards = screen.getAllByTestId('mock-story-card');

		expect(storyCards.length).toBe(2);
		expect(storyCards[0].dataset.id).toBe(story1.id);
		expect(storyCards[1].dataset.id).toBe(story2.id);
	});

	it('displays a donation prompt if useDonationCheck() says it should be shown', () => {
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => true
		});

		renderComponent();
		expect(screen.getByText('dialogs.appDonation.title')).toBeInTheDocument();
	});

	it('does not display a donation prompt if useDonationCheck() says it should not be shown', () => {
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => false
		});

		renderComponent();
		expect(
			screen.queryByText('dialogs.appDonation.title')
		).not.toBeInTheDocument();
	});

	it('pins checked-out stories into their own group', () => {
		const synced = fakeStory();
		const local = fakeStory();

		synced.sync = true;
		renderComponent({stories: [synced, local]});
		expect(screen.getByTestId('mock-synced-story-card').dataset.id).toBe(
			synced.id
		);
		expect(screen.getByTestId('mock-story-card').dataset.id).toBe(local.id);
	});

	it('displays ghost cards when connected', () => {
		renderComponent({stories: [fakeStory()]}, {ghosts: [fakeGhost()]});
		expect(screen.getByTestId('mock-ghost-story-card')).toBeInTheDocument();
	});

	it('sorts ghosts newest first', () => {
		renderComponent(
			{stories: [fakeStory()]},
			{
				ghosts: [
					fakeGhost({id: 'older', updatedAt: '2026-08-20T10:12:00.000Z'}),
					fakeGhost({id: 'newer', updatedAt: '2026-08-21T10:12:00.000Z'})
				]
			}
		);

		const ghosts = screen.getAllByTestId('mock-ghost-story-card');

		expect(ghosts.map(ghost => ghost.dataset.id)).toEqual(['newer', 'older']);
	});

	it('hides ghost cards when not connected', () => {
		renderComponent(
			{stories: [fakeStory()]},
			{connected: false, ghosts: [fakeGhost()]}
		);
		expect(
			screen.queryByTestId('mock-ghost-story-card')
		).not.toBeInTheDocument();
	});

	it('displays ghosts even when there are no local stories', () => {
		renderComponent({stories: []}, {ghosts: [fakeGhost()]});
		expect(screen.getByTestId('mock-ghost-story-card')).toBeInTheDocument();
		expect(
			screen.queryByText('routes.storyList.noStories')
		).not.toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
