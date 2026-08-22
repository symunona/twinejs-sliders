import {fireEvent, render, screen} from '@testing-library/react';
import {createMemoryHistory, MemoryHistory} from 'history';
import {axe} from 'jest-axe';
import * as React from 'react';
import {Router} from 'react-router-dom';
import type {StoryIndexEntry} from '../../../store/persistence/server/server.types';
import {useStoryLaunch} from '../../../store/use-story-launch';
import {
	fakePrefs,
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory,
	PrefInspector,
	StoryInspector
} from '../../../test-util';
import {StoryCards, StoryCardsProps} from '../story-cards';

jest.mock('../../../components/story/ghost-story-card');
jest.mock('../../../components/story/story-card');
jest.mock('../../../store/use-story-launch');

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

describe('<StoryCards>', () => {
	const useStoryLaunchMock = useStoryLaunch as jest.Mock;
	let playStory: jest.Mock;
	let testStory: jest.Mock;

	beforeEach(() => {
		playStory = jest.fn();
		testStory = jest.fn();
		useStoryLaunchMock.mockReturnValue({playStory, testStory});
	});

	async function renderComponent(
		props?: Partial<StoryCardsProps>,
		contexts?: FakeStateProviderProps,
		history?: MemoryHistory
	) {
		const result = render(
			<Router history={history ?? createMemoryHistory()}>
				<FakeStateProvider {...contexts}>
					<StoryCards
						onSelectStory={jest.fn()}
						stories={[fakeStory()]}
						{...props}
					/>
					<StoryInspector />
					<PrefInspector name="storyTagColors" />
				</FakeStateProvider>
			</Router>
		);

		return result;
	}

	it('renders a card for every story in props', async () => {
		const stories = [fakeStory(), fakeStory()];

		await renderComponent({stories});
		expect(
			screen.getByTestId(`mock-story-card-${stories[0].id}`)
		).toBeInTheDocument();
		expect(
			screen.getByTestId(`mock-story-card-${stories[1].id}`)
		).toBeInTheDocument();
	});

	it("changes a tag color it's changed in a card", async () => {
		renderComponent(
			{},
			{
				prefs: fakePrefs({storyTagColors: {'mock-existing-tag': 'red'}})
			}
		);
		expect(
			JSON.parse(
				screen.getByTestId('pref-inspector-storyTagColors').textContent!
			)
		).toEqual({
			'mock-existing-tag': 'red'
		});
		fireEvent.click(screen.getByText('onChangeTagColor'));
		expect(
			JSON.parse(
				screen.getByTestId('pref-inspector-storyTagColors').textContent!
			)
		).toEqual({
			'mock-existing-tag': 'red',
			'mock-tag': 'mock-tag-color'
		});
	});

	it('removes a story tag when it is removed in a card', async () => {
		const stories = [fakeStory()];

		stories[0].tags = ['mock-tag', 'mock-tag-2'];
		renderComponent({stories}, {stories});
		expect(screen.getByTestId('story-inspector-default').dataset.tags).toBe(
			'mock-tag mock-tag-2'
		);
		fireEvent.click(screen.getByText('onRemoveTag'));
		expect(screen.getByTestId('story-inspector-default').dataset.tags).toBe(
			'mock-tag-2'
		);
	});

	it('navigates to /stories/:id when a story is edited', async () => {
		const history = createMemoryHistory();
		const stories = [fakeStory()];

		await renderComponent({stories}, {}, history);
		fireEvent.click(screen.getByText('onEdit'));
		expect(history.location.pathname).toBe(`/stories/${stories[0].id}`);
	});

	it('does not label a single group', async () => {
		await renderComponent({stories: [fakeStory()]});
		expect(
			screen.queryByText('routes.storyList.server.groupLocal')
		).not.toBeInTheDocument();
	});

	it('pins synced stories into their own labelled group', async () => {
		const synced = fakeStory();
		const local = fakeStory();

		await renderComponent({stories: [local], syncedStories: [synced]});

		const groups = screen.getAllByText(/routes.storyList.server.group/);

		expect(groups.length).toBe(2);
		expect(screen.getByTestId('story-group-synced')).toBeInTheDocument();
		expect(
			screen
				.getByTestId('story-group-synced')
				.querySelector(`[data-testid="mock-story-card-${synced.id}"]`)
		).toBeInTheDocument();
		expect(
			screen
				.getByTestId('story-group-local')
				.querySelector(`[data-testid="mock-story-card-${local.id}"]`)
		).toBeInTheDocument();
	});

	it('renders ghost cards last, in their own group', async () => {
		const ghost = fakeGhost();

		await renderComponent({ghosts: [ghost], stories: [fakeStory()]});

		const ghostGroup = screen.getByTestId('story-group-ghosts');

		expect(
			ghostGroup.querySelector(
				`[data-testid="mock-ghost-story-card-${ghost.id}"]`
			)
		).toBeInTheDocument();
		expect(
			screen
				.getByTestId('story-group-local')
				.compareDocumentPosition(ghostGroup) & Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
	});

	it('checks a ghost out when its card asks to', async () => {
		const ghost = fakeGhost();
		const onCheckOutGhost = jest.fn();

		await renderComponent({ghosts: [ghost], onCheckOutGhost});
		fireEvent.click(screen.getByText('onCheckOut'));
		expect(onCheckOutGhost).toHaveBeenCalledWith(ghost);
	});

	it('renders no ghost group when there are no ghosts', async () => {
		await renderComponent({ghosts: []});
		expect(screen.queryByTestId('story-group-ghosts')).not.toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});

	it('is accessible with every group present', async () => {
		const {container} = await renderComponent({
			ghosts: [fakeGhost()],
			stories: [fakeStory()],
			syncedStories: [fakeStory()]
		});

		expect(await axe(container)).toHaveNoViolations();
	});
});
