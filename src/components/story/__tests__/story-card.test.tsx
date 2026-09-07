import {fireEvent, render, screen, within} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {fakeStory} from '../../../test-util';
import {StoryCard, StoryCardProps} from '../story-card';

jest.mock('../../tag/tag-button');
jest.mock('../../../util/is-electron');
jest.mock('../story-preview');

describe('<StoryCard>', () => {
	function renderComponent(props?: Partial<StoryCardProps>) {
		return render(
			<StoryCard
				onChangeTagColor={jest.fn()}
				onEdit={jest.fn()}
				onRemoveTag={jest.fn()}
				onSelect={jest.fn()}
				story={fakeStory()}
				storyTagColors={{}}
				{...props}
			/>
		);
	}

	it('renders the story name', () => {
		const story = fakeStory();

		renderComponent({story});
		expect(screen.getByText(story.name)).toBeInTheDocument();
	});

	it('renders a preview of the story', () => {
		const story = fakeStory();

		renderComponent({story});
		expect(
			screen.getByTestId(`mock-story-preview-${story.name}`)
		).toBeInTheDocument();
	});

	it('renders a count of passages in the story', () => {
		renderComponent();
		expect(
			screen.getByText('components.storyCard.passageCount', {exact: false})
		).toBeInTheDocument();
	});

	it("renders the story's last update", () => {
		renderComponent();
		expect(
			screen.getByText('components.storyCard.lastUpdated', {exact: false})
		).toBeInTheDocument();
	});

	it('renders a tag button for every tag the story has', () => {
		const story = fakeStory();

		story.tags = ['mock-tag-1', 'mock-tag-2'];

		renderComponent({story});
		expect(
			screen.getByTestId('mock-tag-button-mock-tag-1')
		).toBeInTheDocument();
		expect(
			screen.getByTestId('mock-tag-button-mock-tag-2')
		).toBeInTheDocument();
	});

	it('calls the onSelect prop when the card is clicked', () => {
		const story = fakeStory();
		const onSelect = jest.fn();

		renderComponent({story, onSelect});
		expect(onSelect).not.toHaveBeenCalled();
		fireEvent.click(screen.getByText(story.name));
		expect(onSelect).toHaveBeenCalledTimes(1);
	});

	it('calls the onEdit prop when the card is double-clicked', () => {
		const story = fakeStory();
		const onEdit = jest.fn();

		renderComponent({story, onEdit});
		expect(onEdit).not.toHaveBeenCalled();
		fireEvent.dblClick(screen.getByText(story.name));
		expect(onEdit).toHaveBeenCalledTimes(1);
	});

	it('calls the onChangeTagColor prop when a tag color is edited', () => {
		const onChangeTagColor = jest.fn();
		const story = fakeStory();

		story.tags = ['mock-tag'];
		renderComponent({onChangeTagColor, story});
		expect(onChangeTagColor).not.toHaveBeenCalled();

		const tagButton = within(screen.getByTestId('mock-tag-button-mock-tag'));

		fireEvent.click(tagButton.getByText('onChangeColor'));
		expect(onChangeTagColor.mock.calls).toEqual([['mock-tag', 'mock-color']]);
	});

	it('calls the onRemoveTag prop when a tag is removed', () => {
		const onRemoveTag = jest.fn();
		const story = fakeStory();

		story.tags = ['mock-tag'];
		renderComponent({onRemoveTag, story});
		expect(onRemoveTag).not.toHaveBeenCalled();

		const tagButton = within(screen.getByTestId('mock-tag-button-mock-tag'));

		fireEvent.click(tagButton.getByText('onRemove'));
		expect(onRemoveTag.mock.calls).toEqual([['mock-tag']]);
	});

	it('renders no sync badge for a story with no server record', () => {
		renderComponent();
		expect(
			screen.queryByTestId('story-card-sync-badge')
		).not.toBeInTheDocument();
	});

	it('renders a sync badge for a story marked to sync', () => {
		renderComponent({story: {...fakeStory(), sync: true}});
		expect(screen.getByTestId('story-card-sync-badge').dataset.syncState).toBe(
			'idle'
		);
	});

	it("renders the sync record's state in the badge", () => {
		const story = fakeStory();

		renderComponent({
			story,
			syncRecord: {
				pushedHash: 'mock-hash',
				rev: 3,
				state: 'conflict',
				storyId: story.id
			}
		});
		expect(screen.getByTestId('story-card-sync-badge').dataset.syncState).toBe(
			'conflict'
		);
	});

	it("renders other editors' initials in the badge", () => {
		const story = fakeStory();

		renderComponent({
			presence: [{id: 'mock-id', name: 'mira'}],
			story,
			syncRecord: {
				pushedHash: 'mock-hash',
				rev: 3,
				state: 'idle',
				storyId: story.id
			}
		});
		expect(screen.getByTestId('story-card-sync-presence').textContent).toBe(
			'M'
		);
	});

	describe("while the story's artwork is downloading", () => {
		it('shows a loader with the file count', () => {
			renderComponent({loading: {done: 1, phase: 'assets', total: 2}});
			expect(
				screen.getByText('components.storyCard.loadingAssetsCount')
			).toBeInTheDocument();
			expect(screen.getByTestId('story-card-loading-progress')).toHaveValue(
				0.5
			);
		});

		it('cannot be selected or opened', () => {
			const onEdit = jest.fn();
			const onSelect = jest.fn();

			renderComponent({
				loading: {done: 0, phase: 'assets', total: 3},
				onEdit,
				onSelect
			});

			const card = screen.getByRole('button', {name: /.+/});

			fireEvent.click(card);
			fireEvent.doubleClick(card);
			expect(onSelect).not.toHaveBeenCalled();
			expect(onEdit).not.toHaveBeenCalled();
		});
	});

	it('shows no loader when the story is complete', () => {
		renderComponent();
		expect(screen.queryByTestId('story-card-loading')).not.toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
