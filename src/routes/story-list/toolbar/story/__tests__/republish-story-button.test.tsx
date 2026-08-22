import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {fakeStory} from '../../../../../test-util';
import {
	RepublishStoryButton,
	RepublishStoryButtonProps
} from '../republish-story-button';

describe('<RepublishStoryButton>', () => {
	async function renderComponent(props?: Partial<RepublishStoryButtonProps>) {
		const result = render(
			<RepublishStoryButton
				onRepublish={jest.fn()}
				story={fakeStory()}
				{...props}
			/>
		);

		await act(() => Promise.resolve());
		return result;
	}

	it('is disabled when no story is selected', async () => {
		await renderComponent({story: undefined});
		expect(screen.getByTestId('story-republish')).toBeDisabled();
	});

	it('republishes the story when clicked', async () => {
		const onRepublish = jest.fn();
		const story = fakeStory();

		await renderComponent({onRepublish, story});
		fireEvent.click(screen.getByTestId('story-republish'));
		expect(onRepublish).toHaveBeenCalledWith(story);
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
