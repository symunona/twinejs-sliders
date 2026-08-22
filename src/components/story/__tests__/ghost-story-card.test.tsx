import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import type {StoryIndexEntry} from '../../../store/persistence/server/server.types';
import {GhostStoryCard, GhostStoryCardProps} from '../ghost-story-card';

function fakeEntry(props?: Partial<StoryIndexEntry>): StoryIndexEntry {
	return {
		assetBytes: 41221904,
		assetCount: 31,
		bytes: 214880,
		deleted: false,
		id: 'mock-story-id',
		ifid: 'mock-ifid',
		lastClient: 'mira',
		name: 'Lighthouse',
		passageCount: 83,
		rev: 42,
		updatedAt: new Date().toISOString(),
		...props
	};
}

describe('<GhostStoryCard>', () => {
	function renderComponent(props?: Partial<GhostStoryCardProps>) {
		return render(
			<GhostStoryCard entry={fakeEntry()} onCheckOut={jest.fn()} {...props} />
		);
	}

	it('renders the story name in a testable attribute', () => {
		renderComponent();
		expect(screen.getByTestId('ghost-story-card').dataset.storyName).toBe(
			'Lighthouse'
		);
	});

	it('says the story is on the server', () => {
		renderComponent();
		expect(
			screen.getByText('routes.storyList.server.onServer', {exact: false})
		).toBeInTheDocument();
	});

	it('renders the passage count, size and update time', () => {
		renderComponent();
		expect(
			screen.getByText('components.storyCard.passageCount', {exact: false})
		).toBeInTheDocument();
		expect(
			screen.getByText('routes.storyList.server.ghostSize', {exact: false})
		).toBeInTheDocument();
		expect(
			screen.getByText('routes.storyList.server.ghostUpdated', {exact: false})
		).toBeInTheDocument();
	});

	it('checks the story out when its button is clicked', async () => {
		const onCheckOut = jest.fn().mockResolvedValue(undefined);

		renderComponent({onCheckOut});
		fireEvent.click(screen.getByTestId('ghost-checkout'));
		expect(onCheckOut).toHaveBeenCalledTimes(1);
		await act(() => Promise.resolve());
	});

	it('shows progress while a checkout runs', async () => {
		let finish = () => {};
		const onCheckOut = jest.fn(
			() => new Promise<void>(resolve => (finish = resolve))
		);

		renderComponent({onCheckOut});
		expect(
			screen.queryByTestId('ghost-checkout-progress')
		).not.toBeInTheDocument();
		fireEvent.click(screen.getByTestId('ghost-checkout'));
		expect(screen.getByTestId('ghost-checkout-progress')).toBeInTheDocument();
		expect(screen.getByTestId('ghost-checkout')).toBeDisabled();

		await act(async () => {
			finish();
		});

		expect(
			screen.queryByTestId('ghost-checkout-progress')
		).not.toBeInTheDocument();
	});

	it('is not selectable', () => {
		renderComponent();
		expect(screen.queryByRole('button', {name: 'Lighthouse'})).toBeNull();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
