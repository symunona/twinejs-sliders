import {act, fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {Story} from '../../../../../store/stories';
import {FakeStateProvider, fakeStory} from '../../../../../test-util';
import {CopyPublicUrlButton} from '../copy-public-url-button';

describe('<CopyPublicUrlButton>', () => {
	const writeText = jest.fn();

	beforeEach(() => {
		writeText.mockResolvedValue(undefined);
		Object.assign(navigator, {clipboard: {writeText}});
	});

	async function renderComponent(
		story: Story | undefined,
		backendUrl: string,
		existsOnServer = true
	) {
		render(
			<FakeStateProvider prefs={{backendUrl}}>
				<CopyPublicUrlButton existsOnServer={existsOnServer} story={story} />
			</FakeStateProvider>
		);
		await act(() => Promise.resolve());
	}

	it('is disabled without a story', async () => {
		await renderComponent(undefined, 'https://store.test');
		expect(screen.getByTestId('story-copy-public-url')).toBeDisabled();
	});

	it('is disabled without a backend', async () => {
		await renderComponent(fakeStory(), '');
		expect(screen.getByTestId('story-copy-public-url')).toBeDisabled();
	});

	it('is disabled until the server has the story', async () => {
		await renderComponent(fakeStory(), 'https://store.test', false);
		expect(screen.getByTestId('story-copy-public-url')).toBeDisabled();
	});

	it('copies the public link for the story id', async () => {
		const story = fakeStory();

		await renderComponent(story, 'https://store.test/api/v1/');
		fireEvent.click(screen.getByTestId('story-copy-public-url'));
		await act(() => Promise.resolve());
		expect(writeText).toHaveBeenCalledWith(
			`https://store.test/pub/${encodeURIComponent(story.id)}`
		);
	});
});
