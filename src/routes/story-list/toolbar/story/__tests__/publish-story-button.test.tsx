import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {fakeStory} from '../../../../../test-util';
import {
	PublishStoryButton,
	PublishStoryButtonProps
} from '../publish-story-button';

describe('<PublishStoryButton>', () => {
	async function renderComponent(props?: Partial<PublishStoryButtonProps>) {
		const result = render(
			<PublishStoryButton
				onPublish={jest.fn().mockResolvedValue(undefined)}
				story={fakeStory()}
				{...props}
			/>
		);

		await act(() => Promise.resolve());
		return result;
	}

	it('is disabled when no story is selected', async () => {
		await renderComponent({story: undefined});
		expect(screen.getByTestId('story-publish')).toBeDisabled();
	});

	it('publishes the story when clicked', async () => {
		const onPublish = jest.fn().mockResolvedValue(undefined);
		const story = fakeStory();

		await renderComponent({onPublish, story});
		fireEvent.click(screen.getByTestId('story-publish'));
		await act(() => Promise.resolve());
		expect(onPublish).toHaveBeenCalledTimes(1);
		expect(onPublish.mock.calls[0][0]).toBe(story);
		expect(onPublish.mock.calls[0][1]).toBeUndefined();
	});

	it('asks whether to overwrite when the server already has this ID', async () => {
		const onPublish = jest.fn().mockResolvedValue(undefined);

		await renderComponent({existsOnServer: true, onPublish});
		fireEvent.click(screen.getByTestId('story-publish'));
		await act(() => Promise.resolve());
		expect(onPublish).not.toHaveBeenCalled();
		expect(
			screen.getByText('routes.storyList.server.publishOverwrite')
		).toBeInTheDocument();
		expect(
			screen.getByText('routes.storyList.server.publishAsNew')
		).toBeInTheDocument();
	});

	it('overwrites when that is chosen', async () => {
		const onPublish = jest.fn().mockResolvedValue(undefined);
		const story = fakeStory();

		await renderComponent({existsOnServer: true, onPublish, story});
		fireEvent.click(screen.getByTestId('story-publish'));
		await act(() => Promise.resolve());
		fireEvent.click(
			screen.getByText('routes.storyList.server.publishOverwrite')
		);
		await act(() => Promise.resolve());
		expect(onPublish).toHaveBeenCalledWith(story, {newIdentity: false});
	});

	it('publishes as a new story when that is chosen', async () => {
		const onPublish = jest.fn().mockResolvedValue(undefined);
		const story = fakeStory();

		await renderComponent({existsOnServer: true, onPublish, story});
		fireEvent.click(screen.getByTestId('story-publish'));
		await act(() => Promise.resolve());
		fireEvent.click(screen.getByText('routes.storyList.server.publishAsNew'));
		await act(() => Promise.resolve());
		expect(onPublish).toHaveBeenCalledWith(story, {newIdentity: true});
	});

	it('offers the same choice when the action rejects with a conflict', async () => {
		const onPublish = jest
			.fn()
			.mockRejectedValue({code: 'conflict', status: 409});

		await renderComponent({onPublish});
		fireEvent.click(screen.getByTestId('story-publish'));
		await act(() => Promise.resolve());
		expect(
			screen.getByText('routes.storyList.server.publishAsNew')
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
