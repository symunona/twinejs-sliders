import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route} from 'react-router-dom';
import {
	ServerError,
	ServerSyncContext,
	ServerSyncContextProps
} from '../../../store/persistence/server';
import type {ServerClient} from '../../../store/persistence/server';
import {testSyncContext} from '../../../store/persistence/server/test-fixtures';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory
} from '../../../test-util';
import {CloudStoryGate} from '../cloud-story-gate';

describe('<CloudStoryGate>', () => {
	function fakeClient(getStory: jest.Mock) {
		return {getStory} as unknown as ServerClient;
	}

	function renderComponent(
		contexts?: FakeStateProviderProps,
		sync?: Partial<ServerSyncContextProps>
	) {
		return render(
			<ServerSyncContext.Provider value={testSyncContext(sync)}>
				<FakeStateProvider {...contexts}>
					<MemoryRouter initialEntries={['/stories/cloud-id/play']}>
						<Route path="/stories/:storyId/play">
							<CloudStoryGate>
								<div data-testid="route" />
							</CloudStoryGate>
						</Route>
					</MemoryRouter>
				</FakeStateProvider>
			</ServerSyncContext.Provider>
		);
	}

	it('renders the route when the story is local', () => {
		const getStory = jest.fn();

		renderComponent(
			{stories: [{...fakeStory(), id: 'cloud-id'}]},
			{client: fakeClient(getStory)}
		);
		expect(screen.getByTestId('route')).toBeInTheDocument();
		expect(getStory).not.toHaveBeenCalled();
	});

	it('renders the route when no backend is set', () => {
		renderComponent({stories: []}, {client: undefined});
		expect(screen.getByTestId('route')).toBeInTheDocument();
	});

	it('offers to pull a story the server has, and pulls only when asked', async () => {
		const getStory = jest.fn().mockResolvedValue({
			rev: 3,
			story: {...fakeStory(), id: 'cloud-id', name: 'From the Cloud'}
		});
		const checkout = jest.fn().mockResolvedValue(undefined);

		renderComponent(
			{stories: []},
			{
				actions: {...testSyncContext().actions, checkout},
				client: fakeClient(getStory)
			}
		);

		expect(await screen.findByText('From the Cloud')).toBeInTheDocument();
		expect(getStory).toHaveBeenCalledWith('cloud-id');
		expect(checkout).not.toHaveBeenCalled();
		expect(screen.queryByTestId('route')).not.toBeInTheDocument();

		fireEvent.click(screen.getByText('routes.cloudStoryGate.pull'));
		await waitFor(() => expect(checkout).toHaveBeenCalledWith('cloud-id'));
	});

	it('says so when the server does not have it either', async () => {
		const getStory = jest
			.fn()
			.mockRejectedValue(
				new ServerError('gone', {code: 'not_found', status: 404})
			);

		renderComponent({stories: []}, {client: fakeClient(getStory)});
		expect(
			await screen.findByText('routes.cloudStoryGate.missing')
		).toBeInTheDocument();
	});

	it('offers a retry when the server cannot be reached', async () => {
		const getStory = jest
			.fn()
			.mockRejectedValueOnce(new Error('offline'))
			.mockResolvedValueOnce({
				rev: 1,
				story: {...fakeStory(), name: 'Back Online'}
			});

		renderComponent({stories: []}, {client: fakeClient(getStory)});
		expect(await screen.findByText('offline')).toBeInTheDocument();
		fireEvent.click(screen.getByText('routes.cloudStoryGate.retry'));
		expect(await screen.findByText('Back Online')).toBeInTheDocument();
	});
});
