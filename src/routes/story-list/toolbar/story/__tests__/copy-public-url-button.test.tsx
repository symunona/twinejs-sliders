import {act, fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {ServerClient} from '../../../../../store/persistence/server';
import {Story} from '../../../../../store/stories';
import {usePublishing} from '../../../../../store/use-publishing';
import {FakeStateProvider, fakeStory} from '../../../../../test-util';
import {CopyPublicUrlButton} from '../copy-public-url-button';

jest.mock('../../../../../store/use-publishing');

describe('<CopyPublicUrlButton>', () => {
	const writeText = jest.fn();
	const publishStory = jest.fn();
	const putPlayer = jest.fn();
	const client = {putPlayer} as unknown as ServerClient;

	beforeEach(() => {
		writeText.mockResolvedValue(undefined);
		publishStory.mockResolvedValue('<html>played</html>');
		putPlayer.mockResolvedValue(undefined);
		Object.assign(navigator, {clipboard: {writeText}});
		(usePublishing as jest.Mock).mockReturnValue({publishStory});
	});

	async function renderComponent(
		story: Story | undefined,
		backendUrl: string,
		existsOnServer = true
	) {
		render(
			<FakeStateProvider prefs={{backendUrl}}>
				<CopyPublicUrlButton
					client={client}
					existsOnServer={existsOnServer}
					story={story}
				/>
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

	it('publishes the playable page with public art urls and copies its link', async () => {
		const story = fakeStory();

		await renderComponent(story, 'https://store.test/api/v1/');
		fireEvent.click(screen.getByTestId('story-copy-public-url'));
		expect(writeText).toHaveBeenCalledWith(
			`https://store.test/pub/${encodeURIComponent(story.id)}`
		);
		await act(() => Promise.resolve());
		await act(() => Promise.resolve());

		const [id, options] = publishStory.mock.calls[0];

		expect(id).toBe(story.id);
		expect(options.slidersUrls.remote('abc')).toBe(
			'https://store.test/pub/blobs/abc'
		);
		expect(putPlayer).toHaveBeenCalledWith(story.id, '<html>played</html>');
		expect(
			screen.getByText('routes.storyList.server.copyPublicUrlCopied')
		).toBeInTheDocument();
	});

	it('says so when the upload fails', async () => {
		putPlayer.mockRejectedValue(new Error('nope'));
		jest.spyOn(console, 'warn').mockImplementation(() => {});
		await renderComponent(fakeStory(), 'https://store.test');
		fireEvent.click(screen.getByTestId('story-copy-public-url'));
		await act(() => Promise.resolve());
		await act(() => Promise.resolve());
		expect(
			screen.getByText('routes.storyList.server.copyPublicUrlFailed')
		).toBeInTheDocument();
	});
});
