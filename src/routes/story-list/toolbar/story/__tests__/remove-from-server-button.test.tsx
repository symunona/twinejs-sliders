import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {fakeStory} from '../../../../../test-util';
import {
	RemoveFromServerButton,
	RemoveFromServerButtonProps
} from '../remove-from-server-button';

describe('<RemoveFromServerButton>', () => {
	async function renderComponent(props?: Partial<RemoveFromServerButtonProps>) {
		const result = render(
			<RemoveFromServerButton
				onRemoveFromServer={jest.fn()}
				story={fakeStory()}
				{...props}
			/>
		);

		await act(() => Promise.resolve());
		return result;
	}

	it('is disabled when the server has never heard of the story', async () => {
		await renderComponent({disabled: true});
		expect(screen.getByTestId('story-remove-from-server')).toBeDisabled();
	});

	it('warns that other editors keep their copy before removing', async () => {
		const onRemoveFromServer = jest.fn();

		await renderComponent({onRemoveFromServer});
		fireEvent.click(screen.getByTestId('story-remove-from-server'));
		expect(
			await screen.findByText('routes.storyList.server.removeFromServerWarning')
		).toBeInTheDocument();
		expect(onRemoveFromServer).not.toHaveBeenCalled();
	});

	it('removes the story from the server once confirmed', async () => {
		const onRemoveFromServer = jest.fn();
		const story = fakeStory();

		await renderComponent({onRemoveFromServer, story});
		fireEvent.click(screen.getByTestId('story-remove-from-server'));
		fireEvent.click(
			await screen.findByText('routes.storyList.server.removeFromServer', {
				selector: '.card-button-card button'
			})
		);
		expect(onRemoveFromServer).toHaveBeenCalledWith(story);
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
